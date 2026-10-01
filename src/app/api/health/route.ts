import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Anonymous readiness probe. The response intentionally exposes nothing beyond
// liveness: no uptime, latency, timestamp, or database detail. Operators who
// need those should read the authenticated monitoring surfaces instead.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
