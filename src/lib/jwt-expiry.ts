/** Parse JWT_EXPIRY (e.g. "24h", "7d", "3600") to milliseconds. */
export function parseJwtExpiryMs(raw: string): number {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+)([smhd]?)$/i);
  if (!match) return 24 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  const unit = (match[2] || "s").toLowerCase();
  switch (unit) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export function jwtExpirySeconds(raw: string): number {
  return Math.max(1, Math.floor(parseJwtExpiryMs(raw) / 1000));
}
