/** Keep PostgreSQL bind counts below its limit for large atomic restores. */
export function importChunks<T>(items: T[], size = 5_000): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}
