import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { comparePassword, generateToken, getJwtExpiryMs, getJwtExpirySeconds } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse } from "@/lib/api-response";
import { checkRateLimit, rejectIfRateLimited } from "@/lib/rate-limit";
import { allowSuperAdminInLockedDeployment, isAllowedCityName, isCityLockedDeployment } from "@/lib/deployment-profile";
import { hashToken } from "@/lib/session";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  let browser = "Unknown Browser";
  let os = "Unknown OS";

  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/")) browser = "Safari";
  else if (ua.includes("Opera") || ua.includes("OPR/")) browser = "Opera";

  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  return `${browser} on ${os}`;
}

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return validationError("Invalid credentials format", parsed.error.errors);
    }

    const { username, password } = parsed.data;

    const blocked = await rejectIfRateLimited(`login:${ip}`, 10, 15 * 60 * 1000);
    if (blocked) return blocked;

    let user;
    try {
      user = await prisma.user.findUnique({
        where: { username },
        include: {
          city: { include: { country: true, cityCurrencies: { include: { currency: true } } } },
        },
      });
    } catch (dbError) {
      // DB is unavailable (e.g. Neon sleeping) — don't count this as a failed
      // login attempt so the user isn't locked out when the DB comes back.
      console.error("Login DB error:", dbError);
      return errorResponse("SERVER_ERROR", "Database unavailable, please try again in a moment", 503);
    }

    if (!user || !user.isActive) {
      // Wrong username — this IS a genuine failed attempt, count it
      await checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
      return errorResponse("AUTH_FAILED", "Invalid username or password", 401);
    }

    const passwordValid = await comparePassword(password, user.passwordHash);
    if (!passwordValid) {
      // Wrong password — count it
      await checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
      return errorResponse("AUTH_FAILED", "Invalid username or password", 401);
    }

    if (isCityLockedDeployment()) {
      if (user.role === "super_admin" && !allowSuperAdminInLockedDeployment()) {
        return errorResponse("AUTH_FAILED", "This package only allows city users", 401);
      }
      if (user.role === "city_admin" && !isAllowedCityName(user.city?.name)) {
        return errorResponse("AUTH_FAILED", "This package is restricted to another city", 401);
      }
    }

    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      cityId: user.cityId,
      countryId: user.city?.countryId || null,
    });

    // Create session record
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = request.headers.get("user-agent");

    try {
      await prisma.userSession.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          deviceInfo: parseUserAgent(userAgent),
          ipAddress,
          expiresAt: new Date(Date.now() + getJwtExpiryMs()),
        },
      });
    } catch (sessionError) {
      // Neon cold start / transient DB errors — retry before rejecting login.
      let sessionCreated = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(800 * (attempt + 1));
        try {
          await prisma.userSession.create({
            data: {
              userId: user.id,
              tokenHash: hashToken(token),
              deviceInfo: parseUserAgent(userAgent),
              ipAddress,
              expiresAt: new Date(Date.now() + getJwtExpiryMs()),
            },
          });
          sessionCreated = true;
          break;
        } catch (retryError) {
          console.error(`Session creation retry ${attempt + 1} failed:`, retryError);
        }
      }
      if (!sessionCreated) {
        console.error("Session creation error:", sessionError);
        return errorResponse(
          "SERVER_ERROR",
          "Database unavailable, please try again in a moment",
          503
        );
      }
    }

    // Set cookie for web app
    const response = successResponse({
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        cityId: user.cityId,
        cityName: user.city?.name || null,
        countryId: user.city?.countryId || null,
        countryName: user.city?.country?.name || null,
        currencies: user.city?.cityCurrencies.map((cc) => cc.currency) || [],
      },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: getJwtExpirySeconds(),
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return errorResponse("SERVER_ERROR", "An error occurred during login", 500);
  }
}
