import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, serverError, validationError, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const createCountrySchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code"),
}).strict();

const createCountry = withSuperAdmin(async (request, context, user) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError("Invalid JSON body");
  }
  const parsed = createCountrySchema.safeParse(body);
  if (!parsed.success) return validationError("Invalid country data", parsed.error.errors);
  const { name, code } = parsed.data;
  const country = await prisma.$transaction(async (tx) => {
      // Serialize creation so case-insensitive name checks also cover concurrent requests.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('country-create'))`;
      const existing = await tx.country.findFirst({ where: { OR: [
        { name: { equals: name, mode: "insensitive" } },
        { code: { equals: code, mode: "insensitive" } },
      ] } });
      if (existing) return null;
      const created = await tx.country.create({ data: { name, code } });
      await createAuditLog(user.userId, null, "countries", created.id, "create", undefined, { name, code }, getClientIP(request), tx);
      return created;
  });
  if (!country) return errorResponse("DUPLICATE", "Country name or code already exists", 409);
  return successResponse({ id: country.id, name: country.name, code: country.code, citiesCount: 0 }, "Country created", 201);
});

// Catch only after the RLS wrapper has rolled back its outer transaction.
export const POST: typeof createCountry = async (request, context) => {
  try {
    return await createCountry(request, context);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse("DUPLICATE", "Country name or code already exists", 409);
    }
    return serverError();
  }
};

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
