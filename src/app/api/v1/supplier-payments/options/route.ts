import { NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, validationError, serverError } from "@/lib/api-response";
import { listSupplierLotPaymentOptions } from "@/lib/supplier-payment-capacity";

export const GET = withSuperAdmin(async (request: NextRequest) => {
  try {
    const supplierId = Number(request.nextUrl.searchParams.get("supplier_id") || 0);
    if (!Number.isInteger(supplierId) || supplierId <= 0) return validationError("Valid supplier is required");
    return successResponse(await listSupplierLotPaymentOptions(supplierId));
  } catch (error) {
    console.error("List supplier payment options error:", error);
    return serverError();
  }
});
