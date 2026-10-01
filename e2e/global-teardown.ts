import { teardownE2EFixtures } from "../scripts/e2e-fixture-lifecycle";

export default async function globalTeardown() {
  // Runs even when tests fail, so a red suite cannot leak rows.
  await teardownE2EFixtures();
}
