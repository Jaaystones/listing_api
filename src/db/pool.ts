import pg from "pg";
import { logger } from "../logger.js";

// Return NUMERIC columns as JS numbers instead of strings. Prices are stored as
// NUMERIC(15,2), which is well inside the range a double represents exactly to 2dp.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Fail fast instead of hanging requests when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    // JIT compilation suits long analytical queries. For these millisecond API queries it only
    // adds 100-250 ms of compile time (measured with `npm run bench`), so switch it off.
    options: "-c jit=off",
  });
  // An idle client can lose its connection (DB restart, failover, network blip). Without a
  // listener, pg's 'error' event is unhandled and crashes the process. The pool discards the
  // broken client and opens a new one on the next query, so logging is all that's needed.
  pool.on("error", (err) => logger.warn({ err }, "Idle Postgres client error; client discarded"));
  return pool;
}
