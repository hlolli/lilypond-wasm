import { describe, expect, test } from "bun:test";
import type { CsoundObj } from "@csound/browser";
import {
  CsoundModuleLoader,
  type CsoundCreateOptions,
  type CsoundFactory,
} from "./csound-module";

const createOptions: CsoundCreateOptions = {
  autoConnect: false,
  useWorker: true,
  useSAB: false,
};

describe("CsoundModuleLoader", () => {
  test("preloads the module without creating Csound", async () => {
    let createCalls = 0;
    const factory: CsoundFactory = async () => {
      createCalls += 1;
      return {} as CsoundObj;
    };
    const loader = new CsoundModuleLoader(async () => ({ default: factory }));

    await loader.preload();

    expect(loader.ready).toBe(true);
    expect(createCalls).toBe(0);

    const created = loader.create(createOptions);
    expect(createCalls).toBe(1);
    expect(await created).toBeDefined();
  });

  test("shares a pending preload and asks for another Play attempt", async () => {
    let resolveModule:
      | ((module: { default: CsoundFactory }) => void)
      | undefined;
    let importCalls = 0;
    const factory: CsoundFactory = async () => ({} as CsoundObj);
    const loader = new CsoundModuleLoader(() => {
      importCalls += 1;
      return new Promise((resolve) => {
        resolveModule = resolve;
      });
    });

    const preload = loader.preload();
    expect(() => loader.create(createOptions)).toThrow("press Play again");
    expect(importCalls).toBe(1);

    resolveModule?.({ default: factory });
    await preload;
    expect(await loader.create(createOptions)).toBeDefined();
  });

  test("allows a failed module preload to retry", async () => {
    const factory: CsoundFactory = async () => ({} as CsoundObj);
    let importCalls = 0;
    const loader = new CsoundModuleLoader(async () => {
      importCalls += 1;
      if (importCalls === 1) {
        throw new Error("network failed");
      }
      return { default: factory };
    });

    await expect(loader.preload()).rejects.toThrow("network failed");
    await loader.preload();

    expect(importCalls).toBe(2);
    expect(loader.ready).toBe(true);
  });
});
