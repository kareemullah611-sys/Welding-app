import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (_request: NextRequest, _context: any, _user: JWTPayload) => {
  const intermediaries = await prisma.intermediary.findMany({
    where: {},
    orderBy: { name: "asc" },
  });
  return successResponse(intermediaries);
});

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  const body = await request.json();
  if (!body.name?.trim()) return errorResponse("VALIDATION", "Name is required", 400);

  const intermediary = await prisma.intermediary.create({
    data: { name: body.name.trim(), notes: body.notes || null },
  });
  return successResponse(intermediary, "Intermediary created", 201);
});
