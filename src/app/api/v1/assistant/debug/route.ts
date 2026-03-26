import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // List available Gemini models for this key
  let models: string[] = [];
  let modelsError: string | null = null;
  if (apiKey) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await r.json();
      if (data.models) {
        models = data.models
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => m.name);
      } else {
        modelsError = JSON.stringify(data.error || data);
      }
    } catch (e: any) {
      modelsError = e.message;
    }
  }

  return NextResponse.json({
    ok: true,
    user: { role: user.role, username: user.username },
    env: {
      hasGeminiKey: !!apiKey,
      geminiKeyPrefix: apiKey?.slice(0, 10) ?? "MISSING",
      nodeEnv: process.env.NODE_ENV,
    },
    availableModels: models,
    modelsError,
  });
});
