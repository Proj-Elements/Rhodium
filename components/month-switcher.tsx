"use client";

import { Button } from "@heroui/react";
import { addMonths } from "@/lib/domain";
import { useToday } from "@/lib/use-today";
import { IconButton } from "@/components/icon-button";

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const today = useToday();
  const currentMonth = today?.slice(0, 7);
  const [year, value] = month.split("-");

  return (
    <div className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-border bg-surface px-1" role="group" aria-label="选择月份" aria-busy={!month}>
      <IconButton icon="chevron" label="上一个月" size="sm" className="rotate-90" isDisabled={!month} onPress={() => onChange(addMonths(month, -1))} />
      <span className="min-w-[94px] text-center text-xs font-medium tabular-nums">{month ? `${year} 年 ${Number(value)} 月` : "选择月份"}</span>
      <IconButton icon="chevron" label="下一个月" size="sm" className="-rotate-90" isDisabled={!month} onPress={() => onChange(addMonths(month, 1))} />
      {currentMonth && month && month !== currentMonth && <Button size="sm" variant="ghost" className="text-xs text-accent" onPress={() => onChange(currentMonth)}>本月</Button>}
    </div>
  );
}
