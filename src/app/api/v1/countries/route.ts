import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const countries = await prisma.country.findMany({
      include: { _count: { select: { cities: true } } },
      orderBy: { name: "asc" },
    });

    return successResponse(
      countries.map((c) => ({
        id: c.id, name: c.name, code: c.code, citiesCount: c._count.cities,
      }))
    );
  } catch (error) {
    return serverError();
  }
});
