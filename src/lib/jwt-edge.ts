import { jwtVerify } from "jose/jwt/verify";

const MIN_JWT_SECRET_LENGTH = 32;
const JWT_ISSUER = "welding-app";
const JWT_AUDIENCE = "welding-app-api";
const OFFLINE_SHELL_AUDIENCE = "welding-app-offline-shell";

export interface EdgeJWTPayload {
  userId: number;
  username: string;
  role: "super_admin" | "city_admin";
  cityId: number | null;
  countryId: number | null;
}

function normalizePayload(payload: Record<string, unknown>): EdgeJWTPayload | null {
  const userId = payload.userId;
  const username = payload.username;
  const role = payload.role;
  if (typeof userId !== "number" || typeof username !== "string") return null;
  if (role !== "super_admin" && role !== "city_admin") return null;
  return {
    userId,
    username,
    role,
    cityId: typeof payload.cityId === "number" ? payload.cityId : null,
    countryId: typeof payload.countryId === "number" ? payload.countryId : null,
  };
}

/** Edge-safe JWT verification for Next.js middleware (no Node jsonwebtoken). */
export async function verifyTokenEdge(token: string): Promise<EdgeJWTPayload | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    });
    return normalizePayload(payload);
  } catch {
    return null;
  }
}

export async function verifyOfflineShellTokenEdge(token: string): Promise<EdgeJWTPayload | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: JWT_ISSUER,
      audience: OFFLINE_SHELL_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "offline_shell") return null;
    return normalizePayload(payload);
  } catch {
    return null;
  }
}
