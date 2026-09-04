"use client";

import { addMonths } from "@/lib/domain";
import { useToday } from "@/lib/use-today";
import { Icon } from "@/components/icon";

function label(month: string) {
  const [year, value] = month.split("-");
  return `${year} / ${value}`;
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const today = useToday();
  const currentMonth = today?.slice(0, 7);

  // The owning page resolves the month on the client too, so render an inert
  // placeholder of the same shape until it does — this is what keeps the
  // prerendered HTML identical to the first hydrated render.
  if (!month) {
    return <div className="month-switcher" aria-label="选择月份" aria-busy="true">
      <button type="button" disabled aria-label="上一个月"><span className="chevron-left"><Icon name="chevron" size={15} /></span></button>
      <strong>—— / ——</strong>
      <button type="button" disabled aria-label="下一个月"><span className="chevron-right"><Icon name="chevron" size={15} /></span></button>
    </div>;
  }

  return <div className="month-switcher" aria-label="选择月份">
    <button type="button" onClick={() => onChange(addMonths(month, -1))} aria-label="上一个月"><span className="chevron-left"><Icon name="chevron" size={15} /></span></button>
    <strong>{label(month)}</strong>
    <button type="button" onClick={() => onChange(addMonths(month, 1))} aria-label="下一个月"><span className="chevron-right"><Icon name="chevron" size={15} /></span></button>
    {currentMonth && month !== currentMonth && <button type="button" className="month-switcher-current" onClick={() => onChange(currentMonth)}>本月</button>}
  </div>;
}
