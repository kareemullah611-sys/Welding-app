import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { successResponse, forbiddenResponse, serverError, validationError } from "@/lib/api-response";
import { withAuth } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";
import { DEFAULT_APP_BRANDING, normalizeAppBranding } from "@/lib/app-branding";
import { updateAppBrandingSchema } from "@/lib/validations";

const APP_BRANDING_ID = 1;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const branding = await prisma.appBranding.findUnique({ where: { id: APP_BRANDING_ID } });
    return successResponse(normalizeAppBranding(branding || DEFAULT_APP_BRANDING));
  } catch (error) {
    console.error("Get app branding error:", error);
    return serverError();
  }
}

export const PUT = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return forbiddenResponse("Only superadmin can update app branding");

  try {
    const body = await request.json();
    const parsed = updateAppBrandingSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid branding data", parsed.error.errors);

    const data = normalizeAppBranding(parsed.data);
    const branding = await prisma.appBranding.upsert({
      where: { id: APP_BRANDING_ID },
      update: {
        systemName: data.systemName,
        logoUrl: data.logoUrl,
        updatedBy: user.userId,
      },
      create: {
        id: APP_BRANDING_ID,
        systemName: data.systemName,
        logoUrl: data.logoUrl,
        updatedBy: user.userId,
      },
    });

    return successResponse(normalizeAppBranding(branding), "Branding updated");
  } catch (error) {
    console.error("Update app branding error:", error);
    return serverError();
  }
});
