import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createStrategyStore, FileStrategyStore, PostgresStrategyStore } from "./strategy-store.js";

describe("createStrategyStore", () => {
  it("falls back to a FileStrategyStore when no DATABASE_URL is given", () => {
    const store = createStrategyStore(undefined, "./strategy_state.json");
    expect(store).toBeInstanceOf(FileStrategyStore);
  });

  it("chooses PostgresStrategyStore whenever a DATABASE_URL is given, so Render deploys never fall back to the ephemeral filesystem", () => {
    const store = createStrategyStore("postgres://user:pass@host/db", "./strategy_state.json");
    expect(store).toBeInstanceOf(PostgresStrategyStore);
    expect(store.description).toBe("the durable strategy_state table");
  });
});

describe("FileStrategyStore", () => {
  const path = join(tmpdir(), `strategy-state-${randomUUID()}.json`);

  afterEach(async () => {
    await rm(path, { force: true });
  });

  it("creates the file on first disable and records disabled/reason/at", async () => {
    const store = new FileStrategyStore(path);
    const { at } = await store.disable("SPY", "unexplained drawdown");

    const written = JSON.parse(await readFile(path, "utf8"));
    expect(written).toEqual({ SPY: { disabled: true, reason: "unexplained drawdown", at } });
  });

  it("merges into existing entries instead of clobbering other symbols", async () => {
    const store = new FileStrategyStore(path);
    await store.disable("SPY", "first reason");
    await store.disable("QQQ", "second reason");

    const written = JSON.parse(await readFile(path, "utf8"));
    expect(Object.keys(written).sort()).toEqual(["QQQ", "SPY"]);
    expect(written.SPY.reason).toBe("first reason");
    expect(written.QQQ.reason).toBe("second reason");
  });

  it("getState reflects what disable() just wrote, for the /strategy-state poller", async () => {
    const store = new FileStrategyStore(path);
    await store.disable("SPY", "unexplained drawdown");

    const state = await store.getState();
    expect(state.SPY).toMatchObject({ disabled: true, reason: "unexplained drawdown" });
  });

  it("getState returns an empty object when nothing has been disabled yet", async () => {
    const store = new FileStrategyStore(path);
    expect(await store.getState()).toEqual({});
  });

  it("checkHealth resolves without touching the filesystem", async () => {
    const store = new FileStrategyStore(path);
    await expect(store.checkHealth()).resolves.toBeUndefined();
  });

  it("serializes concurrent disables instead of losing one to a read-modify-write race", async () => {
    const store = new FileStrategyStore(path);

    // Fire both disables without awaiting the first, so their read-modify-write
    // cycles would overlap absent the internal write queue.
    await Promise.all([store.disable("SPY", "reason A"), store.disable("QQQ", "reason B")]);

    const written = JSON.parse(await readFile(path, "utf8"));
    expect(Object.keys(written).sort()).toEqual(["QQQ", "SPY"]);
    expect(written.SPY.reason).toBe("reason A");
    expect(written.QQQ.reason).toBe("reason B");
  });
});
