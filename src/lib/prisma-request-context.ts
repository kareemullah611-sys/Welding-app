import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { JWTPayload } from "@/lib/auth";

type PrismaRequestContext = {
  userRole: JWTPayload["role"];
  cityId: number | null;
  db: Prisma.TransactionClient;
};

const prismaRequestContext = new AsyncLocalStorage<PrismaRequestContext>();

export function getCurrentPrismaTransaction(): Prisma.TransactionClient | null {
  return prismaRequestContext.getStore()?.db ?? null;
}

export async function runWithPrismaRequestContext<T>(
  prismaClient: PrismaClient,
  user: Pick<JWTPayload, "role" | "cityId">,
  callback: () => Promise<T>
): Promise<T> {
  const cityId = user.cityId == null ? "" : String(user.cityId);
  return prismaClient.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.current_user_role', ${user.role}, true),
        set_config('app.current_city_id', ${cityId}, true)
    `;
    return prismaRequestContext.run(
      { userRole: user.role, cityId: user.cityId ?? null, db: tx },
      callback
    );
  });
}
