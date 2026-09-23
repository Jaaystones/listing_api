import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "../../src/db/pool.js";
import { openApiSpec } from "../../src/docs/openapi.js";
import { setupTestApp } from "./setup.js";

let app: Awaited<ReturnType<typeof setupTestApp>>["app"];
let pool: Pool;

beforeAll(async () => {
  ({ app, pool } = await setupTestApp());
});
afterAll(() => pool?.end());

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

describe("API docs", () => {
  it("serves the OpenAPI spec", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
  });

  it("serves Swagger UI at /docs and redirects / to it", async () => {
    const page = await request(app).get("/docs/");
    expect(page.status).toBe(200);
    expect(page.text).toContain("swagger-ui");
    const root = await request(app).get("/");
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe("/docs");
  });

  // Guards against the hand-written spec drifting from the real routes: every documented
  // operation must be routed (i.e. not fall through to the generic "Route ... not found" 404).
  it("documents only operations that exist", async () => {
    const sampleId = "00000000-0000-4000-8000-000000000000";
    for (const [path, item] of Object.entries(openApiSpec.paths)) {
      for (const method of HTTP_METHODS) {
        if (!(method in item)) continue;
        const url = path.replace("{id}", sampleId);
        const res = await request(app)[method](url).send({});
        expect(res.body?.error?.message ?? "", `${method.toUpperCase()} ${path}`).not.toMatch(/^Route /);
      }
    }
  });
});
