// prisma/seed.ts
// Run: npx ts-node prisma/seed.ts
// This seeds the database with initial countries, currencies, a super admin user, and sample cities

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

  // 3. Cities
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

  console.log("✅ Cities: Karachi, Lahore, Kabul, Herat");

  // 4. City Currencies
  const cityCurrencyPairs = [
    { cityId: karachi.id, currencyId: pkr.id },
    { cityId: lahore.id, currencyId: pkr.id },
    { cityId: kabul.id, currencyId: afn.id },
    { cityId: kabul.id, currencyId: usd.id },
    { cityId: herat.id, currencyId: afn.id },
    { cityId: herat.id, currencyId: usd.id },
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
  for (const city of [karachi, lahore, kabul, herat]) {
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

  await prisma.user.upsert({
    where: { username: "karachi_admin" },
    update: {},
    create: {
      username: "karachi_admin",
      passwordHash: cityAdminPassword,
      fullName: "Karachi Admin",
      role: "city_admin",
      cityId: karachi.id,
    },
  });

  await prisma.user.upsert({
    where: { username: "lahore_admin" },
    update: {},
    create: {
      username: "lahore_admin",
      passwordHash: cityAdminPassword,
      fullName: "Lahore Admin",
      role: "city_admin",
      cityId: lahore.id,
    },
  });

  await prisma.user.upsert({
    where: { username: "kabul_admin" },
    update: {},
    create: {
      username: "kabul_admin",
      passwordHash: cityAdminPassword,
      fullName: "Kabul Admin",
      role: "city_admin",
      cityId: kabul.id,
    },
  });

  await prisma.user.upsert({
    where: { username: "herat_admin" },
    update: {},
    create: {
      username: "herat_admin",
      passwordHash: cityAdminPassword,
      fullName: "Herat Admin",
      role: "city_admin",
      cityId: herat.id,
    },
  });

  console.log("✅ City Admins: karachi_admin, lahore_admin, kabul_admin, herat_admin / city123");

  // 8. Sample Products
  const products = ["Welding Rod 6013", "Welding Rod 7018", "Welding Wire MIG", "Welding Electrode 309L", "Welding Rod 6011"];
  for (const name of products) {
    await prisma.product.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log("✅ Products: 5 welding products");

  // 9. Sample Godowns
  const godownData = [
    { cityId: karachi.id, name: "Karachi Main Warehouse" },
    { cityId: karachi.id, name: "Karachi Port Godown" },
    { cityId: lahore.id, name: "Lahore Central Godown" },
    { cityId: kabul.id, name: "Kabul Main Godown" },
    { cityId: herat.id, name: "Herat Warehouse" },
  ];

  for (const gd of godownData) {
    await prisma.godown.upsert({
      where: { cityId_name: gd },
      update: {},
      create: gd,
    });
  }

  console.log("✅ Godowns: 5 godowns across 4 cities");

  // Seed default supplier
  await prisma.supplier.upsert({
    where: { id: 1 },
    update: {},
    create: { name: "Main Welding Company", country: "China", contact: "supplier@example.com", notes: "Primary welding materials supplier" },
  });
  console.log("✅ Default supplier created");

  console.log("\n🎉 Seed complete! You can now login with:");
  console.log("   Super Admin: superadmin / admin123");
  console.log("   City Admin:  karachi_admin / city123");
  console.log("                lahore_admin / city123");
  console.log("                kabul_admin / city123");
  console.log("                herat_admin / city123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
