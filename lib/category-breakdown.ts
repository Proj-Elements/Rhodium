/** Rounded category share; a zero-expense month has no percentage allocation. */
export function expenseSharePercent(amountCents: number, totalExpenseCents: number): number {
  return totalExpenseCents > 0 ? Math.round((amountCents / totalExpenseCents) * 100) : 0;
}
