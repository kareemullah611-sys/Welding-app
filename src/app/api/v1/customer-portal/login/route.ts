import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { comparePassword, getJwtExpirySeconds } from "@/lib/auth";
import { errorResponse, successResponse, validationError } from "@/lib/api-response";
import { checkRateLimit, rejectIfRateLimited } from "@/lib/rate-limit";
import { getClientIP } from "@/lib/middleware";
import { generateCustomerPortalToken, setCustomerPortalCookie } from "@/lib/customer-portal-auth";
import { z } from "zod";

const customerPortalLoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1),
});

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  try {
    const body = await request.json();
    const parsed = customerPortalLoginSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid credentials format", parsed.error.errors);

    const username = parsed.data.username.trim().toLowerCase();
    const blocked = await rejectIfRateLimited(`customer-portal-login:${ip}`, 10, 15 * 60 * 1000);
    if (blocked) return blocked;
    const usernameBlocked = await rejectIfRateLimited(`customer-portal-login-user:${username}`, 10, 15 * 60 * 1000);
    if (usernameBlocked) return usernameBlocked;

    const customer = await prisma.customer.findFirst({
      where: {
        portalUsername: username,
        portalAccessEnabled: true,
        isActive: true,
      },
      include: { city: { select: { id: true, name: true } } },
    });

    if (!customer?.portalPasswordHash) {
      await checkRateLimit(`customer-portal-login:${ip}`, 10, 15 * 60 * 1000);
      await checkRateLimit(`customer-portal-login-user:${username}`, 10, 15 * 60 * 1000);
      return errorResponse("AUTH_FAILED", "Invalid username or password", 401);
    }

    const valid = await comparePassword(parsed.data.password, customer.portalPasswordHash);
    if (!valid) {
      await checkRateLimit(`customer-portal-login:${ip}`, 10, 15 * 60 * 1000);
      await checkRateLimit(`customer-portal-login-user:${username}`, 10, 15 * 60 * 1000);
      return errorResponse("AUTH_FAILED", "Invalid username or password", 401);
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: { portalLastLoginAt: new Date() },
    });

    const token = generateCustomerPortalToken({
      customerId: customer.id,
      cityId: customer.cityId,
      username,
      type: "customer_portal",
    });
    const response = successResponse({
      customer: {
        id: customer.id,
        name: customer.name,
        cityName: customer.city.name,
      },
    });
    setCustomerPortalCookie(response, request, token, getJwtExpirySeconds());
    return response;
  } catch (error) {
    console.error("Customer portal login error:", error);
    return errorResponse("SERVER_ERROR", "An error occurred during login", 500);
  }
}
