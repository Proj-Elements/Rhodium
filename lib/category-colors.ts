export const categoryPalette = [
  { color: "var(--blue)", surface: "#edf3fb" },
  { color: "var(--lavender)", surface: "#f4effa" },
  { color: "var(--gold)", surface: "#fbf3e5" },
  { color: "var(--mint)", surface: "#edf7ee" },
  { color: "var(--peach)", surface: "#fbefea" },
  { color: "var(--muted)", surface: "var(--canvas)" },
];

export function getCategoryColor(categoryId: string) {
  const hash = [...categoryId].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  return categoryPalette[hash % categoryPalette.length];
}
