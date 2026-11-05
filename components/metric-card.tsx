import type { ReactNode } from "react";
import { Card } from "@heroui/react";
import { Icon, type IconName } from "@/components/icon";

type MetricCardProps = { label: string; value: ReactNode; detail: ReactNode; icon: IconName; tone?: "income" | "danger"; className?: string };

/** A consistently aligned financial metric; monetary values remain tabular. */
export function MetricCard({ label, value, detail, icon, tone, className = "" }: MetricCardProps) {
  return (
    <Card className={`metric-card ${className}`}>
      <div className="flex items-center justify-between gap-3"><span className="metric-label">{label}</span><span className="metric-icon"><Icon name={icon} size={17} /></span></div>
      <div><div className={`metric-value ${tone === "income" ? "text-success" : tone === "danger" ? "text-danger" : ""}`}>{value}</div><div className="metric-detail">{detail}</div></div>
    </Card>
  );
}
