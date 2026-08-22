import { buildSarafiAfScheduledSnapshotDate, isSarafiAfAutoSnapshotEnabled } from "@/lib/sarafi-af-snapshot";

async function main() {
  const scheduled = buildSarafiAfScheduledSnapshotDate();
  if (!isSarafiAfAutoSnapshotEnabled()) {
    console.log(JSON.stringify({
      status: "disabled",
      provider: "SARAFI_AF",
      schedule: scheduled,
      message: "SARAFI_AF_AUTO_SNAPSHOT_ENABLED is not enabled. No provider fetch was attempted.",
    }));
    return;
  }

  throw new Error("Sarafi.af automatic fetch is not enabled for production accounting until an approved provider feed/API is configured.");
}

main().catch((error) => {
  console.error("Sarafi.af snapshot job failed:", error);
  process.exit(1);
});
