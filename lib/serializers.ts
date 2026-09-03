import { dateOnlyKey } from "@/lib/domain";

export function serializeTransaction<T extends { occurredOn: Date; subscriptionMonth: Date | null }>(transaction: T) {
  return {
    ...transaction,
    occurredOn: dateOnlyKey(transaction.occurredOn),
    subscriptionMonth: transaction.subscriptionMonth ? dateOnlyKey(transaction.subscriptionMonth) : null,
  };
}

export function serializeDateModel<T extends { month: Date }>(model: T) {
  return { ...model, month: dateOnlyKey(model.month) };
}
