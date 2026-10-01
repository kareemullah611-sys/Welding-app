import { setupE2EFixtures } from "../scripts/e2e-fixture-lifecycle";

export default async function globalSetup() {
  await setupE2EFixtures();
}
