import pg from "pg";

// Return NUMERIC columns as JS numbers instead of strings. Prices are stored as
// NUMERIC(15,2), which is well inside the range a double represents exactly to 2dp.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}
