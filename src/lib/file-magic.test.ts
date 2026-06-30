import assert from "node:assert/strict";
import test from "node:test";

import { detectUploadKind } from "./file-magic";

test("detectUploadKind identifies common upload signatures", () => {
  assert.equal(detectUploadKind(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "jpg");
  assert.equal(
    detectUploadKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])),
    "png"
  );
  assert.equal(detectUploadKind(Buffer.from("%PDF-1.4", "ascii")), "pdf");
  assert.equal(detectUploadKind(Buffer.from("RIFFxxxxWEBP", "ascii")), "webp");
  assert.equal(detectUploadKind(Buffer.from([0x00, 0x01])), null);
});
