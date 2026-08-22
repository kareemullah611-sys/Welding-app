import assert from "node:assert/strict";
import test from "node:test";

import { detectUploadKind } from "./file-magic";
import { validateLotDocumentFile } from "./lot-documents";

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

test("lot document validation accepts office files and Numbers as stored documents", () => {
  assert.equal(validateLotDocumentFile({ name: "invoice.pdf", type: "application/pdf", size: 100 }).ok, true);
  assert.equal(
    validateLotDocumentFile({
      name: "packing.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 100,
    }).ok,
    true
  );
  assert.equal(validateLotDocumentFile({ name: "legacy.xls", type: "application/vnd.ms-excel", size: 100 }).ok, true);
  assert.equal(validateLotDocumentFile({ name: "rows.csv", type: "text/csv", size: 100 }).ok, true);
  assert.equal(validateLotDocumentFile({ name: "container.jpg", type: "image/jpeg", size: 100 }).ok, true);
  assert.equal(validateLotDocumentFile({ name: "gd.jpeg", type: "image/jpeg", size: 100 }).ok, true);
  assert.equal(validateLotDocumentFile({ name: "port.png", type: "image/png", size: 100 }).ok, true);
  assert.equal(validateLotDocumentFile({ name: "sheet.numbers", type: "application/zip", size: 100 }).ok, true);
  assert.equal(validateLotDocumentFile({ name: "empty.pdf", type: "application/pdf", size: 0 }).ok, false);
  assert.equal(validateLotDocumentFile({ name: "../invoice.pdf", type: "application/pdf", size: 100 }).ok, false);
  assert.equal(validateLotDocumentFile({ name: "huge.pdf", type: "application/pdf", size: 16 * 1024 * 1024 }).ok, false);
  assert.equal(validateLotDocumentFile({ name: "script.exe", type: "application/x-msdownload", size: 100 }).ok, false);
  assert.equal(validateLotDocumentFile({ name: "fake.pdf", type: "image/png", size: 100 }).ok, false);
});
