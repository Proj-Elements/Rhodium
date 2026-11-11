ALTER TABLE "Subscription" ADD COLUMN "billingHistory" JSONB NOT NULL DEFAULT '[]';

UPDATE "Subscription" SET "billingHistory" = jsonb_build_array(jsonb_build_object(
  'effectiveMonth', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM'),
  'amountCents', "amountCents",
  'billingDay', "billingDay",
  'categoryId', "categoryId",
  'name', "name",
  'note', "note",
  'startMonth', to_char("startMonth", 'YYYY-MM'),
  'endMonth', CASE WHEN "endMonth" IS NULL THEN NULL ELSE to_char("endMonth", 'YYYY-MM') END
));
