import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "@/app/api/ping/route";

test("ping endpoint returns ok without database", async () => {
  const response = await GET();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.live, true);
});
