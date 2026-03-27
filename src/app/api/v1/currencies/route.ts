import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (_request: NextRequest, _ctx, _user: JWTPayload) => {
  try {
    const currencies = await prisma.currency.findMany({ orderBy: { code: "asc" } });
    return successResponse(currencies);
  } catch {
    return serverError();
  }
});
