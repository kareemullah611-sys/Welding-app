import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ");

// GET /api/v1/personal-withdrawals/names?q=ali
// Returns unique withdrawee names for the city admin's city. Merges the
// standalone withdrawee reference table with names already used on saved
// withdrawals so existing data still surfaces.
export const GET = withAuth(async (request: NextRequest, _ctx, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin" || !user.cityId) {
      return errorResponse("FORBIDDEN", "Only city admins can access withdrawee names", 403);
    }

    const q = (request.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

    const [tableRows, withdrawalRows] = await Promise.all([
      prisma.withdraweeName.findMany({
        where: { cityId: user.cityId },
        select: { name: true },
        orderBy: { name: "asc" },
      }),
      prisma.personalWithdrawal.findMany({
        where: {
          cityId: user.cityId,
          withdrawnBy: { not: null },
        },
        select: { withdrawnBy: true },
        orderBy: { withdrawnBy: "asc" },
        take: 300,
      }),
    ]);

    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of [...tableRows, ...withdrawalRows] as { name?: string; withdrawnBy?: string | null }[]) {
      const raw = normalizeName(row.name || row.withdrawnBy || "");
      if (!raw) continue;
      const normalized = raw.toLowerCase();
      if (seen.has(normalized)) continue;
      if (q && !normalized.includes(q)) continue;
      seen.add(normalized);
      names.push(raw);
    }

    return successResponse(names.slice(0, 300));
  } catch (error) {
    console.error("Withdrawal names GET error:", error);
    return serverError();
  }
});

// POST /api/v1/personal-withdrawals/names
// Persists a standalone withdrawee name so it appears in search even before
// any withdrawal using it has been recorded.
export const POST = withAuth(async (request: NextRequest, _ctx, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin" || !user.cityId) {
      return errorResponse("FORBIDDEN", "Only city admins can create withdrawee names", 403);
    }

    const body = await request.json().catch(() => null);
    const name = normalizeName(String((body as any)?.name || ""));
    if (!name) return errorResponse("VALIDATION_ERROR", "Withdrawee name is required");
    if (name.length > 100) return errorResponse("VALIDATION_ERROR", "Name is too long (max 100 characters)");

    const created = await prisma.withdraweeName.upsert({
      where: { cityId_name: { cityId: user.cityId, name } },
      create: { cityId: user.cityId, name, createdBy: user.userId },
      update: {},
      select: { id: true, name: true },
    });

    return successResponse(created, name.length ? "Withdrawee name saved" : undefined, 201);
  } catch (error) {
    console.error("Withdrawal names POST error:", error);
    return serverError();
  }
});
