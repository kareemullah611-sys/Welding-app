import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (_request: NextRequest, _context: any, _user: JWTPayload) => {
  const intermediaries = await prisma.intermediary.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return Response.json(intermediaries);
});

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  const body = await request.json();
  if (!body.name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 });

  const intermediary = await prisma.intermediary.create({
    data: { name: body.name.trim(), notes: body.notes || null },
  });
  return Response.json(intermediary, { status: 201 });
});
