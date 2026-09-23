# Property Listings API

[![CI](https://github.com/Jaaystones/listing_api/actions/workflows/ci.yml/badge.svg)](https://github.com/Jaaystones/listing_api/actions/workflows/ci.yml)

A REST API for property listings: CRUD, filtered search, and "within X km of a point" search. Built with **Node.js + TypeScript + Express 5**, **PostgreSQL 16 + PostGIS**, **Zod** for validation, and **Vitest + Supertest** for tests.

- [Quick start](#quick-start) · [Requirements checklist](#requirements-checklist) · [Running without Docker](#running-without-docker)
- [API reference](#api-reference) · [Testing](#testing) · [Performance](#performance)
- [Design choices](#design-choices) · [Assumptions](#assumptions) · [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting) · [What I'd improve with more time](#what-id-improve-with-more-time)

---

## Quick start

The only requirement is **Docker** with Compose v2 (Docker Desktop includes it).

```bash
git clone https://github.com/Jaaystones/listing_api.git && cd listing_api
docker compose up --build
```

This starts PostgreSQL + PostGIS and the API. On boot the API runs the database migrations and adds **12 demo listings** in Lagos and Abuja.

1. **Try it in the browser: http://localhost:3000/docs.** This is Swagger UI. Every endpoint has **Try it out** with example values filled in. Run `GET /listings` first to get real listing ids.
2. **Or use curl:**
   ```bash
   curl localhost:3000/health
   curl "localhost:3000/listings/search?lat=6.4281&lng=3.4219&radiusKm=10"   # near Victoria Island, Lagos
   ```
3. **Run the full test suite** (53 tests) inside Docker, no Node needed:
   ```bash
   docker compose run --rm --build test
   ```

To stop: `docker compose down`. Add `-v` to delete the database as well.

> Ports: the API uses **3000** and Postgres uses **5434** on the host (to avoid a local Postgres on 5432). If either is taken: `API_HOST_PORT=8080 DB_HOST_PORT=5555 docker compose up --build`.

---

## Requirements checklist

| #   | Task requirement                                                                       | Where it's met                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CRUD for listings (title, price, type rent/sale/shortlet, bedrooms, lat/lng, agent ID) | `POST`, `GET`, `PUT`, `PATCH`, `DELETE` on `/listings` ([routes.ts](src/listings/routes.ts)). Location is a PostGIS `geography(Point)` ([migration](migrations/001_create_listings.sql)).                                                                  |
| 2   | Search by type, price range and bedrooms, and within X km of a point                   | `GET /listings/search` ([repository.ts](src/listings/repository.ts)). Filters combine freely. The radius search uses the spatial index and returns results nearest first with `distanceKm`.                                                                |
| 3   | Pagination, input validation, sensible error handling                                  | `page`/`limit` with totals on every list. Every body, query string and id is validated with Zod ([schemas.ts](src/listings/schemas.ts)). One error format with codes and per-field messages; 400/404/413/415/500/503 ([middleware.ts](src/middleware.ts)). |
| 4   | At least a few unit or integration tests                                               | 53 tests: unit tests for validation and HTTP behaviour, integration tests against a real PostGIS database. Run in CI on every push. See [Testing](#testing).                                                                                               |
| 5   | README: setup, design choices, improvements                                            | This file: [Quick start](#quick-start), [Design choices](#design-choices), [What I'd improve](#what-id-improve-with-more-time).                                                                                                                            |

Beyond the brief: Swagger docs, a benchmark at 500,000 listings with the query work it led to ([Performance](#performance)), structured logs with request IDs, graceful handling of database outages, CORS, ESLint + Prettier, and GitHub Actions CI.

---

## Running without Docker

Requires **Node 20+**. Postgres still runs in Docker.

```bash
npm install
cp .env.example .env      # optional: the values shown are also the built-in defaults
docker compose up -d db   # PostGIS on localhost:5434; also creates the listings_test database
npm run migrate
npm run seed              # optional demo data
npm run dev               # http://localhost:3000, reloads on changes, readable logs
```

| Script                        | What it does                                                             |
| ----------------------------- | ------------------------------------------------------------------------ |
| `npm test`                    | All tests (integration tests need the database running)                  |
| `npm run test:unit`           | Unit tests only; no database needed                                      |
| `npm run lint`                | ESLint with type-aware rules                                             |
| `npm run format:check`        | Prettier check (`npm run format` to fix)                                 |
| `npm run typecheck`           | TypeScript, no output                                                    |
| `npm run build` / `npm start` | Compile to `dist/` and run the compiled server                           |
| `npm run bench`               | Performance benchmark on 500k listings (see [Performance](#performance)) |

| Env var             | Default                                                     | Purpose                                             |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `PORT`              | `3000`                                                      | HTTP port                                           |
| `DATABASE_URL`      | `postgres://listings:listings@localhost:5434/listings`      | Postgres connection                                 |
| `TEST_DATABASE_URL` | `postgres://listings:listings@localhost:5434/listings_test` | Database used by integration tests (wiped per test) |
| `LOG_LEVEL`         | `info`                                                      | pino log level (`silent` during tests)              |
| `CORS_ORIGIN`       | `*`                                                         | `*`, or a comma-separated allow-list of origins     |

---

## API reference

The same reference, with a live **Try it out**, is at **`/docs`**. The raw OpenAPI 3 spec is at `/openapi.json`.

**Conventions**

- Requests and responses are JSON. Request bodies must be sent with `Content-Type: application/json`.
- Successful responses wrap the payload in `data`. Lists also return `pagination`.
- Every response has an `X-Request-Id` header (an incoming one is reused). It's also in the server logs, so a failed request can be traced.

| Method   | Path               | Description                              | Success                 |
| -------- | ------------------ | ---------------------------------------- | ----------------------- |
| `GET`    | `/docs`            | Swagger UI (`/` redirects here)          | 200                     |
| `GET`    | `/openapi.json`    | OpenAPI 3 spec                           | 200                     |
| `GET`    | `/health`          | Health check, including a database ping  | 200, or 503 if DB down  |
| `POST`   | `/listings`        | Create a listing                         | 201 + `Location` header |
| `GET`    | `/listings`        | List listings, newest first              | 200                     |
| `GET`    | `/listings/search` | Filter and radius search                 | 200                     |
| `GET`    | `/listings/:id`    | Get one listing                          | 200                     |
| `PUT`    | `/listings/:id`    | Replace a listing (every field required) | 200                     |
| `PATCH`  | `/listings/:id`    | Update only the fields sent              | 200                     |
| `DELETE` | `/listings/:id`    | Delete a listing                         | 204                     |

### Listings

Request body for `POST` and `PUT` (`PATCH` accepts any subset, but at least one field):

```json
{
  "title": "3 bedroom flat, Lekki Phase 1",
  "price": 6500000,
  "type": "rent",
  "bedrooms": 3,
  "location": { "lat": 6.4478, "lng": 3.4723 },
  "agentId": "11111111-1111-4111-8111-111111111111"
}
```

| Field      | Rules                                                     |
| ---------- | --------------------------------------------------------- |
| `title`    | string, 3–200 characters (surrounding spaces are trimmed) |
| `price`    | number ≥ 0 with at most 2 decimal places (Naira)          |
| `type`     | `rent`, `sale` or `shortlet`                              |
| `bedrooms` | integer 0–50 (0 = studio)                                 |
| `location` | `{ "lat": -90 to 90, "lng": -180 to 180 }`                |
| `agentId`  | UUID (see note below)                                     |

Unknown fields are rejected, so a typo doesn't silently get dropped. A response looks like this:

```json
{
  "data": {
    "id": "7c0d3c1e-5b0e-4c43-9a55-1f0b6f0c2a11",
    "title": "3 bedroom flat, Lekki Phase 1",
    "price": 6500000,
    "type": "rent",
    "bedrooms": 3,
    "location": { "lat": 6.4478, "lng": 3.4723 },
    "agentId": "11111111-1111-4111-8111-111111111111",
    "createdAt": "2026-09-23T14:20:44.381Z",
    "updatedAt": "2026-09-23T14:20:44.381Z"
  }
}
```

> **About `agentId`:** there is no agents table in this task, so the API doesn't check that an agent exists. It only checks that `agentId` is a well-formed UUID: `8-4-4-4-12` hex characters, as in the example. A shortened value such as `11111111-1111-4111-8111-11111` is rejected with `400 VALIDATION_ERROR`. The demo data uses two agent ids you can reuse:
>
> - `11111111-1111-4111-8111-111111111111`
> - `22222222-2222-4222-8222-222222222222`

```bash
# Create
curl -X POST localhost:3000/listings -H 'Content-Type: application/json' -d '{
  "title": "2 bedroom flat, Yaba", "price": 2800000, "type": "rent", "bedrooms": 2,
  "location": { "lat": 6.5095, "lng": 3.3711 }, "agentId": "11111111-1111-4111-8111-111111111111"
}'

# Read, partially update, delete
curl localhost:3000/listings/<id>
curl -X PATCH localhost:3000/listings/<id> -H 'Content-Type: application/json' -d '{"price": 2500000}'
curl -X DELETE localhost:3000/listings/<id>
```

### Search: `GET /listings/search`

Every parameter is optional; the ones you send are combined with AND.

| Parameter                    | Example                   | Notes                                                     |
| ---------------------------- | ------------------------- | --------------------------------------------------------- |
| `type`                       | `rent` or `rent,shortlet` | one type, or several separated by commas                  |
| `minPrice`, `maxPrice`       | `1000000`                 | inclusive; `minPrice` must be ≤ `maxPrice`                |
| `bedrooms`                   | `3`                       | exact number                                              |
| `minBedrooms`, `maxBedrooms` | `2`                       | inclusive range; can't be combined with `bedrooms`        |
| `lat`, `lng`, `radiusKm`     | `6.4281`, `3.4219`, `10`  | send all three or none; radius above 0 and at most 500 km |
| `agentId`                    | UUID                      | listings from one agent                                   |
| `page`, `limit`              | `1`, `20`                 | `limit` at most 100; see [Pagination](#pagination)        |

- **Ordering:** newest first. With a radius search, **nearest first** instead, and each result gets a `distanceKm` field. Listings at exactly the same distance (e.g. flats in one building) are ordered by id, so paging never repeats or skips them.
- **Bedrooms:** use **either** `bedrooms` **or** `minBedrooms`/`maxBedrooms`. Sending both returns `400` ("Use either bedrooms or minBedrooms/maxBedrooms, not both"), because a mix like `bedrooms=3&minBedrooms=4` can never match; an error says so instead of quietly returning an empty list. In Swagger, clear the bedroom fields you don't need before clicking **Execute**.
  - Exactly 3: `bedrooms=3` · 2 to 4: `minBedrooms=2&maxBedrooms=4` · at least 2: `minBedrooms=2`
- **Unknown parameters are rejected**, so a typo like `min_price` returns a 400 rather than unfiltered results.

```bash
# Rentals or shortlets, 1M–10M Naira, 2+ bedrooms, within 15 km of Victoria Island
curl "localhost:3000/listings/search?type=rent,shortlet&minPrice=1000000&maxPrice=10000000&minBedrooms=2&lat=6.4281&lng=3.4219&radiusKm=15"
```

```json
{
  "data": [
    { "id": "…", "title": "3 bedroom flat, Lekki Phase 1", "distanceKm": 5.984, "...": "..." },
    { "id": "…", "title": "2 bedroom apartment, Yaba", "distanceKm": 10.65, "...": "..." }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 2, "totalExact": true, "totalPages": 1 }
}
```

### Pagination

`GET /listings` and `GET /listings/search` both take `page` (from 1) and `limit` (1–100, default 20) and return:

| Field        | Meaning                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `total`      | number of matches, counted up to 10,000                                                      |
| `totalExact` | `true` normally; `false` when there are more than 10,000 matches (`total` is then "10,000+") |
| `totalPages` | `ceil(total / limit)`                                                                        |

`page × limit` can be at most **10,000** (e.g. page 500 at limit 20); deeper requests return a 400 asking you to narrow the search. Both limits are for performance and are explained under [Performance](#performance). They're the same trade-off Elasticsearch makes with its default `max_result_window`.

### Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "price", "message": "Number must be greater than or equal to 0" }]
  }
}
```

| Status | `code`                   | When                                                                                            |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | invalid body, query or id (not a UUID); unknown fields or parameters; page too deep             |
| 400    | `INVALID_JSON`           | body is not valid JSON                                                                          |
| 400    | `CONSTRAINT_VIOLATION`   | a value passed validation but broke a database constraint (e.g. price too large for the column) |
| 404    | `NOT_FOUND`              | listing or route doesn't exist                                                                  |
| 413    | `PAYLOAD_TOO_LARGE`      | body larger than 100 KB                                                                         |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | body sent without `Content-Type: application/json`                                              |
| 500    | `INTERNAL_ERROR`         | unexpected error; details go to the logs, never to the client                                   |
| 503    | `SERVICE_UNAVAILABLE`    | database unreachable; safe to retry                                                             |

---

## Testing

```bash
docker compose run --rm --build test   # everything, inside Docker
npm test                               # everything, locally (needs `docker compose up -d db`)
npm run test:unit                      # no database needed
```

| File                                                                     | Tests | What it covers                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tests/unit/schemas.test.ts](tests/unit/schemas.test.ts)                 |    20 | Validation rules: each field, query coercion, empty values, inverted ranges, geo parameters sent together, radius and page limits, unknown fields                                                                                  |
| [tests/unit/http.test.ts](tests/unit/http.test.ts)                       |     8 | HTTP behaviour with no database: 503 when the database is unreachable (and the process survives), generic 500s that leak nothing, 413, 415, request ids, CORS                                                                      |
| [tests/integration/listings.test.ts](tests/integration/listings.test.ts) |    22 | Full HTTP → PostGIS: every CRUD operation, each search filter alone and combined, radius search distances and ordering, stable paging over listings at identical coordinates, the 10,000 count cap and page limit, error responses |
| [tests/integration/docs.test.ts](tests/integration/docs.test.ts)         |     3 | Swagger UI and the spec are served, and every documented endpoint really exists                                                                                                                                                    |

Integration tests use real PostGIS rather than mocks, because the behaviour that matters most (distances, index use, ordering, constraints) lives in the database. They run against a separate `listings_test` database that is emptied before each test. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, format check, typecheck, build and all tests against a PostGIS service on every push.

---

## Performance

The job is about keeping APIs fast "as listings and traffic grow", so I benchmarked the search at a realistic size instead of assuming it scales. [`npm run bench`](scripts/bench.ts) loads **500,000 listings** spread over Lagos and Abuja into a separate `listings_bench` database, then runs each query 30 times through the API's real search code.

Results in milliseconds, before and after the changes below. Measured on a 2015 Intel Core i5 laptop with Postgres in Docker (4 vCPUs), so absolute numbers are pessimistic; the before/after ratios are what matter.

| Query (500k listings)             | Matches | p50 before | p50 after | p95 before | p95 after |
| --------------------------------- | ------: | ---------: | --------: | ---------: | --------: |
| List, page 1                      |    500k |         71 |   **3.2** |        131 |       4.6 |
| List, page 500 (offset 9,980)     |    500k |         69 |    **22** |        104 |        29 |
| Filter: rent, 1M–10M, 3 bedrooms  |     446 |         28 |    **22** |         63 |        33 |
| Filter: price ≥ 1M only (broad)   |    499k |        194 |   **4.4** |        509 |       9.7 |
| Radius 2 km                       |   2,819 |         68 |    **31** |        110 |        38 |
| Radius 10 km + rent + 2+ bedrooms |     11k |        305 |   **146** |        780 |       291 |
| Radius 25 km (most of Lagos)      |    298k |      1,796 |   **100** |      2,633 |       135 |

**What the benchmark found, and the fixes** (each confirmed with `EXPLAIN ANALYZE`):

1. **Wide radius searches computed the distance to every match before sorting.** Ordering by `(distance, id)` stops Postgres from using the spatial index's nearest-neighbour scan, so a 25 km search computed and sorted ~300,000 distances. The query now works in two steps: a nearest-neighbour index scan finds the distance of the last row the page needs, and only rows within that distance are sorted exactly. Ties are all inside that distance, so ordering stays exact and paging stays stable (there's a test for listings in the same building). **~18× faster.**
2. **Counting every match cost more than fetching the page.** `total` needs a full count, which for a broad search means reading ~500,000 rows. Totals are now counted exactly up to 10,000 and reported as a lower bound past that (`totalExact: false`). **~20–45× faster** for broad queries.
3. **PostgreSQL's JIT compiler added 100–250 ms per query.** JIT is designed for long analytical queries; for millisecond API queries the compile time is pure overhead. It's turned off for the API's connections.
4. **Deep pages get slower with `OFFSET`**, so `page × limit` is capped at 10,000. Beyond that, the right tool is cursor pagination (see [improvements](#what-id-improve-with-more-time)).
5. **A migration bug:** the 10 s request timeout also applied to migrations, and installing PostGIS on a fresh database takes about 10.5 s. It would have failed on a clean production database (the Docker image doesn't hit it because PostGIS is pre-installed there). Migrations now run without the request timeout.

**Remaining bottleneck:** very broad radius searches (10,000+ matches) still take ~100–150 ms, almost all of it the capped count. The underlying cause is that PostGIS estimates `ST_DWithin` at a fixed 50 rows whatever the radius, so the planner picks a scan that can't stop early. The next step would be cached or pre-aggregated counts (e.g. per map tile) rather than more query tuning.

Distances use a sphere rather than the WGS-84 spheroid. That's within ~0.5%, fine for property search, and lets one measure drive the radius filter, the ordering, the index scan and the returned `distanceKm`, so they never disagree.

---

## Design choices

- **PostgreSQL + PostGIS for location search.** `location` is a `geography(Point, 4326)` column with a GiST spatial index. The radius filter (`ST_DWithin`) and nearest-first ordering (`<->`) both use the index. Computing distances in application code, or with a Haversine formula in plain SQL, can't use an index and slows down in proportion to the table size.
- **Raw, parameterised SQL in one repository layer** instead of an ORM. The spatial queries needed hand-tuning (see [Performance](#performance)), which an ORM would get in the way of. Every value is a bind parameter, so there is no SQL-injection risk. Routes contain no SQL, and the repository knows nothing about HTTP.
- **Validation at the edge with Zod.** Bodies, query strings and ids are parsed before any handler logic, and the parsed types flow into the repository. Query strings are converted to numbers, and empty values count as "not provided", which is what Swagger and HTML forms send.
- **Strict inputs.** Unknown fields and parameters are rejected, and contradictory filters (`minPrice > maxPrice`, `bedrooms` with a range) return a 400. Silently ignoring bad input returns wrong results, which is harder to debug than an error.
- **One error format and a central error handler.** Every failure has the same `{ error: { code, message, details } }` shape, and internal errors never reach the client. Express 5 forwards errors from async handlers automatically.
- **The database enforces rules too**: `CHECK` constraints on price, bedrooms and title length, and an `ENUM` for `type`, so bad data can't get in by another route (a script, a future service).
- **PUT and PATCH:** PUT replaces the listing and needs every field; PATCH changes only what's sent.
- **Survives database outages.** A dropped database connection (restart, failover) is logged and replaced instead of crashing the process. While the database is unreachable, requests fail fast (5 s connect timeout, 10 s query timeout) with `503`, and `/health` returns 503 so a load balancer or Docker can route around the instance. When the database is back, the API recovers without a restart.
- **Structured logs with request IDs** (pino). One JSON line per request with method, path, status and duration; 4xx logs at `warn`, 5xx at `error` with the stack trace. Authorisation and cookie headers are redacted.
- **CORS** for the web and mobile apps, configurable with `CORS_ORIGIN`. `Location` and `X-Request-Id` are readable by browser clients.
- **Hand-written OpenAPI spec + Swagger UI.** Tools that generate a spec from Zod describe the query-string conversions poorly, so I wrote it by hand. A test calls every documented endpoint and fails if one doesn't exist, which stops the docs drifting from the code.
- **Engineering habits:** ESLint with type-aware rules (catches mistakes like un-awaited promises), Prettier, and CI on every push.
- **Docker-first:** a multi-stage image running as a non-root user, migrations on start guarded by a lock (safe with several instances), health checks on both containers, automatic restart, and graceful shutdown on `SIGTERM`.

## Assumptions

- **Prices are in Naira.** What a price means depends on the type (per year for rent, per night for shortlet, total for sale); that isn't modelled.
- **`bedrooms: 0` is a studio / self-contained unit.**
- **All listings are public and anyone can edit them.** The task has no users or agents, so there is no authentication; `agentId` is a plain reference. See improvements.
- **"Within X km" means straight-line (great-circle) distance**, not travel distance. The radius is capped at 500 km, which covers any metro area, to stop searches that scan most of the table.
- **Several types can be searched at once** (`type=rent,shortlet`), since "rent or shortlet" is a common need.

## Project structure

```
src/
  app.ts                   Express app: middleware order, routes, health check
  server.ts                Entry point: HTTP server, graceful shutdown
  config.ts                Environment variables
  logger.ts                pino logger
  errors.ts                HttpError types
  middleware.ts            JSON-only guard, 404 handler, central error handler
  docs/openapi.ts          OpenAPI 3 spec, served by Swagger UI at /docs
  db/
    pool.ts                Connection pool: timeouts, JIT off, error listener
    migrate.ts             Minimal migration runner (tracked in schema_migrations, lock-guarded)
    seed.ts                12 demo listings (only inserted into an empty table)
  listings/
    schemas.ts             Zod schemas for bodies and query strings; paging limits
    repository.ts          All listing SQL, including the two-step radius search
    routes.ts              HTTP handlers
migrations/                Plain .sql migrations
scripts/bench.ts           Performance benchmark (npm run bench)
tests/
  unit/                    Validation and HTTP behaviour (no database)
  integration/             HTTP → PostGIS tests with Supertest
docker/init-test-db.sql    Creates the test database on first start
.github/workflows/ci.yml   Lint, format check, typecheck, build, tests
```

## Troubleshooting

| Problem                                                              | Fix                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `port is already allocated`                                          | Another service is on 3000 or 5434: `API_HOST_PORT=8080 DB_HOST_PORT=5555 docker compose up --build`                             |
| Warning about `linux/amd64` platform, or slow start on Apple Silicon | Expected. The PostGIS image is published for Intel only, so Docker Desktop runs it under emulation. It works, just a bit slower. |
| Tests fail with `Cannot reach the test database`                     | Start it with `docker compose up -d db`, or run the tests inside Docker: `docker compose run --rm --build test`                  |
| `database "listings_test" does not exist`                            | The database volume predates the test-DB setup. Reset it: `docker compose down -v`, then start again                             |
| Search returns `400` about bedrooms                                  | Send either `bedrooms` or `minBedrooms`/`maxBedrooms`, not both (see [Search](#search-get-listingssearch))                       |
| Create returns `400` for `agentId`                                   | It must be a full UUID, e.g. `11111111-1111-4111-8111-111111111111`                                                              |
| Create returns `415`                                                 | Send the header `Content-Type: application/json`                                                                                 |

## What I'd improve with more time

- **Authentication and authorisation:** JWTs, so only the owning agent (or an admin) can edit or delete a listing; plus rate limiting.
- **Cursor (keyset) pagination** for infinite scroll. It stays fast at any depth and doesn't shift when new listings arrive, and it would remove the 10,000 page limit.
- **Faster counts for broad radius searches:** cache counts in Redis, or keep pre-aggregated counts per map tile (e.g. H3 cells), so "10,000+ homes in this area" costs a lookup instead of a scan.
- **Caching** of popular searches in Redis with short expiry, cleared on writes.
- **Full-text search** on title and description (Postgres `tsvector`, or Meilisearch/Elasticsearch for typo tolerance and ranking), and more filters (area, amenities, status).
- **Richer data model:** an `agents` table with a foreign key, description, photos (object storage + CDN), address fields, listing status (draft/active/let/sold), soft deletes and an audit trail.
- **Money:** store prices as integer kobo with a currency code, and model the price period (per year, month or night).
- **Contract tests:** check every response against the OpenAPI schema automatically.
- **Observability:** metrics (latency and error rate per route), tracing, and separate liveness and readiness checks.
- **A full migration tool** (e.g. node-pg-migrate) with down migrations, and load tests of the HTTP API in addition to the query benchmark.
