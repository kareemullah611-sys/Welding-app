/** Default godown names created by prisma/seed.ts — names are fixed after bootstrap. */
export const SEED_GODOWN_NAMES = new Set([
  "Quetta Main Warehouse",
  "Quetta City Godown",
  "Lahore Central Godown",
  "Saif Uddin Main Godown",
  "Abdul Khaliq Warehouse",
  "Kandahar Main Godown",
  "Wesh Border Godown",
]);

export function isSeedGodownName(name: string): boolean {
  return SEED_GODOWN_NAMES.has(String(name || "").trim());
}
