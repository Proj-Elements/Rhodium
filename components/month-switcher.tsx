"use client";

import { Button, Input } from "@heroui/react";
import { addMonths } from "@/lib/domain";
import { useToday } from "@/lib/use-today";
import { IconButton } from "@/components/icon-button";

export function MonthSwitcher({ month, onChange, isDisabled = false }: { month: string; onChange: (month: string) => void; isDisabled?: boolean }) {
  const today = useToday();
  const currentMonth = today?.slice(0, 7);

  return (
    <div className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-border bg-surface px-1" role="group" aria-label="选择月份" aria-busy={!month}>
      <IconButton icon="chevron" label="上一个月" size="sm" className="rotate-90" isDisabled={!month || month <= "0001-01" || isDisabled} onPress={() => onChange(addMonths(month, -1))} />
      <Input aria-label="跳转到月份" type="month" min="0001-01" max="9999-12" value={month} className="h-8 w-[136px] min-w-0 border-0 bg-transparent text-xs tabular-nums shadow-none" disabled={isDisabled || !month} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value >= "0001-01") onChange(event.target.value); }} />
      <IconButton icon="chevron" label="下一个月" size="sm" className="-rotate-90" isDisabled={!month || month >= "9999-12" || isDisabled} onPress={() => onChange(addMonths(month, 1))} />
      {currentMonth && month && month !== currentMonth && <Button size="sm" variant="ghost" className="text-xs text-accent" isDisabled={isDisabled} onPress={() => onChange(currentMonth)}>本月</Button>}
    </div>
  );
}
