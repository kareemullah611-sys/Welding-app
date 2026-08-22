import prisma from "@/lib/prisma";

export function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function assertProfitShareTotal(investorShare: unknown, managerShare: unknown) {
  const investor = Number(investorShare);
  const manager = Number(managerShare);
  if (!Number.isFinite(investor) || !Number.isFinite(manager)) {
    return { ok: false as const, message: "Investor and manager share percentages are required" };
  }
  if (investor < 0 || manager < 0) {
    return { ok: false as const, message: "Profit share percentages cannot be negative" };
  }
  if (Math.abs(round6(investor + manager) - 100) > 0.000001) {
    return { ok: false as const, message: "Investor Profit Share % and Manager Profit Share % must total 100%" };
  }
  return { ok: true as const, investorShare: round6(investor), managerShare: round6(manager) };
}

export async function hasFinalizedAttributionOnOrAfter(effectiveDate: Date) {
  const finalized = await prisma.profitAttributionPeriod.findFirst({
    where: {
      status: "finalized",
      periodEnd: { gte: effectiveDate },
    },
    select: { id: true, periodStart: true, periodEnd: true },
  });
  return finalized;
}

export async function currentParticipantCapitalPkr(participantId: number, asOf?: Date) {
  const events = await prisma.investmentCapitalEvent.findMany({
    where: {
      participantId,
      ...(asOf ? { effectiveDate: { lte: asOf } } : {}),
    },
    select: { amountPkr: true },
  });
  return events.reduce((sum, event) => sum + Number(event.amountPkr), 0);
}
