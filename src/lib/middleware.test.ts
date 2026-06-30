import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { isCsrfSafe } from "./middleware";

function mutationRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/test", { method: "POST", headers });
}

test("production rejects cookie mutation without Origin or Referer", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  try {
    assert.equal(isCsrfSafe(mutationRequest()), false);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  }
});

test("production allows Bearer token without Origin", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(
      isCsrfSafe(mutationRequest({ authorization: "Bearer test-token" })),
      true
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});

test("production allows mutation when Origin matches app URL", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  try {
    assert.equal(
      isCsrfSafe(mutationRequest({ origin: "https://app.example.com" })),
      true
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  }
});

test("development allows mutation without Origin", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    assert.equal(isCsrfSafe(mutationRequest()), true);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});
