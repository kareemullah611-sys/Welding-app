/**
 * godown-access.ts
 * Checks city_godown_permissions via raw SQL (no Prisma regen needed).
 *
 * Permission model:
 *   A row (from_city_id → to_city_id) means the admin of fromCity
 *   can sell using godowns belonging to toCity.
 */

import prisma from "@/lib/prisma";

async function ensureSpecificGodownPermissionTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS city_godown_item_permissions (
      id SERIAL PRIMARY KEY,
      from_city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
      to_godown_id INTEGER NOT NULL REFERENCES godowns(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_city_godown_item_perm UNIQUE (from_city_id, to_godown_id)
    )
  `);
}

/** Returns the list of city IDs whose godowns the given city can access (excluding own city). */
export async function getAllowedGodownCityIds(fromCityId: number): Promise<number[]> {
  try {
    const rows = await prisma.$queryRaw<{ to_city_id: number }[]>`
      SELECT to_city_id
      FROM city_godown_permissions
      WHERE from_city_id = ${fromCityId}
    `;
    return rows.map((r) => Number(r.to_city_id));
  } catch {
    // Table may not exist yet (migration not run) — fail gracefully
    return [];
  }
}

/** Returns specific godown IDs the city can access from other cities. */
export async function getAllowedGodownIds(fromCityId: number): Promise<number[]> {
  try {
    await ensureSpecificGodownPermissionTable();
    const rows = await prisma.$queryRaw<{ to_godown_id: number }[]>`
      SELECT to_godown_id
      FROM city_godown_item_permissions
      WHERE from_city_id = ${fromCityId}
    `;
    return rows.map((r) => Number(r.to_godown_id));
  } catch {
    return [];
  }
}

/** Returns true if fromCityId is allowed to use godowns belonging to toCityId. */
export async function canAccessGodownCity(fromCityId: number, toCityId: number): Promise<boolean> {
  if (fromCityId === toCityId) return true; // always own city
  try {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM city_godown_permissions
      WHERE from_city_id = ${fromCityId} AND to_city_id = ${toCityId}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Returns true if fromCityId is allowed to use the specific godown (or its city). */
export async function canAccessGodown(fromCityId: number, toGodownId: number, toCityId: number): Promise<boolean> {
  if (fromCityId === toCityId) return true;
  if (await canAccessGodownCity(fromCityId, toCityId)) return true;
  try {
    await ensureSpecificGodownPermissionTable();
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM city_godown_item_permissions
      WHERE from_city_id = ${fromCityId} AND to_godown_id = ${toGodownId}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Returns all permissions as {fromCityId, toCityId} pairs — for the management UI. */
export async function getAllGodownPermissions(): Promise<{ fromCityId: number; toCityId: number }[]> {
  try {
    const rows = await prisma.$queryRaw<{ from_city_id: number; to_city_id: number }[]>`
      SELECT from_city_id, to_city_id FROM city_godown_permissions ORDER BY from_city_id, to_city_id
    `;
    return rows.map((r) => ({ fromCityId: Number(r.from_city_id), toCityId: Number(r.to_city_id) }));
  } catch {
    return [];
  }
}

export async function getAllSpecificGodownPermissions(): Promise<{ fromCityId: number; toGodownId: number }[]> {
  try {
    await ensureSpecificGodownPermissionTable();
    const rows = await prisma.$queryRaw<{ from_city_id: number; to_godown_id: number }[]>`
      SELECT from_city_id, to_godown_id
      FROM city_godown_item_permissions
      ORDER BY from_city_id, to_godown_id
    `;
    return rows.map((r) => ({ fromCityId: Number(r.from_city_id), toGodownId: Number(r.to_godown_id) }));
  } catch {
    return [];
  }
}

/** Grants fromCity access to toCityId's godowns. */
export async function grantGodownAccess(fromCityId: number, toCityId: number): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO city_godown_permissions (from_city_id, to_city_id)
    VALUES (${fromCityId}, ${toCityId})
    ON CONFLICT DO NOTHING
  `;
}

/** Revokes fromCity access to toCityId's godowns. */
export async function revokeGodownAccess(fromCityId: number, toCityId: number): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM city_godown_permissions
    WHERE from_city_id = ${fromCityId} AND to_city_id = ${toCityId}
  `;
}

export async function grantSpecificGodownAccess(fromCityId: number, toGodownId: number): Promise<void> {
  await ensureSpecificGodownPermissionTable();
  await prisma.$executeRaw`
    INSERT INTO city_godown_item_permissions (from_city_id, to_godown_id)
    VALUES (${fromCityId}, ${toGodownId})
    ON CONFLICT DO NOTHING
  `;
}

export async function revokeSpecificGodownAccess(fromCityId: number, toGodownId: number): Promise<void> {
  await ensureSpecificGodownPermissionTable();
  await prisma.$executeRaw`
    DELETE FROM city_godown_item_permissions
    WHERE from_city_id = ${fromCityId} AND to_godown_id = ${toGodownId}
  `;
}
