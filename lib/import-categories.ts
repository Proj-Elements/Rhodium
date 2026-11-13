import type { Category } from "@prisma/client";
import type { NormalizedRow } from "@/lib/import-parser";
import { conflict } from "@/lib/errors";
import type { BackupPayload } from "@/lib/backup-validation";

export function indexImportCategories(categories: Category[]) {
  return {
    byId: new Map(categories.map((category) => [category.id, category])),
    byNameType: new Map(categories.map((category) => [`${category.name}|${category.type}`, category])),
    bySystemKey: new Map(categories.flatMap((category) => category.systemKey ? [[category.systemKey, category] as const] : [])),
  };
}

type CategoryIndex = ReturnType<typeof indexImportCategories>;

export function rememberImportCategory(index: CategoryIndex, category: Category) {
  const previous = index.byId.get(category.id);
  if (previous) index.byNameType.delete(`${previous.name}|${previous.type}`);
  index.byId.set(category.id, category);
  index.byNameType.set(`${category.name}|${category.type}`, category);
  if (category.systemKey) index.bySystemKey.set(category.systemKey, category);
}

export function resolveImportCategory(index: CategoryIndex, row: NormalizedRow) {
  const usable = (category: Category) => !category.archivedAt && (category.type === row.type || category.type === "BOTH");
  if (row.categoryId) {
    const existing = index.byId.get(row.categoryId);
    if (!existing || !usable(existing)) throw conflict("导入分类标识不存在、已停用或不支持该收支方向");
    return { existing, name: existing.name };
  }
  const exact = index.byNameType.get(`${row.categoryName}|${row.type}`);
  const both = index.byNameType.get(`${row.categoryName}|BOTH`);
  const existing = exact && usable(exact) ? exact : both && usable(both) ? both : undefined;
  if (existing) return { existing, name: existing.name };
  if (!row.categoryName || row.categoryName.length > 30) throw conflict("导入分类不存在，请提供不超过 30 字的分类名称");
  if (exact) throw conflict(`分类「${row.categoryName}」已停用，请先启用或使用其他分类`);
  return { existing: null, name: row.categoryName };
}

export function resolveBackupCategory(index: CategoryIndex, row: NonNullable<BackupPayload["categories"]>[number]) {
  const type = (row.type ?? "EXPENSE").toUpperCase();
  const natural = index.byNameType.get(`${row.name}|${type}`);
  const system = row.systemKey ? index.bySystemKey.get(row.systemKey) : undefined;
  if (system && natural && system.id !== natural.id) throw conflict(`系统分类「${row.name}」的名称已被其他分类占用`);
  const existing = system ?? natural;
  if (existing && row.systemKey && existing.systemKey && existing.systemKey !== row.systemKey) throw conflict(`分类「${row.name}」已有其他系统身份`);
  if (!existing && index.byId.has(row.id)) throw conflict(`分类 ID ${row.id} 已被其他分类占用`);
  return existing;
}
