-- CreateTable
CREATE TABLE "BudgetPreset" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPreset_pkey" PRIMARY KEY ("id")
);
