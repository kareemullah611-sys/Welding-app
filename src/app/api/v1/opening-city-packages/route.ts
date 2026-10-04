import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { journalOpeningCityDueBalance } from "@/lib/accounting";
import { assertOpeningFxEvidence } from "@/lib/opening-fx-evidence";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";
import { foreignCurrencyOwnerKey, recordForeignCurrencyRecognition } from "@/lib/foreign-currency-carrying-db";

const originalMatches = (left: number, right: number) => Math.abs(left - right) < 0.000001;
const pkrMatches = (left: number, right: number) => Math.abs(left - right) < 0.01;

function strictDate(value: unknown) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? date : null;
}

async function draftCutover(tx: any = prisma) {
  return tx.openingCutover.findFirst({ where: { status: "draft" }, orderBy: { revision: "desc" } });
}

async function requirePackage(tx: any, packageId: number, user: JWTPayload) {
  const row = await tx.openingCityPackage.findUnique({
    where: { id: packageId },
    include: { city: { select: { id: true, name: true, isActive: true } }, dueBalances: { include: { currency: true }, orderBy: { currency: { code: "asc" } } } },
  });
  if (!row || (user.role === "city_admin" && row.cityId !== user.cityId)) throw new Error("OPENING_CITY_PACKAGE_NOT_FOUND");
  return row;
}

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "city_admin" && user.role !== "super_admin") return errorResponse("FORBIDDEN", "City or super admin only", 403);
  try {
    const cutover = await draftCutover();
    if (!cutover) return successResponse({ cutover: null, packages: [] });
    const packages = await prisma.openingCityPackage.findMany({
      where: { cutoverId: cutover.id, ...(user.role === "city_admin" ? { cityId: user.cityId! } : {}) },
      include: { city: { select: { id: true, name: true } }, dueBalances: { include: { currency: true }, orderBy: { currency: { code: "asc" } } } },
      orderBy: { city: { name: "asc" } },
    });
    return successResponse({ cutover: { id: cutover.id, revision: cutover.revision }, packages });
  } catch (error) {
    console.error("Opening city packages load error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "city_admin" && user.role !== "super_admin") return errorResponse("FORBIDDEN", "City or super admin only", 403);
  try {
    const body = await request.json();
    const action = String(body.action || "");
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening-city-packages"}))`;
      const cutover = await draftCutover(tx);
      if (!cutover) throw new Error("OPENING_CUTOVER_NOT_DRAFT");

      if (action === "save_due") {
        const cityId = user.role === "city_admin" ? user.cityId! : Number(body.cityId);
        const currencyId = Number(body.currencyId);
        if (!Number.isInteger(cityId) || cityId <= 0 || !Number.isInteger(currencyId) || currencyId <= 0) throw new Error("OPENING_CITY_DUE_INVALID");
        const enabled = await tx.cityCurrency.findUnique({ where: { cityId_currencyId: { cityId, currencyId } }, include: { currency: true } });
        if (!enabled) throw new Error("OPENING_CITY_CURRENCY_NOT_ENABLED");
        let packageRow = await tx.openingCityPackage.findUnique({ where: { cutoverId_cityId: { cutoverId: cutover.id, cityId } } });
        if (!packageRow) {
          if (user.role !== "city_admin") throw new Error("OPENING_CITY_PACKAGE_NOT_FOUND");
          packageRow = await tx.openingCityPackage.create({ data: { cutoverId: cutover.id, cityId, createdBy: user.userId } });
        }
        if (user.role === "city_admin") {
          if (packageRow.status !== "draft" && packageRow.status !== "returned") throw new Error("OPENING_CITY_PACKAGE_LOCKED");
          const cityAmount = Number(body.cityAmount);
          const cityCarryingPkr = Number(body.cityCarryingPkr);
          if (body.cityAmount === "" || body.cityCarryingPkr === "" || !Number.isFinite(cityAmount) || cityAmount < 0 || !Number.isFinite(cityCarryingPkr) || cityCarryingPkr < 0) throw new Error("OPENING_CITY_DUE_INVALID");
          let fxRateToPkr: number | null = null;
          let fxRateDate: Date | null = null;
          let fxRateSource: string | null = null;
          let fxRateMetadata: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
          if (cityAmount === 0 || cityCarryingPkr === 0) {
            if (cityAmount !== 0 || cityCarryingPkr !== 0) throw new Error("OPENING_CITY_DUE_INVALID");
          } else if (enabled.currency.code === "PKR") {
            if (!pkrMatches(cityAmount, cityCarryingPkr)) throw new Error("OPENING_CITY_DUE_INVALID");
            fxRateToPkr = 1;
          } else {
            if (!isSupportedForeignCurrency(enabled.currency.code)) throw new Error("FOREIGN_CARRYING_LAYER_REQUIRED");
            fxRateToPkr = Number(body.fxRateToPkr);
            fxRateDate = strictDate(body.fxRateDate);
            if (!Number.isFinite(fxRateToPkr) || fxRateToPkr <= 0 || !fxRateDate || !pkrMatches(cityAmount * fxRateToPkr, cityCarryingPkr)) throw new Error("OPENING_CITY_DUE_INVALID");
            fxRateSource = await assertOpeningFxEvidence({
              currencyCode: enabled.currency.code,
              rate: fxRateToPkr,
              rateDate: fxRateDate,
              provider: String(body.fxRateSource || ""),
              reference: body.fxRateReference,
              approval: body.fxRateApproval,
              db: tx,
            });
            fxRateMetadata = {
              originalCurrency: enabled.currency.code,
              originalAmount: cityAmount,
              rate: fxRateToPkr,
              rateDate: fxRateDate.toISOString().slice(0, 10),
              source: fxRateSource,
              reference: body.fxRateReference ? String(body.fxRateReference).trim() : null,
            };
          }
          const due = await tx.openingCityDueBalance.upsert({
            where: { packageId_currencyId: { packageId: packageRow.id, currencyId } },
            update: { cityAmount, cityCarryingPkr, fxRateToPkr, fxRateDate, fxRateSource, fxRateMetadata, cityRecordedBy: user.userId, cityRecordedAt: new Date() },
            create: { packageId: packageRow.id, currencyId, cityAmount, cityCarryingPkr, fxRateToPkr, fxRateDate, fxRateSource, fxRateMetadata, cityRecordedBy: user.userId, cityRecordedAt: new Date() },
          });
          if (packageRow.status === "returned") await tx.openingCityPackage.update({ where: { id: packageRow.id }, data: { status: "draft", returnReason: null } });
          return { packageId: packageRow.id, cityId, recordId: due.id };
        }
        if (packageRow.status !== "submitted") throw new Error("OPENING_CITY_PACKAGE_NOT_SUBMITTED");
        const centralAmount = Number(body.centralAmount);
        const centralCarryingPkr = Number(body.centralCarryingPkr);
        if (body.centralAmount === "" || body.centralCarryingPkr === "" || !Number.isFinite(centralAmount) || centralAmount < 0 || !Number.isFinite(centralCarryingPkr) || centralCarryingPkr < 0) throw new Error("OPENING_CITY_DUE_INVALID");
        const due = await tx.openingCityDueBalance.update({
          where: { packageId_currencyId: { packageId: packageRow.id, currencyId } },
          data: { centralAmount, centralCarryingPkr, centralRecordedBy: user.userId, centralRecordedAt: new Date() },
        });
        return { packageId: packageRow.id, cityId, recordId: due.id };
      }

      const packageId = Number(body.packageId);
      if (!Number.isInteger(packageId) || packageId <= 0) throw new Error("OPENING_CITY_PACKAGE_NOT_FOUND");
      const packageRow = await requirePackage(tx, packageId, user);
      if (packageRow.cutoverId !== cutover.id) throw new Error("OPENING_CITY_PACKAGE_NOT_FOUND");

      if (action === "submit") {
        if (user.role !== "city_admin" || (packageRow.status !== "draft" && packageRow.status !== "returned")) throw new Error("OPENING_CITY_PACKAGE_LOCKED");
        const enabled = await tx.cityCurrency.findMany({ where: { cityId: packageRow.cityId }, select: { currencyId: true } });
        const recorded = new Set(packageRow.dueBalances.filter((row: any) => row.cityAmount !== null && row.cityCarryingPkr !== null).map((row: any) => row.currencyId));
        if (enabled.some((row: any) => !recorded.has(row.currencyId))) throw new Error("OPENING_CITY_DUE_INCOMPLETE");
        await tx.openingCityPackage.update({ where: { id: packageId }, data: { status: "submitted", submittedBy: user.userId, submittedAt: new Date(), returnReason: null } });
      } else if (action === "return") {
        const reason = String(body.reason || "").trim();
        if (user.role !== "super_admin" || packageRow.status !== "submitted" || !reason) throw new Error("OPENING_CITY_PACKAGE_INVALID_TRANSITION");
        await tx.openingCityPackage.update({ where: { id: packageId }, data: { status: "returned", returnReason: reason, returnedBy: user.userId, returnedAt: new Date() } });
      } else if (action === "approve") {
        if (user.role !== "super_admin" || packageRow.status !== "submitted") throw new Error("OPENING_CITY_PACKAGE_INVALID_TRANSITION");
        const enabled = await tx.cityCurrency.findMany({ where: { cityId: packageRow.cityId }, select: { currencyId: true } });
        const dueByCurrency = new Map(packageRow.dueBalances.map((row: any) => [row.currencyId, row]));
        for (const { currencyId } of enabled) {
          const due: any = dueByCurrency.get(currencyId);
          if (!due || due.cityAmount === null || due.cityCarryingPkr === null || due.centralAmount === null || due.centralCarryingPkr === null) throw new Error("OPENING_CITY_DUE_INCOMPLETE");
          if (!originalMatches(Number(due.cityAmount), Number(due.centralAmount)) || !pkrMatches(Number(due.cityCarryingPkr), Number(due.centralCarryingPkr))) throw new Error("OPENING_DUE_BALANCE_MISMATCH");
          await tx.openingCutoverEntry.upsert({
            where: { opening_cutover_entry_entity_key: { entityType: "opening_city_due_balance", entityId: due.id } },
            update: {},
            create: { cutoverId: cutover.id, entityType: "opening_city_due_balance", entityId: due.id, createdBy: user.userId },
          });
          const carryingAmountPkr = Number(due.cityCarryingPkr);
          const foreignAmount = Number(due.cityAmount);
          if (carryingAmountPkr > 0) {
            await journalOpeningCityDueBalance({ id: due.id, cityId: packageRow.cityId, carryingAmountPkr, openingDate: cutover.cutoverDate, createdBy: user.userId }, tx);
          }
          if (foreignAmount > 0 && isSupportedForeignCurrency(due.currency.code)) {
            const ratePkr = Number(due.fxRateToPkr);
            if (!due.fxRateDate || !due.fxRateSource || !(ratePkr > 0)) throw new Error("FOREIGN_CARRYING_LAYER_REQUIRED");
            const rate = { ratePkr, rateType: "historical_opening", provider: due.fxRateSource, reference: (due.fxRateMetadata as any)?.reference || null };
            await recordForeignCurrencyRecognition(tx, {
              positionKind: "asset", positionType: "other_receivable", ownerKey: foreignCurrencyOwnerKey.dueFromCity(packageRow.cityId),
              currencyCode: due.currency.code, sourceType: "opening_city_due_balance", sourceId: due.id, sourceLineKey: "due_from_city",
              recognitionDate: cutover.cutoverDate, historicalPoolDate: cutover.cutoverDate, foreignAmount, carryingAmountPkr, rate, createdBy: user.userId,
            });
            await recordForeignCurrencyRecognition(tx, {
              positionKind: "liability", positionType: "other_payable", ownerKey: foreignCurrencyOwnerKey.dueToSuperadmin(packageRow.cityId),
              currencyCode: due.currency.code, sourceType: "opening_city_due_balance", sourceId: due.id, sourceLineKey: "due_to_superadmin",
              recognitionDate: cutover.cutoverDate, historicalPoolDate: cutover.cutoverDate, foreignAmount, carryingAmountPkr, rate, createdBy: user.userId,
            });
          }
        }
        await tx.openingCityPackage.update({ where: { id: packageId }, data: { status: "approved", approvedBy: user.userId, approvedAt: new Date(), returnReason: null } });
      } else {
        throw new Error("OPENING_CITY_PACKAGE_UNKNOWN_ACTION");
      }
      return { packageId, cityId: packageRow.cityId };
    });

    await createAuditLog(user.userId, result.cityId, "opening_city_packages", result.packageId, "update", undefined, { action, ...result }, getClientIP(request));
    return successResponse(result, `Opening city package ${action.replace("_", " ")} completed`);
  } catch (error: any) {
    const messages: Record<string, string> = {
      OPENING_CUTOVER_NOT_DRAFT: "No editable opening cutover exists",
      OPENING_CITY_PACKAGE_NOT_FOUND: "Opening city package not found",
      OPENING_CITY_PACKAGE_LOCKED: "Opening city package is locked",
      OPENING_CITY_PACKAGE_NOT_SUBMITTED: "City package must be submitted before central verification",
      OPENING_CITY_PACKAGE_INVALID_TRANSITION: "Opening city package action is not allowed in its current status",
      OPENING_CITY_PACKAGE_UNKNOWN_ACTION: "Unknown opening city package action",
      OPENING_CITY_DUE_INVALID: "Due to/from Superadmin amounts must be valid non-negative values",
      OPENING_CITY_CURRENCY_NOT_ENABLED: "Currency is not enabled for this city",
      OPENING_CITY_DUE_INCOMPLETE: "Every enabled city currency requires an explicit due balance, including zero",
      OPENING_DUE_BALANCE_MISMATCH: "City Due to Superadmin does not match central Due from City in original currency and PKR carrying value",
    };
    if (messages[error?.message]) return errorResponse(error.message, messages[error.message], 409);
    console.error("Opening city package action error:", error);
    return serverError();
  }
});
