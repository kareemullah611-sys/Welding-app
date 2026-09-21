import { Prisma } from "@prisma/client";
import {
  allocateForeignCurrencyLayers,
  buildForeignCurrencyExchange,
  buildForeignCurrencySettlement,
  canonicalForeignCurrencyCode,
  isSupportedForeignCurrency,
} from "@/lib/foreign-currency-carrying";

type DbClient = Prisma.TransactionClient;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

export const foreignCurrencyOwnerKey = {
  customerReceivable: (customerId: number) => `customer_receivable:${customerId}`,
  customerAdvance: (customerId: number) => `customer_advance:${customerId}`,
  cityCash: (cityId: number) => `city_cash:${cityId}`,
  cityBank: (bankAccountId: number) => `city_bank:${bankAccountId}`,
  cityCheque: (cityId: number) => `city_cheque:${cityId}`,
  haji: (cityId: number) => `haji:${cityId}`,
  superAdminCash: (accountId: number) => `super_admin_cash:${accountId}`,
  superAdminBank: (accountId: number) => `super_admin_bank:${accountId}`,
  intermediary: (intermediaryId: number) => `intermediary:${intermediaryId}`,
  intermediaryPayable: (intermediaryId: number) => `intermediary_payable:${intermediaryId}`,
  supplierPayable: (supplierId: number, lotId?: number | null) => `supplier_payable:${supplierId}${lotId ? `:lot:${lotId}` : ""}`,
  supplierAdvance: (supplierId: number) => `supplier_advance:${supplierId}`,
  shippingPayable: (shippingLineId: number, lotId?: number | null) => `shipping_payable:${shippingLineId}${lotId ? `:lot:${lotId}` : ""}`,
  shippingAdvance: (shippingLineId: number) => `shipping_advance:${shippingLineId}`,
  agentPayable: (agentId: number) => `agent_payable:${agentId}`,
  agentAdvance: (agentId: number) => `agent_advance:${agentId}`,
};

export type ForeignRateEvidence = {
  ratePkr: number;
  rateType: string;
  provider: string;
  reference?: string | null;
  conversionPath?: unknown;
};

async function currencyIdForCode(db: DbClient, inputCode: string) {
  const code = canonicalForeignCurrencyCode(inputCode);
  if (!isSupportedForeignCurrency(code)) throw new Error(`Unsupported foreign currency ${code || "UNKNOWN"}.`);
  const currency = await db.currency.findUnique({ where: { code }, select: { id: true } });
  if (!currency) throw new Error(`Currency ${code} is not configured.`);
  return { code, currencyId: currency.id };
}

export async function recordForeignCurrencyRecognition(db: DbClient, input: {
  positionKind: "asset" | "liability";
  positionType: "customer_receivable" | "city_cash" | "city_bank" | "super_admin_cash" | "super_admin_bank" | "intermediary_balance" | "supplier_payable" | "shipping_payable" | "other_receivable" | "other_payable";
  ownerKey: string;
  currencyCode: string;
  sourceType: string;
  sourceId: number;
  sourceLineKey?: string;
  recognitionDate: Date;
  historicalPoolDate: Date;
  foreignAmount: number;
  carryingAmountPkr: number;
  rate: ForeignRateEvidence;
  createdBy?: number | null;
  parentLayerId?: number | null;
}) {
  const sourceLineKey = input.sourceLineKey || "main";
  const existing = await db.foreignCurrencyCarryingLayer.findFirst({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, sourceLineKey },
  });
  if (existing) return existing;
  const { currencyId } = await currencyIdForCode(db, input.currencyCode);
  const foreignAmount = round4(input.foreignAmount);
  const carryingAmountPkr = round2(input.carryingAmountPkr);
  if (!(foreignAmount > 0) || !(carryingAmountPkr > 0) || !(input.rate.ratePkr > 0)) {
    throw new Error("Foreign amount, carrying PKR amount, and recognition rate must be greater than zero.");
  }
  const layer = await db.foreignCurrencyCarryingLayer.create({
    data: {
      positionKind: input.positionKind,
      positionType: input.positionType,
      ownerKey: input.ownerKey,
      currencyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLineKey,
      recognitionDate: input.recognitionDate,
      historicalPoolDate: input.historicalPoolDate,
      originalForeignAmount: foreignAmount,
      remainingForeignAmount: foreignAmount,
      originalCarryingAmountPkr: carryingAmountPkr,
      remainingCarryingAmountPkr: carryingAmountPkr,
      recognitionRatePkr: input.rate.ratePkr,
      rateType: input.rate.rateType,
      rateProvider: input.rate.provider,
      rateReference: input.rate.reference || null,
      conversionPathJson: input.rate.conversionPath as Prisma.InputJsonValue | undefined,
      parentLayerId: input.parentLayerId || null,
      createdBy: input.createdBy || null,
    },
  });
  await db.foreignCurrencyMovement.create({
    data: {
      movementType: "recognition",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLineKey,
      movementDate: input.recognitionDate,
      currencyId,
      targetLayerId: layer.id,
      foreignAmount,
      carryingAmountPkr,
      settlementAmountPkr: carryingAmountPkr,
      realizedFxPkr: 0,
      historicalPoolDate: input.historicalPoolDate,
      ratePkr: input.rate.ratePkr,
      rateType: input.rate.rateType,
      rateProvider: input.rate.provider,
      rateReference: input.rate.reference || null,
      conversionPathJson: input.rate.conversionPath as Prisma.InputJsonValue | undefined,
      createdBy: input.createdBy || null,
    },
  });
  return layer;
}

async function consumeLayers(db: DbClient, input: { ownerKey: string; currencyCode: string; amount: number }) {
  const { currencyId } = await currencyIdForCode(db, input.currencyCode);
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`foreign-layer:${input.ownerKey}:${currencyId}`}))`;
  const layers = await db.foreignCurrencyCarryingLayer.findMany({
    where: { ownerKey: input.ownerKey, currencyId, status: "open", remainingForeignAmount: { gt: 0 } },
    orderBy: [{ recognitionDate: "asc" }, { id: "asc" }],
  });
  const allocations = allocateForeignCurrencyLayers({
    amount: input.amount,
    layers: layers.map((layer) => ({
      id: layer.id,
      remainingForeignAmount: Number(layer.remainingForeignAmount),
      remainingCarryingAmountPkr: Number(layer.remainingCarryingAmountPkr),
      historicalPoolDate: layer.historicalPoolDate.toISOString().slice(0, 10),
    })),
  });
  for (const allocation of allocations) {
    const layer = layers.find((row) => row.id === allocation.layerId)!;
    const remainingForeignAmount = round4(Number(layer.remainingForeignAmount) - allocation.foreignAmount);
    const remainingCarryingAmountPkr = round2(Number(layer.remainingCarryingAmountPkr) - allocation.carryingAmountPkr);
    await db.foreignCurrencyCarryingLayer.update({
      where: { id: layer.id },
      data: {
        remainingForeignAmount,
        remainingCarryingAmountPkr,
        status: remainingForeignAmount === 0 ? "closed" : "open",
      },
    });
  }
  return { currencyId, allocations };
}

export async function transferForeignCurrencyLayers(db: DbClient, input: {
  sourceOwnerKey: string;
  targetOwnerKey: string;
  targetPositionType: "city_cash" | "city_bank" | "super_admin_cash" | "super_admin_bank" | "intermediary_balance" | "other_receivable";
  currencyCode: string;
  amount: number;
  sourceType: string;
  sourceId: number;
  movementDate: Date;
  createdBy?: number | null;
}) {
  const revision = await db.foreignCurrencyMovement.count({ where: { sourceType: input.sourceType, sourceId: input.sourceId, movementType: "transfer" } }) + 1;
  const { currencyId, allocations } = await consumeLayers(db, {
    ownerKey: input.sourceOwnerKey,
    currencyCode: input.currencyCode,
    amount: input.amount,
  });
  const targets = [];
  const movements = [];
  for (const [index, allocation] of allocations.entries()) {
    const sourceLineKey = `r${revision}:${index + 1}:${allocation.layerId}`;
    const ratePkr = round2(allocation.carryingAmountPkr / allocation.foreignAmount);
    const target = await recordForeignCurrencyRecognition(db, {
      positionKind: "asset",
      positionType: input.targetPositionType,
      ownerKey: input.targetOwnerKey,
      currencyCode: input.currencyCode,
      sourceType: `${input.sourceType}_target`,
      sourceId: input.sourceId,
      sourceLineKey,
      recognitionDate: input.movementDate,
      historicalPoolDate: new Date(`${allocation.historicalPoolDate}T00:00:00.000Z`),
      foreignAmount: allocation.foreignAmount,
      carryingAmountPkr: allocation.carryingAmountPkr,
      rate: { ratePkr, rateType: "carrying_transfer", provider: "HISTORICAL_CARRYING_LAYER", reference: `layer:${allocation.layerId}` },
      createdBy: input.createdBy,
      parentLayerId: allocation.layerId,
    });
    const movement = await db.foreignCurrencyMovement.create({
      data: {
        movementType: "transfer",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey,
        movementDate: input.movementDate,
        currencyId,
        sourceLayerId: allocation.layerId,
        targetLayerId: target.id,
        foreignAmount: allocation.foreignAmount,
        carryingAmountPkr: allocation.carryingAmountPkr,
        settlementAmountPkr: allocation.carryingAmountPkr,
        realizedFxPkr: 0,
        historicalPoolDate: new Date(`${allocation.historicalPoolDate}T00:00:00.000Z`),
        ratePkr,
        rateType: "carrying_transfer",
        rateProvider: "HISTORICAL_CARRYING_LAYER",
        rateReference: `layer:${allocation.layerId}`,
        createdBy: input.createdBy || null,
      },
    });
    targets.push(target);
    movements.push(movement);
  }
  return { allocations, targets, movements, realizedFxPkr: 0 };
}

export async function settleForeignCurrencyAsset(db: DbClient, input: {
  sourceOwnerKey: string;
  targetOwnerKey: string;
  targetPositionType: "city_cash" | "city_bank" | "super_admin_cash" | "super_admin_bank" | "intermediary_balance" | "other_receivable";
  currencyCode: string;
  amount: number;
  sourceType: string;
  sourceId: number;
  settlementDate: Date;
  settlementRate: ForeignRateEvidence;
  createdBy?: number | null;
}) {
  const revision = await db.foreignCurrencyMovement.count({ where: { sourceType: input.sourceType, sourceId: input.sourceId, movementType: "settlement" } }) + 1;
  const { currencyId, allocations } = await consumeLayers(db, {
    ownerKey: input.sourceOwnerKey,
    currencyCode: input.currencyCode,
    amount: input.amount,
  });
  let realizedFxPkr = 0;
  const movements = [];
  for (const [index, allocation] of allocations.entries()) {
    const settlementAmountPkr = round2(allocation.foreignAmount * input.settlementRate.ratePkr);
    const settlement = buildForeignCurrencySettlement({
      positionKind: "asset",
      foreignAmount: allocation.foreignAmount,
      carryingAmountPkr: allocation.carryingAmountPkr,
      settlementAmountPkr,
      historicalPoolDate: allocation.historicalPoolDate,
    });
    const sourceLineKey = `r${revision}:${index + 1}:${allocation.layerId}`;
    const target = await recordForeignCurrencyRecognition(db, {
      positionKind: "asset",
      positionType: input.targetPositionType,
      ownerKey: input.targetOwnerKey,
      currencyCode: input.currencyCode,
      sourceType: `${input.sourceType}_target`,
      sourceId: input.sourceId,
      sourceLineKey,
      recognitionDate: input.settlementDate,
      historicalPoolDate: input.settlementDate,
      foreignAmount: allocation.foreignAmount,
      carryingAmountPkr: settlementAmountPkr,
      rate: input.settlementRate,
      createdBy: input.createdBy,
      parentLayerId: allocation.layerId,
    });
    const movement = await db.foreignCurrencyMovement.create({
      data: {
        movementType: "settlement",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey,
        movementDate: input.settlementDate,
        currencyId,
        sourceLayerId: allocation.layerId,
        targetLayerId: target.id,
        foreignAmount: allocation.foreignAmount,
        carryingAmountPkr: allocation.carryingAmountPkr,
        settlementAmountPkr,
        realizedFxPkr: settlement.realizedFxPkr,
        historicalPoolDate: new Date(`${allocation.historicalPoolDate}T00:00:00.000Z`),
        ratePkr: input.settlementRate.ratePkr,
        rateType: input.settlementRate.rateType,
        rateProvider: input.settlementRate.provider,
        rateReference: input.settlementRate.reference || null,
        conversionPathJson: input.settlementRate.conversionPath as Prisma.InputJsonValue | undefined,
        createdBy: input.createdBy || null,
      },
    });
    realizedFxPkr = round2(realizedFxPkr + settlement.realizedFxPkr);
    movements.push(movement);
  }
  return { allocations, movements, realizedFxPkr };
}

export async function settleForeignCurrencyOutflow(db: DbClient, input: {
  sourceOwnerKey: string;
  currencyCode: string;
  amount: number;
  sourceType: string;
  sourceId: number;
  settlementDate: Date;
  settlementRate: ForeignRateEvidence;
  createdBy?: number | null;
}) {
  const revision = await db.foreignCurrencyMovement.count({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, movementType: "settlement" },
  }) + 1;
  const { currencyId, allocations } = await consumeLayers(db, {
    ownerKey: input.sourceOwnerKey,
    currencyCode: input.currencyCode,
    amount: input.amount,
  });
  let realizedFxPkr = 0;
  const movements = [];
  for (const [index, allocation] of allocations.entries()) {
    const settlementAmountPkr = round2(allocation.foreignAmount * input.settlementRate.ratePkr);
    const settlement = buildForeignCurrencySettlement({
      positionKind: "asset",
      foreignAmount: allocation.foreignAmount,
      carryingAmountPkr: allocation.carryingAmountPkr,
      settlementAmountPkr,
      historicalPoolDate: allocation.historicalPoolDate,
    });
    const movement = await db.foreignCurrencyMovement.create({
      data: {
        movementType: "settlement",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey: `r${revision}:${index + 1}:${allocation.layerId}`,
        movementDate: input.settlementDate,
        currencyId,
        sourceLayerId: allocation.layerId,
        foreignAmount: allocation.foreignAmount,
        carryingAmountPkr: allocation.carryingAmountPkr,
        settlementAmountPkr,
        realizedFxPkr: settlement.realizedFxPkr,
        historicalPoolDate: new Date(`${allocation.historicalPoolDate}T00:00:00.000Z`),
        ratePkr: input.settlementRate.ratePkr,
        rateType: input.settlementRate.rateType,
        rateProvider: input.settlementRate.provider,
        rateReference: input.settlementRate.reference || null,
        conversionPathJson: input.settlementRate.conversionPath as Prisma.InputJsonValue | undefined,
        createdBy: input.createdBy || null,
      },
    });
    movements.push(movement);
    realizedFxPkr = round2(realizedFxPkr + settlement.realizedFxPkr);
  }
  return { allocations, movements, realizedFxPkr };
}

export async function settleForeignCurrencyLiability(db: DbClient, input: {
  sourceOwnerKey: string;
  currencyCode: string;
  amount: number;
  sourceType: string;
  sourceId: number;
  settlementDate: Date;
  settlementRate: ForeignRateEvidence;
  journalTransactionId: string;
  createdBy?: number | null;
}) {
  const revision = await db.foreignCurrencyMovement.count({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, movementType: "settlement" },
  }) + 1;
  const { currencyId, allocations } = await consumeLayers(db, {
    ownerKey: input.sourceOwnerKey,
    currencyCode: input.currencyCode,
    amount: input.amount,
  });
  let carryingAmountPkr = 0;
  let settlementAmountPkr = 0;
  let realizedFxPkr = 0;
  const movements = [];
  for (const [index, allocation] of allocations.entries()) {
    const totalSettlementPkr = round2(input.amount * input.settlementRate.ratePkr);
    const allocatedSettlementPkr = index === allocations.length - 1
      ? round2(totalSettlementPkr - settlementAmountPkr)
      : round2(allocation.foreignAmount * input.settlementRate.ratePkr);
    const settlement = buildForeignCurrencySettlement({
      positionKind: "liability",
      foreignAmount: allocation.foreignAmount,
      carryingAmountPkr: allocation.carryingAmountPkr,
      settlementAmountPkr: allocatedSettlementPkr,
      historicalPoolDate: allocation.historicalPoolDate,
    });
    const movement = await db.foreignCurrencyMovement.create({
      data: {
        movementType: "settlement",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey: `r${revision}:${index + 1}:${allocation.layerId}`,
        movementDate: input.settlementDate,
        currencyId,
        sourceLayerId: allocation.layerId,
        foreignAmount: allocation.foreignAmount,
        carryingAmountPkr: allocation.carryingAmountPkr,
        settlementAmountPkr: allocatedSettlementPkr,
        realizedFxPkr: settlement.realizedFxPkr,
        historicalPoolDate: new Date(`${allocation.historicalPoolDate}T00:00:00.000Z`),
        ratePkr: input.settlementRate.ratePkr,
        rateType: input.settlementRate.rateType,
        rateProvider: input.settlementRate.provider,
        rateReference: input.settlementRate.reference || null,
        conversionPathJson: input.settlementRate.conversionPath as Prisma.InputJsonValue | undefined,
        journalTransactionId: input.journalTransactionId,
        createdBy: input.createdBy || null,
      },
    });
    carryingAmountPkr = round2(carryingAmountPkr + allocation.carryingAmountPkr);
    settlementAmountPkr = round2(settlementAmountPkr + allocatedSettlementPkr);
    realizedFxPkr = round2(realizedFxPkr + settlement.realizedFxPkr);
    movements.push(movement);
  }
  return { allocations, movements, carryingAmountPkr, settlementAmountPkr, realizedFxPkr };
}

export function assertForeignLiabilitySettlementReconciles(input: {
  expectedCarryingAmountPkr: number;
  expectedSettlementAmountPkr: number;
  expectedRealizedFxPkr: number;
  actualCarryingAmountPkr: number;
  actualSettlementAmountPkr: number;
  actualRealizedFxPkr: number;
}) {
  const differences = [
    input.actualCarryingAmountPkr - input.expectedCarryingAmountPkr,
    input.actualSettlementAmountPkr - input.expectedSettlementAmountPkr,
    input.actualRealizedFxPkr - input.expectedRealizedFxPkr,
  ];
  if (differences.some((difference) => Math.abs(round2(difference)) > 0.01)) {
    throw new Error("Foreign-currency liability layer does not reconcile to the authoritative settlement journal.");
  }
}

export async function exchangeForeignCurrencyLayers(db: DbClient, input: {
  ownerKey: string;
  targetOwnerKey?: string;
  positionType: "city_cash" | "city_bank" | "super_admin_cash" | "super_admin_bank" | "intermediary_balance";
  fromCurrencyCode: string;
  fromAmount: number;
  toCurrencyCode: string;
  toAmount: number;
  sourceType: string;
  sourceId: number;
  exchangeDate: Date;
  rateProvider?: string;
  rateReference?: string;
  createdBy?: number | null;
}) {
  const fromCode = canonicalForeignCurrencyCode(input.fromCurrencyCode);
  const toCode = canonicalForeignCurrencyCode(input.toCurrencyCode);
  const revision = await db.foreignCurrencyMovement.count({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, movementType: "exchange" },
  }) + 1;

  if (fromCode === "PKR") {
    if (!isSupportedForeignCurrency(toCode)) throw new Error(`Unsupported exchange target currency ${toCode}.`);
    const target = await recordForeignCurrencyRecognition(db, {
      positionKind: "asset",
      positionType: input.positionType,
      ownerKey: input.targetOwnerKey || input.ownerKey,
      currencyCode: toCode,
      sourceType: `${input.sourceType}_target`,
      sourceId: input.sourceId,
      sourceLineKey: `r${revision}:1:pkr`,
      recognitionDate: input.exchangeDate,
      historicalPoolDate: input.exchangeDate,
      foreignAmount: input.toAmount,
      carryingAmountPkr: input.fromAmount,
      rate: {
        ratePkr: round2(input.fromAmount / input.toAmount),
        rateType: "actual_pkr_exchange",
        provider: input.rateProvider || "INTERMEDIARY_EXCHANGE",
        reference: input.rateReference || `intermediary_exchange:${input.sourceId}`,
        conversionPath: { from: { currency: fromCode, amount: input.fromAmount }, to: { currency: toCode, amount: input.toAmount } },
      },
      createdBy: input.createdBy,
    });
    const movement = await db.foreignCurrencyMovement.create({
      data: {
        movementType: "exchange",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey: `r${revision}:1:pkr`,
        movementDate: input.exchangeDate,
        currencyId: target.currencyId,
        targetLayerId: target.id,
        foreignAmount: input.toAmount,
        carryingAmountPkr: input.fromAmount,
        settlementAmountPkr: input.fromAmount,
        realizedFxPkr: 0,
        historicalPoolDate: input.exchangeDate,
        ratePkr: round2(input.fromAmount / input.toAmount),
        rateType: "actual_pkr_exchange",
        rateProvider: input.rateProvider || "INTERMEDIARY_EXCHANGE",
        rateReference: input.rateReference || `intermediary_exchange:${input.sourceId}`,
        conversionPathJson: { from: { currency: fromCode, amount: input.fromAmount }, to: { currency: toCode, amount: input.toAmount } },
        createdBy: input.createdBy || null,
      },
    });
    return { allocations: [], targets: [target], movements: [movement], realizedFxPkr: 0 };
  }

  if (!isSupportedForeignCurrency(fromCode)) throw new Error(`Unsupported exchange source currency ${fromCode}.`);
  if (toCode !== "PKR" && !isSupportedForeignCurrency(toCode)) throw new Error(`Unsupported exchange target currency ${toCode}.`);
  const { currencyId, allocations } = await consumeLayers(db, {
    ownerKey: input.ownerKey,
    currencyCode: fromCode,
    amount: input.fromAmount,
  });
  const targets = [];
  const movements = [];
  let remainingTargetAmount = round4(input.toAmount);
  let realizedFxPkr = 0;

  for (const [index, allocation] of allocations.entries()) {
    const targetAmount = index === allocations.length - 1
      ? remainingTargetAmount
      : round4(input.toAmount * (allocation.foreignAmount / input.fromAmount));
    remainingTargetAmount = round4(remainingTargetAmount - targetAmount);
    const exchange = buildForeignCurrencyExchange({
      sourceForeignAmount: allocation.foreignAmount,
      sourceCarryingAmountPkr: allocation.carryingAmountPkr,
      targetCurrencyCode: toCode,
      targetAmount,
      historicalPoolDate: allocation.historicalPoolDate,
    });
    const sourceLineKey = `r${revision}:${index + 1}:${allocation.layerId}`;
    const conversionPath = {
      from: { currency: fromCode, amount: allocation.foreignAmount, sourceLayerId: allocation.layerId },
      to: { currency: toCode, amount: targetAmount },
    };
    const target = toCode === "PKR"
      ? null
      : await recordForeignCurrencyRecognition(db, {
          positionKind: "asset",
          positionType: input.positionType,
          ownerKey: input.targetOwnerKey || input.ownerKey,
          currencyCode: toCode,
          sourceType: `${input.sourceType}_target`,
          sourceId: input.sourceId,
          sourceLineKey,
          recognitionDate: input.exchangeDate,
          historicalPoolDate: new Date(`${allocation.historicalPoolDate}T00:00:00.000Z`),
          foreignAmount: targetAmount,
          carryingAmountPkr: exchange.targetCarryingAmountPkr,
          rate: {
            ratePkr: exchange.targetRecognitionRatePkr,
            rateType: "carrying_exchange",
            provider: "HISTORICAL_CARRYING_LAYER",
            reference: `layer:${allocation.layerId}`,
            conversionPath,
          },
          createdBy: input.createdBy,
          parentLayerId: allocation.layerId,
        });
    const movement = await db.foreignCurrencyMovement.create({
      data: {
        movementType: "exchange",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey,
        movementDate: input.exchangeDate,
        currencyId,
        sourceLayerId: allocation.layerId,
        targetLayerId: target?.id || null,
        foreignAmount: allocation.foreignAmount,
        carryingAmountPkr: allocation.carryingAmountPkr,
        settlementAmountPkr: exchange.targetCarryingAmountPkr,
        realizedFxPkr: exchange.realizedFxPkr,
        historicalPoolDate: new Date(`${allocation.historicalPoolDate}T00:00:00.000Z`),
        ratePkr: toCode === "PKR" ? round2(targetAmount / allocation.foreignAmount) : exchange.targetRecognitionRatePkr,
        rateType: toCode === "PKR" ? "actual_pkr_exchange" : "carrying_exchange",
        rateProvider: toCode === "PKR" ? input.rateProvider || "INTERMEDIARY_EXCHANGE" : "HISTORICAL_CARRYING_LAYER",
        rateReference: toCode === "PKR" ? input.rateReference || `intermediary_exchange:${input.sourceId}` : `layer:${allocation.layerId}`,
        conversionPathJson: conversionPath,
        createdBy: input.createdBy || null,
      },
    });
    if (target) targets.push(target);
    movements.push(movement);
    realizedFxPkr = round2(realizedFxPkr + exchange.realizedFxPkr);
  }
  return { allocations, targets, movements, realizedFxPkr };
}

export async function reverseForeignCurrencyMovements(db: DbClient, input: {
  sourceType: string;
  sourceId: number;
  reversalDate: Date;
  createdBy?: number | null;
}) {
  const movements = await db.foreignCurrencyMovement.findMany({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, movementType: { in: ["settlement", "transfer", "exchange"] } },
    include: { targetLayer: true },
    orderBy: { id: "desc" },
  });
  const journalTransactionIds: string[] = [];
  for (const movement of movements) {
    const existingReversal = await db.foreignCurrencyMovement.findFirst({ where: { reversalOfId: movement.id } });
    if (existingReversal) continue;
    if (movement.targetLayer) {
      const originalForeign = Number(movement.targetLayer.originalForeignAmount);
      const remainingForeign = Number(movement.targetLayer.remainingForeignAmount);
      if (movement.targetLayer.status !== "open" || Math.abs(originalForeign - remainingForeign) > 0.0001) {
        throw new Error("Foreign-currency proceeds have already moved and cannot be edited; reverse the later movement first.");
      }
      await db.foreignCurrencyCarryingLayer.update({
        where: { id: movement.targetLayer.id },
        data: { status: "reversed", remainingForeignAmount: 0, remainingCarryingAmountPkr: 0 },
      });
    }
    if (movement.sourceLayerId) {
      const source = await db.foreignCurrencyCarryingLayer.findUniqueOrThrow({ where: { id: movement.sourceLayerId } });
      await db.foreignCurrencyCarryingLayer.update({
        where: { id: source.id },
        data: {
          status: "open",
          remainingForeignAmount: round4(Number(source.remainingForeignAmount) + Number(movement.foreignAmount)),
          remainingCarryingAmountPkr: round2(Number(source.remainingCarryingAmountPkr) + Number(movement.carryingAmountPkr)),
        },
      });
    }
    await db.foreignCurrencyMovement.create({
      data: {
        movementType: "reversal",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey: movement.sourceLineKey,
        movementDate: input.reversalDate,
        currencyId: movement.currencyId,
        sourceLayerId: movement.targetLayerId,
        targetLayerId: movement.sourceLayerId,
        foreignAmount: movement.foreignAmount,
        carryingAmountPkr: movement.carryingAmountPkr,
        settlementAmountPkr: movement.settlementAmountPkr,
        realizedFxPkr: Number(movement.realizedFxPkr) * -1,
        historicalPoolDate: movement.historicalPoolDate,
        ratePkr: movement.ratePkr,
        rateType: movement.rateType,
        rateProvider: movement.rateProvider,
        rateReference: movement.rateReference,
        conversionPathJson: movement.conversionPathJson as Prisma.InputJsonValue | undefined,
        journalTransactionId: movement.journalTransactionId ? `REV-${movement.journalTransactionId}` : null,
        reversalOfId: movement.id,
        createdBy: input.createdBy || null,
      },
    });
    if (movement.journalTransactionId) journalTransactionIds.push(movement.journalTransactionId);
  }
  return { movements, journalTransactionIds };
}

export async function reverseForeignCurrencyRecognition(db: DbClient, input: {
  sourceType: string;
  sourceId: number;
  reversalDate: Date;
  createdBy?: number | null;
}) {
  const layers = await db.foreignCurrencyCarryingLayer.findMany({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, status: { not: "reversed" } },
    orderBy: { id: "desc" },
  });
  for (const layer of layers) {
    if (Math.abs(Number(layer.originalForeignAmount) - Number(layer.remainingForeignAmount)) > 0.0001) {
      throw new Error("This foreign-currency source has downstream receipts or transfers. Reverse those transactions before correcting it.");
    }
    await db.foreignCurrencyCarryingLayer.update({
      where: { id: layer.id },
      data: { status: "reversed", remainingForeignAmount: 0, remainingCarryingAmountPkr: 0 },
    });
    await db.foreignCurrencyMovement.create({
      data: {
        movementType: "reversal",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineKey: layer.sourceLineKey,
        movementDate: input.reversalDate,
        currencyId: layer.currencyId,
        sourceLayerId: layer.id,
        foreignAmount: layer.originalForeignAmount,
        carryingAmountPkr: layer.originalCarryingAmountPkr,
        settlementAmountPkr: layer.originalCarryingAmountPkr,
        realizedFxPkr: 0,
        historicalPoolDate: layer.historicalPoolDate,
        ratePkr: layer.recognitionRatePkr,
        rateType: layer.rateType,
        rateProvider: layer.rateProvider,
        rateReference: layer.rateReference,
        conversionPathJson: layer.conversionPathJson as Prisma.InputJsonValue | undefined,
        createdBy: input.createdBy || null,
      },
    });
  }
  return { reversedLayers: layers };
}

export async function nextForeignCurrencyRecognitionLineKey(db: DbClient, sourceType: string, sourceId: number) {
  const count = await db.foreignCurrencyCarryingLayer.count({ where: { sourceType, sourceId } });
  return count === 0 ? "main" : `r${count + 1}`;
}
