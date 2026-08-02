import assert from "node:assert/strict";
import test from "node:test";
import { saCheckAuditStateMapFromLogs } from "./sa-check-audit";

test("sa check audit state uses newest valid log per entity", () => {
  const logs = [
    {
      entityId: 10,
      newValues: { saCheckConfirmed: true, saCheckNote: "latest" },
      createdAt: new Date("2026-08-02T10:00:00.000Z"),
      user: { id: 1, fullName: "Super Admin", username: "superadmin" },
    },
    {
      entityId: 10,
      newValues: { saCheckConfirmed: false, saCheckNote: "older" },
      createdAt: new Date("2026-08-02T09:00:00.000Z"),
      user: { id: 2, fullName: "Old Admin", username: "oldadmin" },
    },
    {
      entityId: 11,
      newValues: { unrelated: true },
      createdAt: new Date("2026-08-02T08:00:00.000Z"),
      user: null,
    },
  ];

  assert.deepEqual(saCheckAuditStateMapFromLogs(logs), {
    10: {
      confirmed: true,
      confirmedAt: "2026-08-02T10:00:00.000Z",
      confirmedBy: { id: 1, fullName: "Super Admin", username: "superadmin" },
      note: "latest",
    },
  });
});
