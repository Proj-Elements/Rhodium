ALTER TABLE "Category" ADD COLUMN "systemKey" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Subscription" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "syncedThrough" DATE;
ALTER TABLE "MonthlyBudget" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BudgetPreset" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

WITH defaults(name, type, position) AS (VALUES
  ('餐饮','EXPENSE',0),('饮料零食','EXPENSE',1),('交通','EXPENSE',2),('学习','EXPENSE',3),
  ('生活','EXPENSE',4),('娱乐','EXPENSE',5),('购物','EXPENSE',6),('医疗','EXPENSE',7),
  ('住房','EXPENSE',8),('其他','BOTH',9),('兼职','INCOME',10),('代写','INCOME',11),('其他收入','INCOME',12)
), candidates AS (
  SELECT category.id, defaults.position,
    row_number() OVER (PARTITION BY defaults.position ORDER BY category."createdAt", category.id) AS priority
  FROM "Category" category JOIN defaults ON category."isSystem" AND category.type::text = defaults.type
    AND (category.name = defaults.name OR category."sortOrder" = defaults.position)
)
UPDATE "Category" SET "systemKey" = 'default-' || candidates.position
FROM candidates WHERE "Category".id = candidates.id AND candidates.priority = 1;
CREATE UNIQUE INDEX "Category_systemKey_key" ON "Category"("systemKey");

CREATE FUNCTION rhodium_valid_date(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND (value #>> '{}')::date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND to_char((value #>> '{}')::date, 'YYYY-MM-DD') = value #>> '{}';
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION rhodium_valid_month(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$', false);
$$;

CREATE FUNCTION rhodium_valid_integer(value jsonb, minimum bigint, maximum bigint) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE amount numeric;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  amount := (value #>> '{}')::numeric;
  RETURN amount BETWEEN minimum AND maximum AND amount = trunc(amount);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION rhodium_valid_pauses(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; previous_end text; started boolean := false;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR entry IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT (entry ?& ARRAY['start','end'])
      OR rhodium_valid_date(entry->'start') IS DISTINCT FROM true THEN RETURN false; END IF;
    IF entry->'end' <> 'null'::jsonb AND (rhodium_valid_date(entry->'end') IS DISTINCT FROM true
      OR (entry->>'end')::date < (entry->>'start')::date) THEN RETURN false; END IF;
    IF started AND (previous_end IS NULL OR previous_end > entry->>'start') THEN RETURN false; END IF;
    previous_end := entry->>'end'; started := true;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION rhodium_valid_billing_history(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; previous_month text;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR entry IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT (entry ?& ARRAY['effectiveMonth','amountCents','billingDay','categoryId','name','startMonth','endMonth','note'])
      OR NOT rhodium_valid_integer(entry->'amountCents', 0, 2000000000)
      OR NOT rhodium_valid_integer(entry->'billingDay', 1, 31)
      OR jsonb_typeof(entry->'categoryId') IS DISTINCT FROM 'string' OR length(btrim(entry->>'categoryId')) NOT BETWEEN 1 AND 60
      OR jsonb_typeof(entry->'name') IS DISTINCT FROM 'string' OR length(btrim(entry->>'name')) NOT BETWEEN 1 AND 80
      OR NOT rhodium_valid_month(entry->'effectiveMonth') OR NOT rhodium_valid_month(entry->'startMonth')
      OR (entry->'endMonth' <> 'null'::jsonb AND (NOT rhodium_valid_month(entry->'endMonth') OR entry->>'endMonth' < entry->>'startMonth'))
      OR (entry->'note' <> 'null'::jsonb AND jsonb_typeof(entry->'note') IS DISTINCT FROM 'string')
      OR (previous_month IS NOT NULL AND previous_month >= entry->>'effectiveMonth') THEN RETURN false; END IF;
    previous_month := entry->>'effectiveMonth';
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION rhodium_valid_category_snapshot(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; identities text[] := '{}';
BEGIN
  IF value IS NULL OR value = 'null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR entry IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT (entry ?& ARRAY['categoryId','categoryName','expenseCents','outOfPocketCents','incomeCents'])
      OR jsonb_typeof(entry->'categoryId') IS DISTINCT FROM 'string' OR length(entry->>'categoryId') = 0
      OR jsonb_typeof(entry->'categoryName') IS DISTINCT FROM 'string' OR entry->>'categoryId' = ANY(identities)
      OR NOT rhodium_valid_integer(entry->'expenseCents', 0, 2147483647)
      OR NOT rhodium_valid_integer(entry->'outOfPocketCents', 0, 2147483647)
      OR NOT rhodium_valid_integer(entry->'incomeCents', 0, 2147483647)
      OR (entry->>'outOfPocketCents')::bigint > (entry->>'expenseCents')::bigint THEN RETURN false; END IF;
    identities := array_append(identities, entry->>'categoryId');
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION rhodium_settlement_totals_match(value jsonb, expense integer, income integer, budget integer, remaining integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE total_expense bigint; total_income bigint; total_out_of_pocket bigint;
BEGIN
  IF value IS NULL OR value = 'null'::jsonb THEN RETURN true; END IF;
  IF NOT rhodium_valid_category_snapshot(value) THEN RETURN false; END IF;
  SELECT coalesce(sum((entry->>'expenseCents')::bigint), 0), coalesce(sum((entry->>'incomeCents')::bigint), 0),
    coalesce(sum((entry->>'outOfPocketCents')::bigint), 0)
    INTO total_expense, total_income, total_out_of_pocket FROM jsonb_array_elements(value) entry;
  RETURN total_expense = expense AND total_income = income AND (remaining IS NULL OR remaining::bigint = budget::bigint - total_out_of_pocket);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION rhodium_valid_transaction_snapshot(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['id','version']
    AND jsonb_typeof(value->'id') = 'string' AND length(value->>'id') BETWEEN 1 AND 60
    AND rhodium_valid_integer(value->'version', 1, 2147483647)
    AND (NOT value ? 'type' OR value->>'type' IN ('EXPENSE','INCOME'))
    AND (NOT value ? 'amountCents' OR rhodium_valid_integer(value->'amountCents', 0, 2000000000))
    AND (NOT value ? 'occurredOn' OR rhodium_valid_date(value->'occurredOn'))
    AND (NOT value ? 'categoryId' OR (jsonb_typeof(value->'categoryId') = 'string' AND length(value->>'categoryId') BETWEEN 1 AND 60))
    AND (NOT value ? 'categoryName' OR value->'categoryName' = 'null'::jsonb OR jsonb_typeof(value->'categoryName') = 'string')
    AND (NOT value ? 'note' OR value->'note' = 'null'::jsonb OR jsonb_typeof(value->'note') = 'string')
    AND (NOT value ? 'source' OR value->>'source' IN ('MANUAL','SUBSCRIPTION'))
    AND (NOT value ? 'subscriptionId' OR value->'subscriptionId' = 'null'::jsonb OR jsonb_typeof(value->'subscriptionId') = 'string')
    AND (NOT value ? 'subscriptionMonth' OR value->'subscriptionMonth' = 'null'::jsonb OR rhodium_valid_date(value->'subscriptionMonth'))
    AND (
      NOT value ? 'source'
      OR (value->>'source' = 'MANUAL' AND coalesce(value->'subscriptionId' = 'null'::jsonb, true) AND coalesce(value->'subscriptionMonth' = 'null'::jsonb, true))
      OR (value->>'source' = 'SUBSCRIPTION' AND value->>'type' = 'EXPENSE'
        AND jsonb_typeof(value->'subscriptionId') = 'string' AND rhodium_valid_date(value->'subscriptionMonth'))
    )
    AND (NOT value ? 'reimbursedAt' OR value->'reimbursedAt' = 'null'::jsonb OR jsonb_typeof(value->'reimbursedAt') = 'string')
    AND (NOT value ? 'deletedAt' OR value->'deletedAt' = 'null'::jsonb OR jsonb_typeof(value->'deletedAt') = 'string')
    AND (NOT value ? 'createdAt' OR jsonb_typeof(value->'createdAt') = 'string')
    AND (NOT value ? 'updatedAt' OR jsonb_typeof(value->'updatedAt') = 'string'),
    false
  );
$$;

CREATE FUNCTION rhodium_valid_settlement_snapshot(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  budget integer; expense integer; income integer; remaining integer;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR NOT (value ?& ARRAY['month','revision'])
    OR (value ? 'id' AND jsonb_typeof(value->'id') IS DISTINCT FROM 'string')
    OR NOT (
      (rhodium_valid_date(value->'month') AND right(value->>'month', 3) = '-01')
      OR (jsonb_typeof(value->'month') = 'string' AND rhodium_valid_month(value->'month'))
    )
    OR (value ? 'budgetAmountCents' AND NOT rhodium_valid_integer(value->'budgetAmountCents', 0, 2147483647))
    OR (value ? 'expenseAmountCents' AND NOT rhodium_valid_integer(value->'expenseAmountCents', 0, 2147483647))
    OR (value ? 'incomeAmountCents' AND NOT rhodium_valid_integer(value->'incomeAmountCents', 0, 2147483647))
    OR NOT rhodium_valid_integer(value->'revision', 1, 2147483647)
    OR (value ? 'settledAt' AND jsonb_typeof(value->'settledAt') IS DISTINCT FROM 'string')
    OR (value ? 'reopenedAt' AND value->'reopenedAt' <> 'null'::jsonb AND jsonb_typeof(value->'reopenedAt') IS DISTINCT FROM 'string')
    OR (value ? 'categorySnapshot' AND NOT rhodium_valid_category_snapshot(value->'categorySnapshot')) THEN
    RETURN false;
  END IF;
  IF NOT (value ?& ARRAY['budgetAmountCents','expenseAmountCents','incomeAmountCents','remainingAmountCents','categorySnapshot']) THEN
    RETURN true;
  END IF;
  budget := (value->>'budgetAmountCents')::integer;
  expense := (value->>'expenseAmountCents')::integer;
  income := (value->>'incomeAmountCents')::integer;
  remaining := CASE WHEN value->'remainingAmountCents' = 'null'::jsonb THEN NULL ELSE (value->>'remainingAmountCents')::integer END;
  IF value->'remainingAmountCents' <> 'null'::jsonb
    AND NOT rhodium_valid_integer(value->'remainingAmountCents', -2147483648, 2147483647) THEN
    RETURN false;
  END IF;
  RETURN rhodium_settlement_totals_match(value->'categorySnapshot', expense, income, budget, remaining);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

ALTER TABLE "Category" ADD CONSTRAINT "Category_version_check" CHECK (version > 0),
  ADD CONSTRAINT "Category_pauses_check" CHECK (rhodium_valid_pauses("billingPauses"));
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_check" CHECK ("amountCents" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "Transaction_version_check" CHECK (version > 0),
  ADD CONSTRAINT "Transaction_date_check" CHECK ("occurredOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  ADD CONSTRAINT "Transaction_reimbursement_check" CHECK ("reimbursedAt" IS NULL OR type = 'EXPENSE'),
  ADD CONSTRAINT "Transaction_subscription_check" CHECK (
    (source = 'MANUAL' AND "subscriptionId" IS NULL AND "subscriptionMonth" IS NULL AND "subscriptionOccurrenceKey" IS NULL)
    OR (source = 'SUBSCRIPTION' AND type = 'EXPENSE' AND "subscriptionId" IS NOT NULL AND "subscriptionMonth" IS NOT NULL
      AND "subscriptionMonth" BETWEEN DATE '0001-01-01' AND DATE '9999-12-01'
      AND extract(day FROM "subscriptionMonth") = 1
      AND ("subscriptionOccurrenceKey" IS NULL OR "subscriptionOccurrenceKey" = "subscriptionId" || ':' || to_char("subscriptionMonth", 'YYYY-MM'))));
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_amount_check" CHECK ("amountCents" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "Subscription_version_check" CHECK (version > 0),
  ADD CONSTRAINT "Subscription_sync_date_check" CHECK ("syncedThrough" IS NULL OR "syncedThrough" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  ADD CONSTRAINT "Subscription_billing_day_check" CHECK ("billingDay" BETWEEN 1 AND 31),
  ADD CONSTRAINT "Subscription_month_check" CHECK (extract(day FROM "startMonth") = 1 AND "startMonth" BETWEEN DATE '0001-01-01' AND DATE '9999-12-01'
    AND ("endMonth" IS NULL OR (extract(day FROM "endMonth") = 1 AND "endMonth" >= "startMonth" AND "endMonth" <= DATE '9999-12-01'))),
  ADD CONSTRAINT "Subscription_pauses_check" CHECK (rhodium_valid_pauses("billingPauses")),
  ADD CONSTRAINT "Subscription_history_check" CHECK (rhodium_valid_billing_history("billingHistory"));
ALTER TABLE "MonthlyBudget" ADD CONSTRAINT "MonthlyBudget_amount_check" CHECK ("amountCents" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "MonthlyBudget_version_check" CHECK (version > 0),
  ADD CONSTRAINT "MonthlyBudget_month_check" CHECK (extract(day FROM month) = 1 AND month BETWEEN DATE '0001-01-01' AND DATE '9999-12-01');
ALTER TABLE "BudgetPreset" ADD CONSTRAINT "BudgetPreset_singleton_check" CHECK (id = 1),
  ADD CONSTRAINT "BudgetPreset_version_check" CHECK (version > 0),
  ADD CONSTRAINT "BudgetPreset_amount_check" CHECK ("amountCents" BETWEEN 0 AND 2000000000);
ALTER TABLE "MonthlySettlement" ADD CONSTRAINT "MonthlySettlement_amount_check" CHECK ("budgetAmountCents" >= 0 AND "expenseAmountCents" >= 0 AND "incomeAmountCents" >= 0),
  ADD CONSTRAINT "MonthlySettlement_month_check" CHECK (extract(day FROM month) = 1 AND month BETWEEN DATE '0001-01-01' AND DATE '9999-12-01'),
  ADD CONSTRAINT "MonthlySettlement_revision_check" CHECK (revision > 0),
  ADD CONSTRAINT "MonthlySettlement_remaining_check" CHECK ("remainingAmountCents" IS NULL OR "remainingAmountCents"::bigint BETWEEN "budgetAmountCents"::bigint - "expenseAmountCents"::bigint AND "budgetAmountCents"::bigint),
  ADD CONSTRAINT "MonthlySettlement_categories_check" CHECK (rhodium_valid_category_snapshot("categorySnapshot")),
  ADD CONSTRAINT "MonthlySettlement_totals_check" CHECK (rhodium_settlement_totals_match("categorySnapshot", "expenseAmountCents", "incomeAmountCents", "budgetAmountCents", "remainingAmountCents"));
ALTER TABLE "TransactionHistory" ADD CONSTRAINT "TransactionHistory_identity_check" CHECK (coalesce(version > 0 AND after->>'id' = "transactionId"
  AND rhodium_valid_transaction_snapshot(after) AND (after->>'version')::int = version
  AND (before IS NULL OR rhodium_valid_transaction_snapshot(before)), false));
ALTER TABLE "SettlementHistory" ADD CONSTRAINT "SettlementHistory_month_check" CHECK (extract(day FROM month) = 1 AND month BETWEEN DATE '0001-01-01' AND DATE '9999-12-01'),
  ADD CONSTRAINT "SettlementHistory_identity_check" CHECK (coalesce(revision > 0 AND left(snapshot->>'month',7) = to_char(month,'YYYY-MM')
    AND rhodium_valid_settlement_snapshot(snapshot) AND (snapshot->>'revision')::int = revision, false));

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Transaction_note_search_idx" ON "Transaction" USING GIN (note gin_trgm_ops);
CREATE INDEX "Category_name_search_idx" ON "Category" USING GIN (name gin_trgm_ops);
CREATE INDEX "Subscription_name_search_idx" ON "Subscription" USING GIN (name gin_trgm_ops);
CREATE INDEX "Transaction_page_order_idx" ON "Transaction" ("deletedAt", "occurredOn" DESC, "createdAt" DESC, id DESC);
