import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

import { parseJwtExpiryMs, jwtExpirySeconds as parseJwtExpirySeconds } from "@/lib/jwt-expiry";

const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";
const MIN_JWT_SECRET_LENGTH = 32;
const JWT_ISSUER = "welding-app";
const JWT_AUDIENCE = "welding-app-api";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable must be set. Refusing to use an insecure default.");
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters.`);
  }
  return secret;
}

export function getJwtExpiryMs(): number {
  return parseJwtExpiryMs(JWT_EXPIRY);
}

export function getJwtExpirySeconds(): number {
  return parseJwtExpirySeconds(JWT_EXPIRY);
}

export function shouldUseSecureAuthCookie(request?: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")) return true;
  if (process.env.VERCEL_URL) return true;
  if (request?.nextUrl.protocol === "https:") return true;
  if (request?.headers.get("x-forwarded-proto") === "https") return true;
  return false;
}

export interface JWTPayload {
  userId: number;
  username: string;
  role: "super_admin" | "city_admin";
  cityId: number | null;
  countryId: number | null;
}

function normalizeJwtPayload(payload: unknown): JWTPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const decoded = payload as Record<string, unknown>;
  if (typeof decoded.userId !== "number") return null;
  if (typeof decoded.username !== "string") return null;
  if (decoded.role !== "super_admin" && decoded.role !== "city_admin") return null;
  return {
    userId: decoded.userId,
    username: decoded.username,
    role: decoded.role,
    cityId: typeof decoded.cityId === "number" ? decoded.cityId : null,
    countryId: typeof decoded.countryId === "number" ? decoded.countryId : null,
  };
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRY as any,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: "HS256",
  });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return normalizeJwtPayload(jwt.verify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  // Also check cookies for web app
  const cookieToken = request.cookies.get("token")?.value;
  return cookieToken || null;
}

export function getUserFromRequest(request: NextRequest): JWTPayload | null {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}
