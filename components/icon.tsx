"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  BookOpen,
  BriefcaseBusiness,
  BusFront,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Coffee,
  CupSoda,
  Download,
  Gamepad2,
  Grid2X2,
  HeartPulse,
  House,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Package,
  PenLine,
  Plus,
  Receipt,
  Repeat2,
  ShoppingBag,
  Settings,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Utensils,
  Upload,
  Sun,
  WalletCards,
  X,
} from "lucide-react";

export type IconName = "grid" | "receipt" | "repeat" | "calendar" | "settings" | "plus" | "arrow" | "download" | "upload" | "trash" | "edit" | "check" | "close" | "chevron" | "wallet" | "trend" | "coffee" | "target" | "spark" | "menu" | "income" | "expense" | "dots" | "clock" | "sun" | "moon" | "monitor" | "coins";

type CategoryType = "EXPENSE" | "INCOME";

const icons: Record<IconName, LucideIcon> = {
  grid: Grid2X2,
  receipt: Receipt,
  repeat: Repeat2,
  calendar: CalendarDays,
  settings: Settings,
  plus: Plus,
  arrow: ArrowRight,
  download: Download,
  upload: Upload,
  trash: Trash2,
  edit: Pencil,
  check: Check,
  close: X,
  chevron: ChevronDown,
  wallet: WalletCards,
  trend: TrendingUp,
  coffee: Coffee,
  target: Target,
  spark: Sparkles,
  menu: MoreHorizontal,
  income: ArrowUpCircle,
  expense: ArrowDownCircle,
  dots: MoreHorizontal,
  clock: Clock3,
  coins: Coins,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
};

export function Icon({ name, size = 18, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  const IconComponent = icons[name];
  return <IconComponent size={size} strokeWidth={stroke} aria-hidden="true" />;
}

const expenseCategoryIcons: Array<[RegExp, LucideIcon]> = [
  [/餐饮|吃饭|早餐|午餐|晚餐|美食/, Utensils],
  [/饮料|零食|咖啡|奶茶|饮品/, CupSoda],
  [/交通|公交|地铁|打车|出行/, BusFront],
  [/学习|教育|书|课程|资料/, BookOpen],
  [/娱乐|游戏|电影|音乐|玩乐/, Gamepad2],
  [/购物|服饰|网购|商场/, ShoppingBag],
  [/医疗|医药|看病|健康/, HeartPulse],
  [/住房|居住|房租|生活/, House],
];

const incomeCategoryIcons: Array<[RegExp, LucideIcon]> = [
  [/兼职|工作|工资|薪资/, BriefcaseBusiness],
  [/代写|稿费|写作/, PenLine],
  [/收入|红包|退款|返现/, WalletCards],
];

export function CategoryIcon({ categoryName, type, size = 17, stroke = 1.8 }: { categoryName: string; type: CategoryType; size?: number; stroke?: number }) {
  const rules = type === "INCOME" ? incomeCategoryIcons : expenseCategoryIcons;
  const IconComponent = rules.find(([pattern]) => pattern.test(categoryName))?.[1] || (type === "INCOME" ? ArrowUpCircle : Package);
  return <IconComponent size={size} strokeWidth={stroke} aria-hidden="true" />;
}
