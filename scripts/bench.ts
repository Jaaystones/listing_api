/**
 * Benchmarks the search queries against a large synthetic dataset.
 *
 *   npm run bench                 # 500k listings in the listings_bench database
 *   BENCH_ROWS=1000000 npm run bench
 *
 * Uses its own database (created if missing) so demo and test data are untouched.
 */
import { performance } from "node:perf_hooks";
import pg from "pg";
import { runMigrations } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { ListingRepository } from "../src/listings/repository.js";
import { searchQuerySchema } from "../src/listings/schemas.js";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://listings:listings@localhost:5434/listings";
const BENCH_DB = "listings_bench";
const ROWS = Number(process.env.BENCH_ROWS ?? 500_000);
const RUNS = 30;

// Query strings exactly as a client would send them, parsed by the real validation schema.
const SCENARIOS: [string, string][] = [
  ["List, page 1 (newest first)", "page=1&limit=20"],
  ["List, page 500 (offset 9,980)", "page=500&limit=20"],
  ["Filter: rent, 1M–10M, 3 bedrooms", "type=rent&minPrice=1000000&maxPrice=10000000&bedrooms=3"],
  ["Filter: price ≥ 1M only (broad)", "minPrice=1000000"],
  ["Geo: 2 km around Victoria Island", "lat=6.4281&lng=3.4219&radiusKm=2"],
  ["Geo: 10 km + rent + 2+ bedrooms", "lat=6.4281&lng=3.4219&radiusKm=10&type=rent&minBedrooms=2"],
  ["Geo: 25 km (most of Lagos)", "lat=6.5244&lng=3.3792&radiusKm=25"],
];

async function ensureDataset() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [BENCH_DB]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${BENCH_DB}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${BENCH_DB}`;
  const pool = createPool(url.toString());
  await runMigrations(pool);

  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM listings");
  if (rows[0].n < ROWS) {
    console.log(`Generating ${ROWS - rows[0].n} listings (one-off, takes a minute)...`);
    const client = await pool.connect();
    await client.query("SET statement_timeout = 0");
    // ~70% spread over metro Lagos, ~30% over Abuja, created over the past year.
    await client.query(
      `INSERT INTO listings (title, price, type, bedrooms, location, agent_id, created_at)
       SELECT 'Bench listing ' || g,
              round((50000 + random() * 500000000)::numeric, 2),
              (ARRAY['rent','sale','shortlet'])[1 + floor(random() * 3)::int]::listing_type,
              floor(random() * 7)::int,
              CASE WHEN random() < 0.7
                THEN ST_SetSRID(ST_MakePoint(3.20 + random() * 0.45, 6.40 + random() * 0.30), 4326)::geography
                ELSE ST_SetSRID(ST_MakePoint(7.30 + random() * 0.30, 8.95 + random() * 0.20), 4326)::geography END,
              gen_random_uuid(),
              now() - random() * interval '365 days'
       FROM generate_series(1, $1) g`,
      [ROWS - rows[0].n],
    );
    await client.query("ANALYZE listings");
    client.release();
  }
  return pool;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function main() {
  const pool = await ensureDataset();
  const repo = new ListingRepository(pool);
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM listings");
  console.log(`\nDataset: ${rows[0].n.toLocaleString()} listings. ${RUNS} runs per query after warm-up.\n`);

  const results = [];
  for (const [name, qs] of SCENARIOS) {
    const query = searchQuerySchema.parse(Object.fromEntries(new URLSearchParams(qs)));
    let page = await repo.search(query);
    for (let i = 0; i < 2; i++) page = await repo.search(query); // warm-up
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      await repo.search(query);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    results.push({
      query: name,
      matches: page.total.toLocaleString() + (page.totalExact ? "" : "+"),
      "p50 ms": percentile(times, 0.5).toFixed(1),
      "p95 ms": percentile(times, 0.95).toFixed(1),
    });
  }
  console.table(results);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
