import { JWTPayload } from "@/lib/auth";

/**
 * The Delivery module is per-city, so every route needs the same two facts: that
 * the caller is a city admin, and which city they belong to.
 *
 * It is a city_admin-only feature on purpose. A super_admin has no city of their
 * own (`cityId` is null), and the Delivery service's service token deliberately has
 * no all-cities mode — so there is no honest city to send. Rather than invent an
 * "all cities" behaviour that the integration was not designed for, super_admin is
 * refused until it is asked for explicitly.
 *
 * Kept in one place so the rule cannot drift between the read and write routes.
 */
export function deliveryCityScope(user: JWTPayload): { ok: true; cityId: number } | { ok: false; message: string } {
  if (user.role !== "city_admin") {
    return { ok: false, message: "Delivery is available to city admins" };
  }
  if (!user.cityId) {
    // A city_admin with no city would otherwise be able to scope to anything.
    return { ok: false, message: "Your account is not assigned to a city" };
  }
  return { ok: true, cityId: user.cityId };
}