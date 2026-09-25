import prisma from "@/lib/prisma";

/** When true, city admins cannot POST opening entries; super_admin still can. */
export function isOpeningsLocked(): boolean {
  return String(process.env.OPENINGS_LOCKED || "").toLowerCase() === "true";
}

export function canEditOpenings(role: string | undefined): boolean {
  if (!isOpeningsLocked()) return true;
  return role === "super_admin";
}

export async function getOpeningEditState(role: string | undefined, client: any = prisma) {
  const finalized = await client.openingCutover.findFirst({
    where: { status: "finalized" },
    select: { id: true, finalizedAt: true },
    orderBy: { revision: "desc" },
  });
  if (finalized) return { openingsLocked: true, canEditOpenings: false, finalizedCutoverId: finalized.id };
  return { openingsLocked: isOpeningsLocked(), canEditOpenings: canEditOpenings(role), finalizedCutoverId: null };
}
