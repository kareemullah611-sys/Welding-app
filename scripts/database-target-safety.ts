export function describeDatabaseTarget(rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || "") {
  if (!rawUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");
  const parsed = new URL(rawUrl);
  const database = parsed.pathname.replace(/^\//, "");
  if (!parsed.hostname || !database) throw new Error("Database URL must include a host and database name");
  return {
    host: parsed.hostname,
    database,
    label: `${parsed.hostname}/${database}`,
    isLocal: ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
  };
}

export function requireApplyAcknowledgement(args = process.argv.slice(2)) {
  const target = describeDatabaseTarget();
  const apply = args.includes("--apply");
  if (!apply) return { apply: false, target };
  const acknowledgement = args.find((arg) => arg.startsWith("--ack="))?.slice("--ack=".length) || "";
  if (acknowledgement !== target.label) {
    throw new Error(`Refusing write. Re-run with --apply --ack=${target.label}`);
  }
  if (!target.isLocal && !args.includes("--allow-remote")) {
    throw new Error("Refusing remote write without --allow-remote");
  }
  return { apply: true, target };
}
