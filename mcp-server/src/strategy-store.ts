import { writeFile, readFile } from "node:fs/promises";
import { Pool } from "pg";

export type StrategyState = Record<string, { disabled: boolean; reason: string; at: string }>;

export interface StrategyStore {
  /** Human-readable description of where state is kept, for tool responses. */
  readonly description: string;
  disable(symbol: string, reason: string): Promise<{ at: string }>;
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

  constructor(private readonly path: string) {
    this.description = path;
  }

  async disable(symbol: string, reason: string): Promise<{ at: string }> {
    let state: StrategyState = {};
    try {
      state = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      state = {};
    }
    const at = new Date().toISOString();
    state[symbol] = { disabled: true, reason, at };
    await writeFile(this.path, JSON.stringify(state, null, 2));
    return { at };
  }
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
    this.pool = new Pool({ connectionString });
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
