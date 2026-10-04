/**
 * delivery-service.ts — the only place welding-app talks to the Delivery service.
 *
 * WHY A PROXY AND NOT A DIRECT BROWSER CALL
 * The Delivery service authenticates this integration with DELIVERY_SERVICE_TOKEN,
 * a service-to-service credential. If the browser called it directly, that token
 * would have to reach the client bundle and any logged-in user could read it and
 * then act for any city they liked. So every call goes through a server route in
 * this app, and the token stays here, on the server, only.
 *
 * WHAT THE TOKEN CANNOT DO
 * It is not a user login and cannot sign in. It cannot record a delivery. And it
 * has no "all cities" mode: every call below must name one concrete city, and the
 * delivery service independently refuses anything outside it. That is why `cityId`
 * is a required argument on every function here rather than an optional filter.
 *
 * WHERE cityId COMES FROM
 * Always from the caller's own session, never from request input. The API routes
 * read `user.cityId` off the verified JWT and pass it down; no route accepts a
 * city from the client.
 */

/**
 * Server-only guard.
 *
 * This module holds DELIVERY_SERVICE_TOKEN, so it must never end up in a browser
 * bundle. `server-only` is not a dependency here, so fail loudly at load time
 * instead: if anything ever imports this from a client component, the app breaks
 * immediately rather than quietly shipping the credential.
 */
if (typeof window !== "undefined") {
  throw new Error("delivery-service.ts is server-only and must not be imported from client code");
}

export interface DeliveryParty {
  id: number;
  username: string;
  fullName: string;
  cityId: number;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface DeliveryLine {
  saleItemId: number;
  productName: string;
  orderedCartons: number;
  deliveredCartons: number;
}

export interface DeliverySaleRow {
  saleId: number;
  voucherNo: string;
  customerName: string;
  cityName: string;
  saleDate: string;
  status: string;
  isAssigned: boolean;
  isCompleted: boolean;
  totalOrderedCartons: number;
  totalDeliveredCartons: number;
  phaseCount: number;
  lastPhaseAt: string | null;
  lines?: DeliveryLine[];
}

export interface PhaseEvent {
  id: number;
  phaseType: string;
  cartonQty: number;
  reason: string | null;
  note: string | null;
  actorName: string;
  createdAt: string;
}

class DeliveryServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DeliveryServiceError";
  }
}

/**
 * Missing configuration is a deployment problem, not a user error. Failing loudly
 * here beats silently returning an empty page, which an admin would reasonably
 * read as "no deliveries yet".
 */
function serviceConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.DELIVERY_API_URL?.replace(/\/+$/, "");
  const token = process.env.DELIVERY_SERVICE_TOKEN;
  if (!baseUrl || !token) {
    throw new DeliveryServiceError(
      "Delivery integration is not configured (DELIVERY_API_URL / DELIVERY_SERVICE_TOKEN)",
      "DELIVERY_NOT_CONFIGURED",
      503,
    );
  }
  return { baseUrl, token };
}

async function call<T>(path: string, cityId: number, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = serviceConfig();
  if (!Number.isInteger(cityId) || cityId <= 0) {
    throw new DeliveryServiceError("A concrete city is required", "CITY_REQUIRED", 400);
  }

  const res = await fetch(`${baseUrl}${path}${path.includes("?") ? "&" : "?"}cityId=${cityId}`, {
    ...init,
    headers: {
      "x-delivery-service-token": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    // Delivery state changes as other people work; never serve a stale page.
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string;
    error?: { code?: string; message?: string };
  };

  if (!res.ok || !body.success) {
    throw new DeliveryServiceError(
      body.error?.message ?? body.message ?? "The Delivery service could not complete that request",
      body.error?.code ?? "DELIVERY_UPSTREAM_ERROR",
      res.status,
    );
  }
  return body.data as T;
}

export function fetchDeliveryParties(cityId: number): Promise<{ parties: DeliveryParty[] }> {
  return call("/api/v1/delivery/sync/parties", cityId);
}

export function fetchDeliveryStatus(cityId: number): Promise<{ sales: DeliverySaleRow[] }> {
  return call("/api/v1/delivery/sync/delivery-status", cityId);
}

export function fetchSaleDetail(cityId: number, saleId: number): Promise<{ saleId: number; voucherNo: string; phases: PhaseEvent[] }> {
  return call(`/api/v1/delivery/sync/delivery-status/${saleId}`, cityId);
}

/**
 * Create a party login. The returned password is shown to the admin once and is
 * not recoverable afterwards — the UI must display it immediately.
 */
export function createPartyUser(
  cityId: number,
  input: { fullName: string; username: string; phone?: string },
): Promise<{ id: number; username: string; generatedPassword: string | null }> {
  return call("/api/v1/delivery/sync/parties", cityId, { method: "POST", body: JSON.stringify(input) });
}

export function setPartyUserActive(cityId: number, id: number, isActive: boolean): Promise<{ id: number; isActive: boolean }> {
  return call(`/api/v1/delivery/sync/parties/${id}`, cityId, {
    method: "PATCH",
    body: JSON.stringify({ isActive }),
  });
}

export function assignSale(cityId: number, saleId: number): Promise<{ saleId: number; lineCount: number }> {
  return call("/api/v1/delivery/sync/assignments", cityId, { method: "POST", body: JSON.stringify({ saleId }) });
}

export function unassignSale(cityId: number, saleId: number): Promise<{ saleId: number }> {
  return call(`/api/v1/delivery/sync/assignments/${saleId}`, cityId, { method: "DELETE" });
}

/**
 * Turn an upstream failure into the response shape this app's routes return, so
 * the browser sees a normal error instead of a raw 500.
 */
export function deliveryErrorResponse(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof DeliveryServiceError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return { code: "DELIVERY_UPSTREAM_ERROR", message: "Could not reach the Delivery service", status: 502 };
}