CREATE TABLE "LedgerRevision" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "revision" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "LedgerRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerRevision_singleton_check" CHECK ("id" = 1 AND "revision" >= 0)
);
INSERT INTO "LedgerRevision" ("id", "revision") VALUES (1, 0);
