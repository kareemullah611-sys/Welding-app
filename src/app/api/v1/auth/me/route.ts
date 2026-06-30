import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { successResponse, serverError } from "@/lib/api-response";
import { isSessionActive } from "@/lib/session";

function loggedOutResponse(): NextResponse {
  const response = successResponse(null);
  response.cookies.set("token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return successResponse(null);
  const payload = verifyToken(token);
  if (!payload) return loggedOutResponse();

  try {
    if (!(await isSessionActive(token))) {
      return loggedOutResponse();
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        city: { include: { country: true, cityCurrencies: { include: { currency: true } } } },
      },
    });

    if (!user || !user.isActive) return loggedOutResponse();

    return successResponse({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      cityId: user.cityId,
      cityName: user.city?.name || null,
      countryId: user.city?.countryId || null,
      countryName: user.city?.country?.name || null,
      currencies: user.city?.cityCurrencies.map((cc) => cc.currency) || [],
    });
  } catch (error) {
    console.error("Auth me error:", error);
    // DB unavailable: return 5xx so the client keeps the user it already has
    // (cached/in-memory) instead of overwriting it with a degraded record that
    // drops countryName/currencies — which would make multi-currency cities
    // (e.g. Afghanistan AFN+USD) render as single-currency and hide the codes.
    // The client retries on 5xx and only logs out on 401, so the session holds.
    return serverError("Auth check temporarily unavailable");
  }
}
