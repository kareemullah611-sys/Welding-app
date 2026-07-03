import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    if (body && process.env.NODE_ENV === "production") {
      console.warn("CSP violation report:", body.slice(0, 4000));
    }
  } catch {}

  return new Response(null, { status: 204 });
}
