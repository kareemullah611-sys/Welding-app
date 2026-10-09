import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const pageName of ["sales", "payments"] as const) {
  test(`${pageName}: independent create-form reads start together and readiness waits for both`, async () => {
    const source = readFileSync(`src/app/(dashboard)/${pageName}/page.tsx`, "utf8");
    const start = source.indexOf("  const openCreate = async");
    assert.ok(start >= 0);
    const end = source.indexOf("\n  };", start) + 5;
    const body = ts.transpileModule(source.slice(start, end), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const setup = deferred<unknown>();
    const latest = deferred<unknown>();
    const started: string[] = [];
    const states: Record<string, unknown> = {};
    const bindings: Record<string, unknown> = {
      loadDropdowns: () => { started.push("setup"); return setup.promise; },
      loadHelpers: () => { started.push("setup"); return setup.promise; },
      loadLatestSaleSummary: () => { started.push("latest"); return latest.promise; },
      loadLatestCreateEntrySummary: () => { started.push("latest"); return latest.promise; },
      emptySaleItem: () => ({ productId: 0 }),
      isOnline: true,
      getOfflineFormReadinessError: () => null,
      buildInitialFormForType: (type: string, currencies: unknown[], preset: unknown) => ({ type, currencies, preset }),
    };
    for (const name of new Set(source.slice(start, end).match(/\bset[A-Z]\w+/g))) {
      bindings[name] = (value: unknown) => { states[name] = value; };
    }
    const open = new Function(...Object.keys(bindings), `${body}; return openCreate;`)(...Object.values(bindings));
    const pending = pageName === "sales" ? open() : open("payment");
    try {
      assert.deepEqual([...started].sort(), ["latest", "setup"]);
      const ready = pageName === "sales" ? "setSaleCreateFormReady" : "setCreateFormReady";
      assert.equal(states[ready], false);
      setup.resolve(pageName === "sales" ? true : { loadedCurrencies: [{ id: 1 }] });
      await Promise.resolve();
      assert.equal(states[ready], false);
      latest.resolve({ id: 123 });
      await pending;
      assert.equal(states[ready], true);
      assert.deepEqual(states[pageName === "sales" ? "setLatestCreatedSale" : "setLatestCreatedEntry"], { id: 123 });
    } finally {
      setup.resolve(pageName === "sales" ? true : { loadedCurrencies: [{ id: 1 }] });
      latest.resolve(null);
      await pending;
    }
  });
}
