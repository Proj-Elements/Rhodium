export type CategoryDTO = {
  id: string;
  version: number;
  name: string;
  type: "EXPENSE" | "INCOME" | "BOTH";
  icon: string | null;
  isSystem: boolean;
  sortOrder: number;
  archivedAt: string | null;
  billingPauses?: { start: string; end: string | null }[];
};

export type TransactionDTO = {
  id: string;
  version: number;
  deletedAt: string | null;
  monthLocked?: boolean;
  type: "EXPENSE" | "INCOME";
  amountCents: number;
  occurredOn: string;
  category: CategoryDTO;
  note: string | null;
  source: "MANUAL" | "SUBSCRIPTION";
  /** 已报销的支出：保留在账本里但不再计入支出与预算；null = 未报销。 */
  reimbursedAt: string | null;
  subscriptionId: string | null;
  subscriptionMonth: string | null;
  subscription?: { name: string } | null;
};

export type DashboardDTO = {
  month: string;
  today: string;
  focusDate: string;
  monthStatus: "past" | "current" | "future";
  locked: boolean;
  readOnly: boolean;
  budget: { amountCents: number } | null;
  /** Where the effective budget comes from: explicit month row, preset, or unset. */
  budgetSource: "month" | "preset" | "none" | "settlement";
  budgetVersion: string;
  /** 账面支出，包含已报销的支出；与月度汇总口径一致。 */
  expenseCents: number;
  /** 本月未被报销的支出总额（报销属于回收，不算花掉）。 */
  outOfPocketCents: number;
  /** 本月已报销的支出总额。 */
  reimbursedCents: number;
  /** 报销记录数。 */
  reimbursedCount: number;
  incomeCents: number;
  remainingCents: number | null;
  usagePercent: number | null;
  focusDateExpenseCents: number;
  focusDateIncomeCents: number;
  transactionCount: number;
  expenseTransactionCount: number;
  daysElapsed: number;
  daysInMonth: number;
  categoryBreakdown: { categoryId: string; categoryName: string; amountCents: number }[];
  recentExpenses: { date: string; amountCents: number; incomeCents: number }[];
  recentTransactions: TransactionDTO[];
};

export type SubscriptionDTO = {
  id: string;
  version: number;
  name: string;
  amountCents: number;
  billingDay: number;
  categoryId: string;
  category: CategoryDTO;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
  note: string | null;
  billingPauses: { start: string; end: string | null }[];
  billingHistory: {
    effectiveMonth: string;
    amountCents: number;
    billingDay: number;
    categoryId: string;
    name: string;
    note: string | null;
    startMonth: string;
    endMonth: string | null;
  }[];
  billingEffectiveMonth: string | null;
  currentAmountCents: number | null;
  currentCategory: CategoryDTO | null;
};

export type SettlementCategorySnapshot = {
  categoryId: string;
  categoryName: string;
  expenseCents: number;
  outOfPocketCents: number;
  incomeCents: number;
};
