export type CategoryDTO = {
  id: string;
  name: string;
  type: "EXPENSE" | "INCOME" | "BOTH";
  isSystem: boolean;
  sortOrder: number;
  archivedAt: string | null;
};

export type TransactionDTO = {
  id: string;
  type: "EXPENSE" | "INCOME";
  amountCents: number;
  occurredOn: string;
  category: CategoryDTO;
  note: string | null;
  source: "MANUAL" | "SUBSCRIPTION";
  subscriptionId: string | null;
  subscriptionMonth: string | null;
  subscription?: { name: string } | null;
};

export type DashboardDTO = {
  month: string;
  today: string;
  focusDate: string;
  monthStatus: "past" | "current" | "future";
  budget: { amountCents: number } | null;
  /** Where the effective budget comes from: explicit month row, preset, or unset. */
  budgetSource: "month" | "preset" | "none";
  expenseCents: number;
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
  name: string;
  amountCents: number;
  billingDay: number;
  categoryId: string;
  category: CategoryDTO;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
  note: string | null;
};
