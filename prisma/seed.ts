// prisma/seed.ts
// Run: npx tsx prisma/seed.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Countries
  const pakistan = await prisma.country.upsert({
    where: { code: "PK" },
    update: {},
    create: { name: "Pakistan", code: "PK" },
  });

  const afghanistan = await prisma.country.upsert({
    where: { code: "AF" },
    update: {},
    create: { name: "Afghanistan", code: "AF" },
  });

  console.log("✅ Countries: Pakistan, Afghanistan");

  // 2. Currencies
  const pkr = await prisma.currency.upsert({
    where: { code: "PKR" },
    update: {},
    create: { code: "PKR", name: "Pakistani Rupee", symbol: "Rs" },
  });

  const afn = await prisma.currency.upsert({
    where: { code: "AFN" },
    update: {},
    create: { code: "AFN", name: "Afghan Afghani", symbol: "؋" },
  });

  const usd = await prisma.currency.upsert({
    where: { code: "USD" },
    update: {},
    create: { code: "USD", name: "US Dollar", symbol: "$" },
  });

  console.log("✅ Currencies: PKR, AFN, USD");

  // 3. Cities (all 6)
  const karachi = await prisma.city.upsert({
    where: { countryId_name: { countryId: pakistan.id, name: "Karachi" } },
    update: {},
    create: { countryId: pakistan.id, name: "Karachi" },
  });

  const lahore = await prisma.city.upsert({
    where: { countryId_name: { countryId: pakistan.id, name: "Lahore" } },
    update: {},
    create: { countryId: pakistan.id, name: "Lahore" },
  });

  const kabul = await prisma.city.upsert({
    where: { countryId_name: { countryId: afghanistan.id, name: "Kabul" } },
    update: {},
    create: { countryId: afghanistan.id, name: "Kabul" },
  });

  const herat = await prisma.city.upsert({
    where: { countryId_name: { countryId: afghanistan.id, name: "Herat" } },
    update: {},
    create: { countryId: afghanistan.id, name: "Herat" },
  });

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

  console.log("✅ Cities: Karachi, Lahore, Kabul, Herat, Kandahar, Wesh Border");

  // 4. City Currencies
  const cityCurrencyPairs = [
    { cityId: karachi.id,   currencyId: pkr.id },
    { cityId: lahore.id,    currencyId: pkr.id },
    { cityId: kabul.id,     currencyId: afn.id },
    { cityId: kabul.id,     currencyId: usd.id },
    { cityId: herat.id,     currencyId: afn.id },
    { cityId: herat.id,     currencyId: usd.id },
    { cityId: kandahar.id,  currencyId: afn.id },
    { cityId: kandahar.id,  currencyId: usd.id },
    { cityId: weshBorder.id, currencyId: afn.id },
    { cityId: weshBorder.id, currencyId: usd.id },
  ];

  for (const pair of cityCurrencyPairs) {
    await prisma.cityCurrency.upsert({
      where: { cityId_currencyId: pair },
      update: {},
      create: pair,
    });
  }

  console.log("✅ City-Currency mappings");

  // 5. Voucher sequences
  for (const city of [karachi, lahore, kabul, herat, kandahar, weshBorder]) {
    await prisma.voucherSequence.upsert({
      where: { cityId: city.id },
      update: {},
      create: { cityId: city.id, currentNumber: 0 },
    });
  }

  console.log("✅ Voucher sequences");

  // 6. Super Admin user
  const passwordHash = await bcrypt.hash("admin123", 12);
  await prisma.user.upsert({
    where: { username: "superadmin" },
    update: {},
    create: {
      username: "superadmin",
      passwordHash,
      fullName: "Super Administrator",
      role: "super_admin",
      cityId: null,
    },
  });

  console.log("✅ Super Admin: superadmin / admin123");

  // 7. City Admin users
  const cityAdminPassword = await bcrypt.hash("city123", 12);

  const cityAdmins = [
    { username: "karachi_admin",  fullName: "Karachi Admin",    cityId: karachi.id },
    { username: "lahore_admin",   fullName: "Lahore Admin",     cityId: lahore.id },
    { username: "kabul_admin",    fullName: "Kabul Admin",      cityId: kabul.id },
    { username: "herat_admin",    fullName: "Herat Admin",      cityId: herat.id },
    { username: "kandahar_admin", fullName: "Kandahar Admin",   cityId: kandahar.id },
    { username: "wesh_admin",     fullName: "Wesh Border Admin", cityId: weshBorder.id },
  ];

  for (const admin of cityAdmins) {
    await prisma.user.upsert({
      where: { username: admin.username },
      update: {},
      create: {
        username: admin.username,
        passwordHash: cityAdminPassword,
        fullName: admin.fullName,
        role: "city_admin",
        cityId: admin.cityId,
      },
    });
  }

  console.log("✅ City Admins: karachi_admin, lahore_admin, kabul_admin, herat_admin, kandahar_admin, wesh_admin / city123");

  // 8. Products (your real product names)
  const products = ["3.2mm", "7018-12", "5.0mm", "2.5mm", "7018-10", "4.0mm"];
  for (const name of products) {
    await prisma.product.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log("✅ Products: 3.2mm, 7018-12, 5.0mm, 2.5mm, 7018-10, 4.0mm");

  // 9. Godowns (all 7)
  const godownData = [
    { cityId: karachi.id,    name: "Karachi Main Warehouse" },
    { cityId: karachi.id,    name: "Karachi Port Godown" },
    { cityId: lahore.id,     name: "Lahore Central Godown" },
    { cityId: kabul.id,      name: "Kabul Main Godown" },
    { cityId: herat.id,      name: "Herat Warehouse" },
    { cityId: kandahar.id,   name: "Kandahar Main Godown" },
    { cityId: weshBorder.id, name: "Wesh Border Godown" },
  ];

  for (const gd of godownData) {
    await prisma.godown.upsert({
      where: { cityId_name: gd },
      update: {},
      create: gd,
    });
  }

  console.log("✅ Godowns: 7 godowns across 6 cities");

  // 10. Default supplier
  await prisma.supplier.upsert({
    where: { id: 1 },
    update: {},
    create: { name: "Main Welding Company", country: "China", contact: "supplier@example.com", notes: "Primary welding materials supplier" },
  });

  console.log("✅ Default supplier created");

  console.log("\n🎉 Seed complete! Login credentials:");
  console.log("   superadmin     / admin123  (Super Admin)");
  console.log("   karachi_admin  / city123");
  console.log("   lahore_admin   / city123");
  console.log("   kabul_admin    / city123");
  console.log("   herat_admin    / city123");
  console.log("   kandahar_admin / city123");
  console.log("   wesh_admin     / city123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
