const categoryPalette = [
  { color: "var(--blue)", surface: "var(--cat-blue-surface)" },
  { color: "var(--peach)", surface: "var(--cat-peach-surface)" },
  { color: "var(--gold)", surface: "var(--cat-gold-surface)" },
  { color: "var(--mint)", surface: "var(--cat-mint-surface)" },
  { color: "var(--lavender)", surface: "var(--cat-lavender-surface)" },
  { color: "var(--teal)", surface: "var(--cat-teal-surface)" },
  { color: "var(--rose)", surface: "var(--cat-rose-surface)" },
  { color: "var(--indigo)", surface: "var(--cat-indigo-surface)" },
  { color: "var(--lime)", surface: "var(--cat-lime-surface)" },
  { color: "var(--cyan)", surface: "var(--cat-cyan-surface)" },
  { color: "var(--coral)", surface: "var(--cat-coral-surface)" },
  { color: "var(--plum)", surface: "var(--cat-plum-surface)" },
  { color: "var(--olive)", surface: "var(--cat-olive-surface)" },
  { color: "var(--navy)", surface: "var(--cat-navy-surface)" },
  { color: "var(--seafoam)", surface: "var(--cat-seafoam-surface)" },
  { color: "var(--sand)", surface: "var(--cat-sand-surface)" },
];

function categoryColorIndex(categoryId: string) {
  const hash = [...categoryId].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  return hash % categoryPalette.length;
}

export function getCategoryColor(categoryId: string) {
  return categoryPalette[categoryColorIndex(categoryId)];
}

/** Assign distinct colors in ID order so sorting amounts or filtering does not recolor categories. */
export function getCategoryColors(categoryIds: readonly string[]) {
  const colors = new Map<string, { color: string; surface: string }>();
  const usedSlots = new Set<number>();

  for (const id of [...new Set(categoryIds)].sort()) {
    if (usedSlots.size === categoryPalette.length) {
      const hue = (((colors.size - categoryPalette.length) * 137.508 + 15) % 360).toFixed(3);
      colors.set(id, {
        color: `oklch(var(--category-color-lightness) 0.12 ${hue})`,
        surface: `oklch(var(--category-surface-lightness) 0.025 ${hue})`,
      });
      continue;
    }

    let index = categoryColorIndex(id);
    while (usedSlots.has(index)) index = (index + 1) % categoryPalette.length;
    usedSlots.add(index);
    colors.set(id, categoryPalette[index]);
  }

  return colors;
}
