import { NextResponse } from "next/server";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown[];
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function successResponse<T>(data: T, message?: string, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data, message: message || "Success" },
    { status }
  );
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  message?: string,
  meta?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({
    success: true,
    data,
    message: message || "Success",
    pagination: {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 1,
    },
    ...(meta ? { meta } : {}),
  });
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
  details?: unknown[]
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: { code, message, details },
    },
    { status }
  );
}

export function unauthorizedResponse(message = "Unauthorized"): NextResponse {
  return errorResponse("UNAUTHORIZED", message, 401);
}

export function forbiddenResponse(message = "Access denied"): NextResponse {
  return errorResponse("FORBIDDEN", message, 403);
}

export function notFoundResponse(message = "Resource not found"): NextResponse {
  return errorResponse("NOT_FOUND", message, 404);
}

export function validationError(message: string, details?: unknown[]): NextResponse {
  return errorResponse("VALIDATION_ERROR", message, 400, details);
}

export function serverError(message = "Internal server error"): NextResponse {
  return errorResponse("SERVER_ERROR", message, 500);
}

// Parse pagination params from URL
export function getPaginationParams(searchParams: URLSearchParams): {
  page: number;
  limit: number;
  skip: number;
} {
  const pageRaw = parseInt(searchParams.get("page") || "1");
  const limitRaw = parseInt(searchParams.get("limit") || "20");
  const page = Math.max(1, isNaN(pageRaw) ? 1 : pageRaw);
  const limit = Math.min(100, Math.max(1, isNaN(limitRaw) ? 20 : limitRaw));
  return { page, limit, skip: (page - 1) * limit };
}

// Parse sort params
export function getSortParams(searchParams: URLSearchParams): {
  sort: string;
  order: "asc" | "desc";
} {
  const sort = searchParams.get("sort") || "createdAt";
  const order = (searchParams.get("order") || "desc") as "asc" | "desc";
  return { sort, order };
}

// Parse date range — returns undefined for invalid or missing dates
export function getDateRange(searchParams: URLSearchParams): {
  dateFrom?: Date;
  dateTo?: Date;
} {
  const dateFromStr = searchParams.get("date_from");
  const dateToStr = searchParams.get("date_to");
  const parseDate = (s: string | null): Date | undefined => {
    if (!s) return undefined;
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  };
  const dateFrom = parseDate(dateFromStr);
  const dateTo = dateToStr ? parseDate(dateToStr + "T23:59:59.999Z") : undefined;
  return { dateFrom, dateTo };
}
