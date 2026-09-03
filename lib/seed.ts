import { CategoryType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const defaults = [
  ["餐饮", CategoryType.EXPENSE],
  ["饮料零食", CategoryType.EXPENSE],
  ["交通", CategoryType.EXPENSE],
  ["学习", CategoryType.EXPENSE],
  ["生活", CategoryType.EXPENSE],
  ["娱乐", CategoryType.EXPENSE],
  ["购物", CategoryType.EXPENSE],
  ["医疗", CategoryType.EXPENSE],
  ["住房", CategoryType.EXPENSE],
  ["其他", CategoryType.BOTH],
  ["兼职", CategoryType.INCOME],
  ["代写", CategoryType.INCOME],
  ["其他收入", CategoryType.INCOME],
] as const;

export async function ensureDefaultCategories() {
  await prisma.category.createMany({
    data: defaults.map(([name, type], index) => ({
      name,
      type,
      isSystem: true,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });
}
