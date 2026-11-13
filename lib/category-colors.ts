function categoryColorIndex(categoryId: string) {
  let hash = 2_166_136_261;
  for (const character of categoryId) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507);
  hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function getCategoryColor(categoryId: string) {
  const hash = categoryColorIndex(categoryId);
  const hue = ((hash / 4_294_967_296) * 360).toFixed(6);
  return { color: `oklch(var(--category-color-lightness) 0.12 ${hue})`, surface: `oklch(var(--category-surface-lightness) 0.025 ${hue})` };
}

/** Color depends only on the category identity, including when the category set changes. */
export function getCategoryColors(categoryIds: readonly string[]) {
  const colors = new Map<string, { color: string; surface: string }>();
  for (const id of [...new Set(categoryIds)].sort()) {
    colors.set(id, getCategoryColor(id));
  }

  return colors;
}
