/** Stable, bundled icon IDs shared by the picker, API and backup format. */
export const categoryIconLabels = {
  food: "餐饮",
  drink: "饮品",
  coffee: "咖啡",
  transport: "交通",
  study: "学习",
  entertainment: "娱乐",
  shopping: "购物",
  health: "健康",
  home: "居家",
  work: "工作",
  wallet: "钱包",
  income: "收入",
  leaf: "自然",
  repeat: "订阅",
  tag: "标签",
  other: "其他",
} as const;

export type CategoryIconName = keyof typeof categoryIconLabels;
export const categoryIconNames = Object.keys(categoryIconLabels) as [CategoryIconName, ...CategoryIconName[]];

export function isCategoryIconName(value: unknown): value is CategoryIconName {
  return typeof value === "string" && Object.hasOwn(categoryIconLabels, value);
}

const expenseRules: Array<[RegExp, CategoryIconName]> = [
  [/餐饮|吃饭|早餐|午餐|晚餐|美食/, "food"],
  [/饮料|零食|咖啡|奶茶|饮品/, "drink"],
  [/交通|公交|地铁|打车|出行/, "transport"],
  [/学习|教育|书|课程|资料/, "study"],
  [/娱乐|游戏|电影|音乐|玩乐/, "entertainment"],
  [/购物|服饰|网购|商场/, "shopping"],
  [/医疗|医药|看病|健康/, "health"],
  [/住房|居住|房租|生活/, "home"],
];

/** Explicit choices win; legacy categories retain their name-based defaults. */
export function resolveCategoryIcon(categoryName: string, type: "EXPENSE" | "INCOME" | "BOTH", icon?: string | null): CategoryIconName {
  if (isCategoryIconName(icon)) return icon;
  if (type === "INCOME") return /兼职|工作|工资|薪资/.test(categoryName) ? "work" : "income";
  return expenseRules.find(([pattern]) => pattern.test(categoryName))?.[1] ?? "other";
}
