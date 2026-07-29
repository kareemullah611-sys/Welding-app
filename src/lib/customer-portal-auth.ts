import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { shouldUseSecureAuthCookie } from "@/lib/auth";

const CUSTOMER_PORTAL_COOKIE = "customer_portal_token";
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";
const JWT_ISSUER = "welding-app";
const JWT_AUDIENCE = "welding-app-customer-portal";
const MIN_JWT_SECRET_LENGTH = 32;

export type CustomerPortalPayload = {
  customerId: number;
  cityId: number;
  username: string;
  type: "customer_portal";
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error("JWT_SECRET must be configured for customer portal auth");
  }
  return secret;
}

function normalizeCustomerPortalPayload(payload: unknown): CustomerPortalPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const decoded = payload as Record<string, unknown>;
  if (decoded.type !== "customer_portal") return null;
  if (typeof decoded.customerId !== "number") return null;
  if (typeof decoded.cityId !== "number") return null;
  if (typeof decoded.username !== "string") return null;
  return {
    customerId: decoded.customerId,
    cityId: decoded.cityId,
    username: decoded.username,
    type: "customer_portal",
  };
}

export function generateCustomerPortalToken(payload: CustomerPortalPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRY as any,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: "HS256",
  });
}

export function verifyCustomerPortalToken(token: string): CustomerPortalPayload | null {
  try {
    return normalizeCustomerPortalPayload(jwt.verify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    return null;
  }
}

export function getCustomerPortalTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(CUSTOMER_PORTAL_COOKIE)?.value || null;
}

export function setCustomerPortalCookie(response: Response & { cookies: any }, request: NextRequest, token: string, maxAge: number) {
  response.cookies.set(CUSTOMER_PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: shouldUseSecureAuthCookie(request),
    sameSite: "lax",
    maxAge,
    path: "/",
  });
}

export function clearCustomerPortalCookie(response: Response & { cookies: any }, request: NextRequest) {
  response.cookies.set(CUSTOMER_PORTAL_COOKIE, "", {
    httpOnly: true,
    secure: shouldUseSecureAuthCookie(request),
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

export async function getCustomerPortalCustomer(request: NextRequest) {
  const token = getCustomerPortalTokenFromRequest(request);
  if (!token) return null;
  const payload = verifyCustomerPortalToken(token);
  if (!payload) return null;
  const customer = await prisma.customer.findFirst({
    where: {
      id: payload.customerId,
      cityId: payload.cityId,
      isActive: true,
      portalAccessEnabled: true,
      portalUsername: payload.username,
    },
    include: { city: { include: { country: true } } },
  });
  return customer;
}

export const customerPortalCookieName = CUSTOMER_PORTAL_COOKIE;
