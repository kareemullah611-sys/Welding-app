import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/personal-withdrawals/names?q=ali
// Returns unique withdrawnBy names for the city admin's city.
export const GET = withAuth(async (request: NextRequest, _ctx, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin" || !user.cityId) {
      return errorResponse("FORBIDDEN", "Only city admins can access withdrawee names", 403);
    }

    const q = (request.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

    const rows = await prisma.personalWithdrawal.findMany({
      where: {
        cityId: user.cityId,
        withdrawnBy: { not: null },
      },
      select: { withdrawnBy: true },
      orderBy: { withdrawnBy: "asc" },
      distinct: ["withdrawnBy"],
      take: 300,
    });

    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of rows) {
      const raw = (row.withdrawnBy || "").trim();
      if (!raw) continue;
      const normalized = raw.toLowerCase();
      if (seen.has(normalized)) continue;
      if (q && !normalized.includes(q)) continue;
      seen.add(normalized);
      names.push(raw);
    }

    return successResponse(names);
  } catch (error) {
    console.error("Withdrawal names GET error:", error);
    return serverError();
  }
});
