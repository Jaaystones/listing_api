import { createApp } from "../../src/app.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createPool, type Pool } from "../../src/db/pool.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://listings:listings@localhost:5434/listings_test";

export async function setupTestApp(): Promise<{ app: ReturnType<typeof createApp>; pool: Pool }> {
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    await pool.end();
    throw new Error(
      `Cannot reach the test database at ${TEST_DATABASE_URL}. ` +
        `Start it with \`docker compose up -d db\` (or set TEST_DATABASE_URL). Cause: ${(err as Error).message}`,
      { cause: err },
    );
  }
  await runMigrations(pool);
  return { app: createApp(pool), pool };
}

export const resetDb = (pool: Pool) => pool.query("TRUNCATE listings");
