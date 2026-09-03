-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EXPENSE', 'INCOME');
CREATE TYPE "TransactionSource" AS ENUM ('MANUAL', 'SUBSCRIPTION');
CREATE TYPE "CategoryType" AS ENUM ('EXPENSE', 'INCOME', 'BOTH');

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL DEFAULT 'EXPENSE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "billingDay" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "startMonth" DATE NOT NULL,
    "endMonth" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredOn" DATE NOT NULL,
    "categoryId" TEXT NOT NULL,
    "note" TEXT,
    "source" "TransactionSource" NOT NULL DEFAULT 'MANUAL',
    "subscriptionId" TEXT,
    "subscriptionMonth" DATE,
    "subscriptionOccurrenceKey" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonthlyBudget" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonthlyBudget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonthlySettlement" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "budgetAmountCents" INTEGER NOT NULL,
    "expenseAmountCents" INTEGER NOT NULL,
    "incomeAmountCents" INTEGER NOT NULL,
    "remainingAmountCents" INTEGER,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonthlySettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Category_name_type_key" ON "Category"("name", "type");
CREATE INDEX "Category_archivedAt_sortOrder_idx" ON "Category"("archivedAt", "sortOrder");
CREATE UNIQUE INDEX "Transaction_subscriptionOccurrenceKey_key" ON "Transaction"("subscriptionOccurrenceKey");
CREATE INDEX "Transaction_occurredOn_deletedAt_idx" ON "Transaction"("occurredOn", "deletedAt");
CREATE INDEX "Transaction_categoryId_occurredOn_idx" ON "Transaction"("categoryId", "occurredOn");
CREATE INDEX "Subscription_active_startMonth_endMonth_idx" ON "Subscription"("active", "startMonth", "endMonth");
CREATE UNIQUE INDEX "MonthlyBudget_month_key" ON "MonthlyBudget"("month");
CREATE UNIQUE INDEX "MonthlySettlement_month_key" ON "MonthlySettlement"("month");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
