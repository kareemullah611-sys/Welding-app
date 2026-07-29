import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-response";
import { clearCustomerPortalCookie } from "@/lib/customer-portal-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const response = successResponse({ message: "Logged out successfully" });
  clearCustomerPortalCookie(response, request);
  return response;
}
