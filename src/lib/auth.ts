import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable must be set in production. Refusing to start with an insecure default.");
  }
  console.warn("⚠️  JWT_SECRET is not set. Using an insecure default secret — DO NOT run this in production without setting JWT_SECRET in your environment.");
  return "dev-secret-change-in-production";
})();
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";

export interface JWTPayload {
  userId: number;
  username: string;
  role: "super_admin" | "city_admin";
  cityId: number | null;
  countryId: number | null;
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY as any });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
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
