/** Safe error text for API JSON responses — hides internals in production. */
export function clientErrorMessage(err: unknown, fallback = "An error occurred"): string {
  if (process.env.NODE_ENV !== "production") {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "string" && err) return err;
  }
  return fallback;
}
