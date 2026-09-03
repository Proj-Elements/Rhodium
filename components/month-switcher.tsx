"use client";

import { addMonths, todayInShanghai } from "@/lib/domain";
import { Icon } from "@/components/icon";

function label(month: string) {
  const [year, value] = month.split("-");
  return `${year} / ${value}`;
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const currentMonth = todayInShanghai().slice(0, 7);
  return <div className="month-switcher" aria-label="选择月份">
    <button type="button" onClick={() => onChange(addMonths(month, -1))} aria-label="上一个月"><span className="chevron-left"><Icon name="chevron" size={15} /></span></button>
    <strong>{label(month)}</strong>
    <button type="button" onClick={() => onChange(addMonths(month, 1))} aria-label="下一个月"><span className="chevron-right"><Icon name="chevron" size={15} /></span></button>
    {month !== currentMonth && <button type="button" className="month-switcher-current" onClick={() => onChange(currentMonth)}>本月</button>}
  </div>;
}
