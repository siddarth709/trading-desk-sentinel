import { writeFile, readFile } from "node:fs/promises";
import { Pool } from "pg";

export type StrategyState = Record<string, { disabled: boolean; reason: string; at: string }>;

export interface StrategyStore {
  /** Human-readable description of where state is kept, for tool responses. */
  readonly description: string;
  disable(symbol: string, reason: string): Promise<{ at: string }>;
  /**
   * Full current kill-switch state. This is the read side that the
   * `/strategy-state` HTTP endpoint exposes so the separately-built OAA
   * pipeline can poll it over HTTP instead of reading a local file —
   * the only integration path that works the same way regardless of
   * whether disable() is backed by Postgres or the local file fallback.
   */
  getState(): Promise<StrategyState>;
  /**
   * Cheap connectivity check used by GET /health. A store that can't
   * actually persist a disable shouldn't report healthy just because the
   * Node process is up — Render uses /health to decide whether to keep
   * routing traffic (and restart the service), so this needs to reflect
   * the real backend, not just process liveness.
   */
  checkHealth(): Promise<void>;
}

/**
 * Local-file store. Fine for local development, where the process and its
 * working directory persist for the life of the session — but this must
 * never be the store used in the Render deployment: free web services have
 * an ephemeral filesystem and discard local writes on every restart,
 * redeploy, or spin-down, which would silently resurrect a "disabled"
 * strategy. See PostgresStrategyStore for the durable alternative.
 */
export class FileStrategyStore implements StrategyStore {
  readonly description: string;

  // Serializes disable() calls against this file. Without this, two
  // concurrent disables (e.g. two symbols flagged moments apart) can both
  // read the same on-disk state before either writes, and the second
  // write silently clobbers the first symbol's entry — a classic
  // read-modify-write race on a single shared file.
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {
    this.description = path;
  }

  async disable(symbol: string, reason: string): Promise<{ at: string }> {
    const at = new Date().toISOString();
    const task = this.writeQueue.then(async () => {
      let state: StrategyState = {};
      try {
        state = JSON.parse(await readFile(this.path, "utf8"));
      } catch {
        state = {};
      }
      state[symbol] = { disabled: true, reason, at };
      await writeFile(this.path, JSON.stringify(state, null, 2));
    });
    // Keep the queue alive even if this write fails, so a failed disable
    // doesn't permanently wedge every disable() call after it; the
    // rejection itself still propagates to this caller.
    this.writeQueue = task.catch(() => {});
    await task;
    return { at };
  }

  async getState(): Promise<StrategyState> {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      return {};
    }
  }

  // The local file fallback has no external dependency to go down; being
  // constructed is sufficient. Read/write failures surface directly from
  // disable()/getState() instead.
  async checkHealth(): Promise<void> {}
}

/**
 * Postgres-backed store. Durable across restarts, redeploys, and spin-downs,
 * which is what the Render deployment needs since its free web service
 * cannot attach a persistent disk (see render.yaml's `sentinel-strategy-state`
 * database and the `DATABASE_URL` env var wired into the mcp-server service).
 *
 * Note: Render's free Postgres plan is auto-deleted 30 days after creation.
 * That's a separate, milder limitation than the bug this fixes (the state
 * used to vanish on every restart/redeploy/spin-down; now it only needs
 * attention once a month). Recreate the database and update DATABASE_URL
 * before day 30, or upgrade the database to a paid plan, to avoid a gap.
 */
export class PostgresStrategyStore implements StrategyStore {
  readonly description = "the durable strategy_state table";

  private readonly pool: Pool;
  private readonly ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      // Without these, a database that's up but unresponsive (network
      // partition, connection storm, etc.) makes disable(), getState(),
      // and checkHealth() hang indefinitely instead of failing. That
      // defeats the point of the /health check: Render needs a bounded
      // answer to tell "slow" from "down" and act on it.
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
    });
    // Required by the pg docs: an idle client can emit an error in the
    // background (e.g. the connection being dropped by the server), and
    // without this handler that crashes the whole process.
    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle Postgres client:", err);
    });
    this.ready = this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS strategy_state (
           symbol TEXT PRIMARY KEY,
           disabled BOOLEAN NOT NULL,
           reason TEXT NOT NULL,
           at TIMESTAMPTZ NOT NULL
         )`,
      )
      .then(() => undefined);
    // The table-creation query above runs immediately, before any caller has
    // a chance to await `ready` (e.g. via disable()). Without this, a
    // failure here — say, an unreachable database at startup — surfaces as
    // an unhandled promise rejection instead of a normal error the first
    // time disable() is actually called and awaits `ready` itself.
    this.ready.catch(() => {});
  }

  async disable(symbol: string, reason: string): Promise<{ at: string }> {
    await this.ready;
    const at = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO strategy_state (symbol, disabled, reason, at)
       VALUES ($1, true, $2, $3)
       ON CONFLICT (symbol) DO UPDATE SET disabled = true, reason = $2, at = $3`,
      [symbol, reason, at],
    );
    return { at };
  }

  async getState(): Promise<StrategyState> {
    await this.ready;
    const { rows } = await this.pool.query<{ symbol: string; disabled: boolean; reason: string; at: string | Date }>(
      `SELECT symbol, disabled, reason, at FROM strategy_state`,
    );
    const state: StrategyState = {};
    for (const row of rows) {
      state[row.symbol] = {
        disabled: row.disabled,
        reason: row.reason,
        at: row.at instanceof Date ? row.at.toISOString() : row.at,
      };
    }
    return state;
  }

  async checkHealth(): Promise<void> {
    await this.ready;
    await this.pool.query("SELECT 1");
  }
}

/**
 * Picks the durable Postgres store whenever DATABASE_URL is configured
 * (always true on Render, via render.yaml), and falls back to a local file
 * only when it isn't (local `npm run dev`, where no database is required).
 */
export function createStrategyStore(databaseUrl: string | undefined, filePath: string): StrategyStore {
  if (databaseUrl) {
    return new PostgresStrategyStore(databaseUrl);
  }
  return new FileStrategyStore(filePath);
}
