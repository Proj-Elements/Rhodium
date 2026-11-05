-- 报销：已报销的支出保留在账本里，但不再计入本月支出与预算。
-- 可空时间戳与 deletedAt/archivedAt 的语义一致：记录“何时发生”，置空即撤销。
ALTER TABLE "Transaction" ADD COLUMN "reimbursedAt" TIMESTAMP(3);
