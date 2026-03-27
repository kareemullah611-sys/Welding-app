import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  return NextResponse.json({
    ok: true,
    user: { role: user.role, username: user.username },
    env: {
      hasDeepseekKey: !!deepseekKey,
      deepseekKeyPrefix: deepseekKey?.slice(0, 10) ?? "MISSING",
      nodeEnv: process.env.NODE_ENV,
    },
  });
});
