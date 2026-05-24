import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { successResponse, unauthorizedResponse, serverError } from "@/lib/api-response";
import { isSessionActive } from "@/lib/session";

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return unauthorizedResponse();
  const payload = verifyToken(token);
  if (!payload) return unauthorizedResponse();

  try {
    if (!(await isSessionActive(token))) {
      return unauthorizedResponse("Session expired or revoked");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        city: { include: { country: true, cityCurrencies: { include: { currency: true } } } },
      },
    });

    if (!user || !user.isActive) return unauthorizedResponse("User not found or inactive");

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
    // Database down - return JWT data so user doesn't get logged out
    return successResponse({
      id: payload.userId,
      username: payload.username,
      fullName: payload.username,
      role: payload.role,
      cityId: payload.cityId || null,
      cityName: null,
      countryId: null,
      countryName: null,
      currencies: [],
    });
  }
}
