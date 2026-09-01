import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function lockGodownProductStock(
  db: DbClient,
  scopes: Array<{ godownId: number; productId: number }>,
): Promise<void> {
  const keys = [...new Set(scopes.map(({ godownId, productId }) => `${godownId}:${productId}`))]
    .map((key) => {
      const [godownId, productId] = key.split(":").map(Number);
      return { godownId, productId, lockId: godownId * 100000 + productId };
    })
    .sort((left, right) => left.lockId - right.lockId);

  for (const key of keys) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(31001, ${key.lockId}::int)`;
  }
}

export async function lockSaleDiscount(db: DbClient, saleId: number): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(31002, ${saleId}::int)`;
}

export async function lockIntermediaryUsdFifo(db: DbClient, intermediaryId: number): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(31003, ${intermediaryId}::int)`;
}
