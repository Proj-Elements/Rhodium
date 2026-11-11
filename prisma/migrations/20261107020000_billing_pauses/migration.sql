ALTER TABLE "Category" ADD COLUMN "billingPauses" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Subscription" ADD COLUMN "billingPauses" JSONB NOT NULL DEFAULT '[]';

UPDATE "Subscription" SET "billingPauses" = jsonb_build_array(jsonb_build_object('start', to_char("startMonth", 'YYYY-MM-DD'), 'end', NULL)) WHERE NOT "active";
UPDATE "Category" SET "billingPauses" = '[{"start":"0001-01-01","end":null}]' WHERE "archivedAt" IS NOT NULL;
