import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "../../src/db/pool.js";
import { resetDb, setupTestApp } from "./setup.js";

let app: Awaited<ReturnType<typeof setupTestApp>>["app"];
let pool: Pool;

const AGENT = "11111111-1111-4111-8111-111111111111";
const OTHER_AGENT = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

// Reference points (approximate). Distances from Victoria Island:
// Lekki Phase 1 ≈ 6 km, Ikeja ≈ 20 km, Abuja ≈ 540 km.
const VI = { lat: 6.4281, lng: 3.4219 };
const LEKKI = { lat: 6.4478, lng: 3.4723 };
const IKEJA = { lat: 6.6018, lng: 3.3515 };
const ABUJA = { lat: 9.0882, lng: 7.4991 };

const base = { title: "Test listing", price: 1_000_000, type: "rent", bedrooms: 2, location: VI, agentId: AGENT };

async function create(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/listings")
    .send({ ...base, ...overrides });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  ({ app, pool } = await setupTestApp());
});
beforeEach(() => resetDb(pool));
afterAll(() => pool?.end());

describe("CRUD /listings", () => {
  it("creates a listing and returns it with a Location header", async () => {
    const res = await request(app).post("/listings").send(base);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/listings/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({
      title: "Test listing",
      price: 1_000_000,
      type: "rent",
      bedrooms: 2,
      agentId: AGENT,
    });
    expect(res.body.data.location.lat).toBeCloseTo(VI.lat, 6);
    expect(res.body.data.location.lng).toBeCloseTo(VI.lng, 6);
  });

  it("gets a listing by id", async () => {
    const created = await create();
    const res = await request(app).get(`/listings/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(created);
  });

  it("partially updates a listing with PATCH", async () => {
    const created = await create();
    const res = await request(app).patch(`/listings/${created.id}`).send({ price: 750_000.5, location: LEKKI });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ price: 750_000.5, title: created.title, bedrooms: 2 });
    expect(res.body.data.location.lat).toBeCloseTo(LEKKI.lat, 6);
    expect(new Date(res.body.data.updatedAt) >= new Date(created.updatedAt)).toBe(true);
  });

  it("requires the full body on PUT", async () => {
    const created = await create();
    const partial = await request(app).put(`/listings/${created.id}`).send({ price: 1 });
    expect(partial.status).toBe(400);
    const full = await request(app)
      .put(`/listings/${created.id}`)
      .send({ ...base, title: "Replaced", type: "sale" });
    expect(full.status).toBe(200);
    expect(full.body.data).toMatchObject({ title: "Replaced", type: "sale" });
  });

  it("deletes a listing", async () => {
    const created = await create();
    expect((await request(app).delete(`/listings/${created.id}`)).status).toBe(204);
    expect((await request(app).get(`/listings/${created.id}`)).status).toBe(404);
    expect((await request(app).delete(`/listings/${created.id}`)).status).toBe(404);
  });

  it("paginates GET /listings newest first", async () => {
    for (let i = 1; i <= 5; i++) await create({ title: `Listing ${i}` });
    const res = await request(app).get("/listings?page=2&limit=2");
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 2, limit: 2, total: 5, totalExact: true, totalPages: 3 });
    expect(res.body.data.map((l: { title: string }) => l.title)).toEqual(["Listing 3", "Listing 2"]);
  });
});

describe("large result sets", () => {
  it("counts exactly up to 10,000 matches and reports a lower bound beyond that", async () => {
    await pool.query(
      `INSERT INTO listings (title, price, type, bedrooms, location, agent_id)
       SELECT 'Bulk ' || g, 1000, 'rent', 1, ST_SetSRID(ST_MakePoint(3.4, 6.4), 4326)::geography, $1
       FROM generate_series(1, 10005) g`,
      [AGENT],
    );
    const res = await request(app).get("/listings?limit=100");
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 1, limit: 100, total: 10000, totalExact: false, totalPages: 100 });
    expect(res.body.data).toHaveLength(100);
  });

  it("rejects pages beyond the 10,000-result window", async () => {
    expect((await request(app).get("/listings?page=100&limit=100")).status).toBe(200);
    const res = await request(app).get("/listings?page=101&limit=100");
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("page");
  });
});

describe("error handling", () => {
  it("returns 400 with field details for an invalid body", async () => {
    const res = await request(app)
      .post("/listings")
      .send({ ...base, price: -5, type: "lease" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["price", "type"]));
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app).post("/listings").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 400 for a non-UUID id and 404 for an unknown id", async () => {
    expect((await request(app).get("/listings/not-a-uuid")).status).toBe(400);
    const res = await request(app).get(`/listings/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Listing not found" });
  });

  it("returns 404 when updating or replacing a listing that doesn't exist", async () => {
    expect((await request(app).patch(`/listings/${MISSING_ID}`).send({ price: 1 })).status).toBe(404);
    expect((await request(app).put(`/listings/${MISSING_ID}`).send(base)).status).toBe(404);
  });

  it("returns 400 for an empty PATCH body", async () => {
    const created = await create();
    const res = await request(app).patch(`/listings/${created.id}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toBe("Provide at least one field to update");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /listings/search", () => {
  beforeEach(async () => {
    await create({ title: "VI studio shortlet", type: "shortlet", price: 80_000, bedrooms: 0, location: VI });
    await create({ title: "Lekki 3 bed rent", type: "rent", price: 6_000_000, bedrooms: 3, location: LEKKI });
    await create({
      title: "Ikeja 4 bed sale",
      type: "sale",
      price: 150_000_000,
      bedrooms: 4,
      location: IKEJA,
      agentId: OTHER_AGENT,
    });
    await create({ title: "Abuja 3 bed rent", type: "rent", price: 9_000_000, bedrooms: 3, location: ABUJA });
  });

  const titles = (res: request.Response) => res.body.data.map((l: { title: string }) => l.title).sort();

  it("filters by type (single and comma-separated)", async () => {
    expect(titles(await request(app).get("/listings/search?type=rent"))).toEqual([
      "Abuja 3 bed rent",
      "Lekki 3 bed rent",
    ]);
    const multi = await request(app).get("/listings/search?type=sale,shortlet");
    expect(titles(multi)).toEqual(["Ikeja 4 bed sale", "VI studio shortlet"]);
  });

  it("filters by price range (inclusive)", async () => {
    const res = await request(app).get("/listings/search?minPrice=6000000&maxPrice=9000000");
    expect(titles(res)).toEqual(["Abuja 3 bed rent", "Lekki 3 bed rent"]);
  });

  it("filters by exact bedrooms and by bedroom range", async () => {
    expect(titles(await request(app).get("/listings/search?bedrooms=3"))).toEqual([
      "Abuja 3 bed rent",
      "Lekki 3 bed rent",
    ]);
    expect(titles(await request(app).get("/listings/search?minBedrooms=4"))).toEqual(["Ikeja 4 bed sale"]);
  });

  it("returns listings within X km ordered by distance, with distanceKm", async () => {
    const res = await request(app).get(`/listings/search?lat=${VI.lat}&lng=${VI.lng}&radiusKm=10`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((l: { title: string }) => l.title)).toEqual(["VI studio shortlet", "Lekki 3 bed rent"]);
    expect(res.body.data[0].distanceKm).toBe(0);
    expect(res.body.data[1].distanceKm).toBeGreaterThan(5);
    expect(res.body.data[1].distanceKm).toBeLessThan(7);

    const wider = await request(app).get(`/listings/search?lat=${VI.lat}&lng=${VI.lng}&radiusKm=25`);
    expect(wider.body.data).toHaveLength(3);
    expect(wider.body.data[2].title).toBe("Ikeja 4 bed sale");
  });

  it("combines geo and attribute filters, and paginates", async () => {
    const res = await request(app).get(
      `/listings/search?lat=${VI.lat}&lng=${VI.lng}&radiusKm=25&type=rent,shortlet&limit=1&page=2`,
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalExact: true, totalPages: 2 });
    expect(res.body.data[0].title).toBe("Lekki 3 bed rent");
  });

  it("returns an empty page rather than an error when nothing matches", async () => {
    const res = await request(app).get("/listings/search?minPrice=999999999999");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalExact: true, totalPages: 0 },
    });
  });

  it("pages through listings at identical coordinates without repeats or gaps", async () => {
    // Several flats in one building share a point, so their distances tie exactly.
    const building = { lat: 6.435, lng: 3.43 };
    const flats = [];
    for (let i = 1; i <= 5; i++) flats.push(await create({ title: `Flat ${i}`, location: building }));

    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await request(app).get(
        `/listings/search?lat=${building.lat}&lng=${building.lng}&radiusKm=0.5&limit=2&page=${page}`,
      );
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((l: { id: string }) => l.id));
    }
    // Tied rows come back in id order, each exactly once.
    expect(seen).toEqual(flats.map((f: { id: string }) => f.id).sort());
  });

  it("rejects invalid search parameters", async () => {
    const res = await request(app).get("/listings/search?lat=6.4&lng=3.4");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect((await request(app).get("/listings/search?type=lease")).status).toBe(400);
    expect((await request(app).get("/listings/search?minPrice=10&maxPrice=5")).status).toBe(400);
  });
});
