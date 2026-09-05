const categoryPalette = [
  { color: "var(--blue)", surface: "var(--cat-blue-surface)" },
  { color: "var(--lavender)", surface: "var(--cat-lavender-surface)" },
  { color: "var(--gold)", surface: "var(--cat-gold-surface)" },
  { color: "var(--mint)", surface: "var(--cat-mint-surface)" },
  { color: "var(--peach)", surface: "var(--cat-peach-surface)" },
  { color: "var(--muted)", surface: "var(--canvas)" },
];

export function getCategoryColor(categoryId: string) {
  const hash = [...categoryId].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  return categoryPalette[hash % categoryPalette.length];
}
