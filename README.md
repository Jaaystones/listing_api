# Property Listings API

A small REST API for property listings. It has CRUD endpoints, filtered search and a "within X km of a point" search. It is built with **Node.js + TypeScript + Express 5**, **PostgreSQL + PostGIS**, **Zod** for validation, and **Vitest + Supertest** for tests.

---

## Quick start (Docker only, recommended)

You need **Docker** with Docker Compose v2.

```bash
docker compose up --build
```

This starts PostGIS and the API. The API applies migrations, adds 12 demo listings in Lagos and Abuja, and then listens on **http://localhost:3000**.

**To try it in the browser, open http://localhost:3000/docs.** This is Swagger UI: every endpoint has **Try it out** with example values filled in. Run `GET /listings` first to get real ids. The raw OpenAPI spec is at `/openapi.json`.

```bash
curl localhost:3000/health
curl "localhost:3000/listings/search?lat=6.4281&lng=3.4219&radiusKm=10"
```

Run the full test suite inside Docker. No local Node install is needed:

```bash
docker compose run --rm --build test
```

> **Ports:** the API uses host port `3000` and Postgres uses host port `5434`, so it won't clash with a local Postgres on 5432. To change them, run for example `API_HOST_PORT=8080 DB_HOST_PORT=5555 docker compose up --build`.
>
> **Clean slate:** `docker compose down -v` removes the database volume.

## Running locally (Node 20+)

```bash
npm install
cp .env.example .env         # optional: these values are also the built-in defaults
docker compose up -d db      # PostGIS on localhost:5434 (it also creates the listings_test DB)
npm run migrate
npm run seed                 # optional demo data
npm run dev                  # http://localhost:3000, reloads on file changes, pretty-printed logs

npm test                     # unit + integration (integration uses the listings_test DB)
npm run test:unit            # validation and HTTP-layer tests, no database needed
npm run lint                 # ESLint with type-aware rules
npm run format:check         # Prettier (npm run format to fix)
```

| Env var        | Default                                                | Purpose                                        |
| -------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `PORT`         | `3000`                                                 | HTTP port                                      |
| `DATABASE_URL` | `postgres://listings:listings@localhost:5434/listings` | Postgres connection                            |
| `LOG_LEVEL`    | `info`                                                 | pino log level (`silent` in tests)             |
| `CORS_ORIGIN`  | `*`                                                    | `*` or a comma-separated allow-list of origins |

---

## API

All responses are JSON. Successful responses wrap the payload in `data`. List responses also include `pagination`. Every response carries an `X-Request-Id` header (an incoming one is reused), which also appears in the logs.

| Method   | Path               | Description                                 | Success                 |
| -------- | ------------------ | ------------------------------------------- | ----------------------- |
| `GET`    | `/docs`            | Swagger UI (`/` redirects here)             | 200                     |
| `GET`    | `/openapi.json`    | OpenAPI 3 spec                              | 200                     |
| `GET`    | `/health`          | Health check, including a DB ping           | 200 (503 if DB is down) |
| `POST`   | `/listings`        | Create a listing                            | 201 + `Location` header |
| `GET`    | `/listings`        | List all listings (paginated, newest first) | 200                     |
| `GET`    | `/listings/search` | Filter and geo search (see below)           | 200                     |
| `GET`    | `/listings/:id`    | Get one listing                             | 200                     |
| `PUT`    | `/listings/:id`    | Replace a listing (every field required)    | 200                     |
| `PATCH`  | `/listings/:id`    | Partially update a listing                  | 200                     |
| `DELETE` | `/listings/:id`    | Delete a listing                            | 204                     |

### Listing body

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

| Field      | Rules                                        |
| ---------- | -------------------------------------------- |
| `title`    | string, 3–200 chars (whitespace is trimmed)  |
| `price`    | number ≥ 0, at most 2 decimal places (Naira) |
| `type`     | `rent` \| `sale` \| `shortlet`               |
| `bedrooms` | integer 0–50 (0 = studio)                    |
| `location` | `{ lat: -90..90, lng: -180..180 }`           |
| `agentId`  | UUID (see note below)                        |

Unknown fields are rejected. Responses also include `id`, `createdAt` and `updatedAt`.

> **About `agentId`:** there is no agents table in this task, so the API doesn't check whether an agent exists. It only checks that `agentId` is a well-formed UUID, in the same format as the example in the docs: `8-4-4-4-12` hex characters, e.g. `11111111-1111-4111-8111-111111111111`. A shortened value such as `11111111-1111-4111-8111-11111` is rejected with `400 VALIDATION_ERROR`. The demo data uses two agent ids you can reuse:
>
> - `11111111-1111-4111-8111-111111111111`
> - `22222222-2222-4222-8222-222222222222`

### Search: `GET /listings/search`

All parameters are optional and can be combined (they are ANDed together).

| Param                        | Example                   | Notes                                               |
| ---------------------------- | ------------------------- | --------------------------------------------------- |
| `type`                       | `rent` or `rent,shortlet` | one or more types                                   |
| `minPrice`, `maxPrice`       | `1000000`                 | inclusive; `minPrice ≤ maxPrice`                    |
| `bedrooms`                   | `3`                       | exact match                                         |
| `minBedrooms`, `maxBedrooms` | `2`                       | inclusive range (can't be combined with `bedrooms`) |
| `lat`, `lng`, `radiusKm`     | `6.43`, `3.42`, `10`      | all three together; radius in (0, 500] km           |
| `agentId`                    | UUID                      | listings for one agent                              |
| `page`, `limit`              | `1`, `20`                 | `limit` ≤ 100                                       |

> **Bedroom filters:** use **either** `bedrooms` (exact match) **or** `minBedrooms`/`maxBedrooms` (a range), not both. Sending both returns `400 VALIDATION_ERROR` ("Use either bedrooms or minBedrooms/maxBedrooms, not both"). A mix like `bedrooms=3&minBedrooms=4` can never match, so the API reports the conflict instead of quietly returning an empty list. In Swagger, clear the bedroom fields you don't need before clicking **Execute**.
>
> - Exactly 3 bedrooms: `bedrooms=3`
> - 2 to 4 bedrooms: `minBedrooms=2&maxBedrooms=4`
> - At least 2 bedrooms: `minBedrooms=2`

Results come newest first. With a geo search they come **nearest first**, and each item gets a `distanceKm` field.

```bash
# Rentals or shortlets for 1M–10M within 15 km of Victoria Island, 2+ bedrooms
curl "localhost:3000/listings/search?type=rent,shortlet&minPrice=1000000&maxPrice=10000000&minBedrooms=2&lat=6.4281&lng=3.4219&radiusKm=15"
```

```json
{
  "data": [
    { "id": "…", "title": "3 bedroom flat, Lekki Phase 1", "distanceKm": 5.986, "...": "..." },
    { "id": "…", "title": "2 bedroom apartment, Yaba", "distanceKm": 10.612, "...": "..." }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 }
}
```

### More examples

```bash
# Create
curl -X POST localhost:3000/listings -H 'Content-Type: application/json' -d '{
  "title": "2 bedroom flat, Yaba", "price": 2800000, "type": "rent", "bedrooms": 2,
  "location": { "lat": 6.5095, "lng": 3.3711 }, "agentId": "11111111-1111-4111-8111-111111111111"
}'

# Partial update
curl -X PATCH localhost:3000/listings/<id> -H 'Content-Type: application/json' -d '{"price": 2500000}'

# Delete
curl -X DELETE localhost:3000/listings/<id>
```

### Errors

Every error uses the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "price", "message": "Number must be greater than or equal to 0" }]
  }
}
```

| Status | `code`                   | When                                                                                      |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | invalid body, query or id (not a UUID), unknown fields or params                          |
| 400    | `INVALID_JSON`           | body is not valid JSON                                                                    |
| 400    | `CONSTRAINT_VIOLATION`   | a value passed validation but broke a DB constraint (e.g. price too large for the column) |
| 404    | `NOT_FOUND`              | listing or route doesn't exist                                                            |
| 413    | `PAYLOAD_TOO_LARGE`      | body larger than 100 KB                                                                   |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | body sent without `Content-Type: application/json`                                        |
| 500    | `INTERNAL_ERROR`         | unexpected error (details are logged, not returned)                                       |
| 503    | `SERVICE_UNAVAILABLE`    | database unreachable; safe to retry                                                       |

---

## Project structure

```
src/
  app.ts                 Express app factory (takes a DB pool, which makes it easy to test)
  server.ts              Entry point: HTTP server + graceful shutdown
  config.ts              Environment config
  logger.ts              pino logger
  errors.ts, middleware.ts   HttpError types, JSON-only guard, 404 handler, central error handler
  docs/openapi.ts        OpenAPI 3 spec served by Swagger UI at /docs
  db/
    pool.ts              pg Pool (NUMERIC columns parsed as numbers)
    migrate.ts           Minimal SQL migration runner (tracked in schema_migrations, advisory-locked)
    seed.ts              Demo data (only inserted into an empty table)
  listings/
    schemas.ts           Zod schemas for bodies and query strings
    repository.ts        All SQL for listings
    routes.ts            HTTP handlers
migrations/              Plain .sql migrations
tests/
  unit/                  Validation rules and HTTP behaviour: 415/413/500/503, CORS, request ids (no DB)
  integration/           Full HTTP → Postgres tests with Supertest
```

## Design choices

- **PostgreSQL + PostGIS for geo search.** `location` is a `geography(Point, 4326)` column with a **GiST index**. The radius filter uses `ST_DWithin`, which uses the index, so it stays fast as the table grows. `ST_Distance` gives an accurate distance on the spheroid for sorting and for `distanceKm`. Computing Haversine in app code or in plain SQL can't use an index and gets slow at scale.
- **Raw, parameterised SQL in one repository layer** instead of an ORM. The queries are simple but spatial. Writing them directly keeps them visible and tunable, and every value is a bind parameter, so there is no SQL injection risk. Routes hold no SQL, and the repository has no HTTP code.
- **Zod at the edge.** Each input (body, query string, path id) is parsed before any handler logic runs, and the parsed types flow through to the repository. Query strings are coerced to numbers, and empty values count as "not provided". Unknown params are **rejected**, so a typo like `min_price` returns a 400 instead of quietly returning unfiltered results.
- **Central error handler** so every failure has the same `{ error: { code, message, details } }` shape and internal errors never leak stack traces. Express 5 passes errors from async handlers to it automatically.
- **Offset pagination** (`page`/`limit`) with a `total` count. The count query runs in parallel with the page query. The sort order is always deterministic (`created_at, id` or `distance, id`), so rows don't repeat or vanish between pages.
- **Database constraints as a second line of defence**: `CHECK` constraints on price, bedrooms and title length, plus a Postgres `ENUM` for `type`.
- **PUT and PATCH** are both supported. PUT is a full replace and requires every field. PATCH changes only the fields you send.
- **`agentId` is a UUID without a foreign key**, because the task has no agents resource. In production it would reference an `agents` table.
- **Real integration tests**, not mocks. They run against a separate `listings_test` database, so they check the real PostGIS behaviour (distances, index-backed filters, ordering). Each test starts from a truncated table.
- **Hand-written OpenAPI spec + Swagger UI.** Generators that build a spec from Zod handle the query-string coercion poorly, so I wrote the spec by hand for clearer docs. A test sends a request to every documented operation and fails if one isn't actually routed, which stops the spec drifting from the code.
- **Survives database outages.** The connection pool has an `error` listener, so a dropped idle connection (DB restart, failover) is logged and replaced instead of crashing the process. Requests made while the DB is unreachable fail fast (5 s connect timeout, 10 s statement timeout) with `503 SERVICE_UNAVAILABLE`, and `/health` returns 503 so a load balancer or Docker can route around the instance. When the DB comes back, the API recovers without a restart.
- **Structured logging with request IDs** (pino). Each request is logged as one JSON line with method, path, status and duration; 4xx logs at `warn`, 5xx at `error` with the stack. The request id is returned in `X-Request-Id`, so a client report can be matched to the log line. Auth and cookie headers are redacted.
- **CORS enabled** for the web and mobile frontends, configurable with `CORS_ORIGIN`. `Location` and `X-Request-Id` are exposed to browser clients.
- **Engineering habits**: ESLint with type-aware rules (catches things like un-awaited promises), Prettier, and a GitHub Actions workflow that runs lint → format check → typecheck → build → tests against a PostGIS service on every push.
- **Docker-first**: a multi-stage image that runs as a non-root user, migrations on boot guarded by an advisory lock, healthchecks on both containers, `restart: unless-stopped`, and graceful shutdown on SIGTERM.

## What I'd improve with more time

- **Authentication and authorisation**: JWTs, so only the owning agent or an admin can update or delete a listing. Also rate limiting.
- **Cursor (keyset) pagination** for deep pages. `OFFSET` gets slower as page numbers grow, and results can shift when new listings are inserted.
- **Full-text search** on title and description (Postgres `tsvector`, or Meilisearch/Elasticsearch for typo tolerance and ranking), plus more filters (city, amenities, status).
- **Caching** of popular search results in Redis with short TTLs, invalidated on writes.
- **Richer data model**: `agents` table with an FK, description, images (object storage + CDN), address/city/state fields, listing status (draft/active/let/sold), soft deletes and an audit trail.
- **Money handling**: store prices as integer kobo plus a currency code, and show rent periods (per year, month or night).
- **Contract tests against the OpenAPI spec**: validate every response against its documented schema, or generate the spec from a single source of truth.
- **Observability**: Prometheus metrics (latency and error rate per route), OpenTelemetry tracing, and separate liveness and readiness probes.
- **A proper migration tool** (e.g. node-pg-migrate) with down migrations, and more tests: repository-level tests, load tests for search, and contract tests.
