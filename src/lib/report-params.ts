import prisma from "@/lib/prisma";
import { buildDateRange } from "@/lib/date-range";

export type DateParamParse = { date?: string; errorMessage?: string };
export type CityIdParamParse = { cityId?: number; errorMessage?: string };

// Business dates must be YYYY-MM-DD real calendar dates; anything else is a
// structured validation error (never a thrown 500).
export function parseBusinessDateParam(value: string | null | undefined, fieldName: string): DateParamParse {
  if (value == null || value === "") return {};
  try {
    buildDateRange(value, value);
    return { date: value };
  } catch {
    return { errorMessage: `Invalid ${fieldName}` };
  }
}

// city_id must be a positive integer that references an existing city —
// never silently treated as "all cities" and never a 200 with a dead id.
export async function parseCityIdParam(value: string | null | undefined): Promise<CityIdParamParse> {
  if (value == null || value === "") return {};
  if (!/^[0-9]+$/.test(value)) return { errorMessage: "Invalid city_id" };
  const id = Number(value);
  if (id <= 0) return { errorMessage: "Invalid city_id" };
  const city = await prisma.city.findUnique({ where: { id }, select: { id: true } });
  if (!city) return { errorMessage: `City ${id} not found` };
  return { cityId: id };
}
