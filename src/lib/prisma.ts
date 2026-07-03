import { PrismaClient } from "@prisma/client";
import { getCurrentPrismaTransaction } from "@/lib/prisma-request-context";
import { decryptSensitiveFields, encryptAccountNumberInData } from "@/lib/sensitive-encryption";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (!globalForPrisma.prisma) {
  prismaClient.$use(async (params, next) => {
    if (params.model === "BankAccount" || params.model === "SuperAdminBankAccount") {
      if (params.args?.data) encryptAccountNumberInData(params.args.data);
      if (params.args?.create) encryptAccountNumberInData(params.args.create);
      if (params.args?.update) encryptAccountNumberInData(params.args.update);
    }
    const result = await next(params);
    return decryptSensitiveFields(result);
  });
}

export const prisma = new Proxy(prismaClient, {
  get(target, prop) {
    const transaction = getCurrentPrismaTransaction();
    if (transaction && prop === "$transaction") {
      return async (input: unknown) => {
        if (typeof input === "function") return input(transaction);
        if (Array.isArray(input)) return Promise.all(input);
        throw new TypeError("Unsupported transaction input");
      };
    }

    const source = transaction && prop in transaction ? transaction : target;
    const value = Reflect.get(source, prop);
    return typeof value === "function" ? value.bind(source) : value;
  },
}) as PrismaClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prismaClient;

export default prisma;
