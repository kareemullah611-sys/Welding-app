import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      service: "welding-app",
      uptimeSec: Math.floor(process.uptime()),
      db: "up",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("Health check failed:", error);
    const body: Record<string, unknown> = {
      ok: false,
      service: "welding-app",
      uptimeSec: Math.floor(process.uptime()),
      db: "down",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    if (process.env.NODE_ENV !== "production") {
      body.error = error instanceof Error ? error.message : "Database unavailable";
    }
    return NextResponse.json(body, { status: 503 });
  }
}
