import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPool, type Pool } from "../../src/db/pool.js";

// HTTP-layer behaviour that doesn't need a working database.

const LISTING_ID = "00000000-0000-4000-8000-000000000000";

/** A pool whose queries always fail with the given error. */
const failingPool = (err: Error) => ({ query: async () => Promise.reject(err) }) as unknown as Pool;

describe("when the database is unreachable", () => {
  // Nothing listens on port 1, so connections are refused immediately.
  const pool = createPool("postgres://nobody:nothing@127.0.0.1:1/none");
  const app = createApp(pool);
  afterAll(() => pool.end());

  it("GET /health returns 503", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", database: "down" });
  });

  it("API requests return 503 SERVICE_UNAVAILABLE instead of crashing or 500", async () => {
    const res = await request(app).get(`/listings/${LISTING_ID}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("keeps the process alive when an idle connection errors", () => {
    // Without a pool 'error' listener this emit would throw (and crash the process in production).
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
  });
});

describe("unexpected errors", () => {
  it("return a generic 500 without leaking internals", async () => {
    const app = createApp(failingPool(new Error("secret internal detail")));
    const res = await request(app).get(`/listings/${LISTING_ID}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
    expect(res.text).not.toContain("secret");
  });
});

describe("request handling", () => {
  const app = createApp(failingPool(new Error("the database should not be reached")));

  it("returns 415 for a non-JSON body", async () => {
    const res = await request(app).post("/listings").set("Content-Type", "text/plain").send("hello");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("returns 413 for a body over 100 KB", async () => {
    const res = await request(app)
      .post("/listings")
      .send({ title: "x".repeat(110 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("generates an X-Request-Id, or reuses a valid incoming one", async () => {
    const generated = await request(app).get("/nope");
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const reused = await request(app).get("/nope").set("X-Request-Id", "trace-123");
    expect(reused.headers["x-request-id"]).toBe("trace-123");
  });

  it("sends CORS headers, including on preflight requests", async () => {
    const res = await request(app).get("/nope").set("Origin", "https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-expose-headers"]).toContain("X-Request-Id");
    const preflight = await request(app)
      .options("/listings")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "POST");
    expect(preflight.status).toBe(204);
  });
});
