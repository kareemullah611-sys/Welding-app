import { NextResponse } from "next/server";

/** Lightweight keep-alive probe — no DB. Use for UptimeRobot / GitHub cron (Render free tier). */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    live: true,
    service: "welding-app",
    checkedAt: new Date().toISOString(),
  });
}
