import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-response";
import { clearCustomerPortalCookie, getCustomerPortalCustomer } from "@/lib/customer-portal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const customer = await getCustomerPortalCustomer(request);
  if (!customer) {
    const response = successResponse(null);
    clearCustomerPortalCookie(response, request);
    return response;
  }
  return successResponse({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    cityName: customer.city.name,
    countryName: customer.city.country.name,
  });
}
