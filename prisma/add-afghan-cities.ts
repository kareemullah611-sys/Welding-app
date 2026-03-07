// prisma/add-afghan-cities.ts
// Adds Kandahar and Wesh Border to Afghanistan
// Run: npx ts-node prisma/add-afghan-cities.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Adding Kandahar and Wesh Border...");

  // Get Afghanistan country
  const afghanistan = await prisma.country.findUniqueOrThrow({ where: { code: "AF" } });

  // Get currencies
  const afn = await prisma.currency.findUniqueOrThrow({ where: { code: "AFN" } });
  const usd = await prisma.currency.findUniqueOrThrow({ where: { code: "USD" } });

  // 1. Create cities
  const kandahar = await prisma.city.upsert({
    where: { countryId_name: { countryId: afghanistan.id, name: "Kandahar" } },
    update: {},
    create: { countryId: afghanistan.id, name: "Kandahar" },
  });

  const weshBorder = await prisma.city.upsert({
    where: { countryId_name: { countryId: afghanistan.id, name: "Wesh Border" } },
    update: {},
    create: { countryId: afghanistan.id, name: "Wesh Border" },
  });

  console.log("✅ Cities: Kandahar, Wesh Border");

  // 2. City currencies (AFN + USD for both)
  for (const cityId of [kandahar.id, weshBorder.id]) {
    for (const currencyId of [afn.id, usd.id]) {
      await prisma.cityCurrency.upsert({
        where: { cityId_currencyId: { cityId, currencyId } },
        update: {},
        create: { cityId, currencyId },
      });
    }
  }

  console.log("✅ Currencies (AFN + USD) linked to both cities");

  // 3. Voucher sequences
  for (const city of [kandahar, weshBorder]) {
    await prisma.voucherSequence.upsert({
      where: { cityId: city.id },
      update: {},
      create: { cityId: city.id, currentNumber: 0 },
    });
  }

  console.log("✅ Voucher sequences created");

  // 4. City admin users
  const passwordHash = await bcrypt.hash("city123", 12);

  await prisma.user.upsert({
    where: { username: "kandahar_admin" },
    update: {},
    create: {
      username: "kandahar_admin",
      passwordHash,
      fullName: "Kandahar Admin",
      role: "city_admin",
      cityId: kandahar.id,
    },
  });

  await prisma.user.upsert({
    where: { username: "wesh_admin" },
    update: {},
    create: {
      username: "wesh_admin",
      passwordHash,
      fullName: "Wesh Border Admin",
      role: "city_admin",
      cityId: weshBorder.id,
    },
  });

  console.log("✅ Admins: kandahar_admin / city123,  wesh_admin / city123");

  // 5. Default godowns
  await prisma.godown.upsert({
    where: { cityId_name: { cityId: kandahar.id, name: "Kandahar Main Godown" } },
    update: {},
    create: { cityId: kandahar.id, name: "Kandahar Main Godown" },
  });

  await prisma.godown.upsert({
    where: { cityId_name: { cityId: weshBorder.id, name: "Wesh Border Godown" } },
    update: {},
    create: { cityId: weshBorder.id, name: "Wesh Border Godown" },
  });

  console.log("✅ Default godowns created");

  console.log("\n🎉 Done! Afghanistan cities are now:");
  console.log("   • Kabul        (existing)");
  console.log("   • Herat        (existing)");
  console.log("   • Kandahar     (new) — kandahar_admin / city123");
  console.log("   • Wesh Border  (new) — wesh_admin / city123");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
