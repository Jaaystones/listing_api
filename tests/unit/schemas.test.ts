import { describe, expect, it } from "vitest";
import { createListingSchema, searchQuerySchema, updateListingSchema } from "../../src/listings/schemas.js";

const valid = {
  title: "3 bedroom flat, Lekki",
  price: 6_500_000,
  type: "rent",
  bedrooms: 3,
  location: { lat: 6.4478, lng: 3.4723 },
  agentId: "11111111-1111-4111-8111-111111111111",
};

const issuesOf = (result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  result.error?.issues.map((i) => i.path.join(".")) ?? [];

describe("createListingSchema", () => {
  it("accepts a valid listing and trims the title", () => {
    const parsed = createListingSchema.parse({ ...valid, title: "  Nice flat  " });
    expect(parsed.title).toBe("Nice flat");
  });

  it.each([
    ["price", { price: -1 }],
    ["price", { price: 100.001 }],
    ["type", { type: "lease" }],
    ["bedrooms", { bedrooms: 2.5 }],
    ["location.lat", { location: { lat: 91, lng: 3 } }],
    ["location.lng", { location: { lat: 6, lng: -181 } }],
    ["agentId", { agentId: "agent-1" }],
    ["title", { title: "ab" }],
  ])("rejects an invalid %s", (field, override) => {
    const result = createListingSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toContain(field);
  });

  it("rejects missing required fields and unknown fields", () => {
    const result = createListingSchema.safeParse({ title: "Only a title", foo: "bar" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join(" ");
    expect(messages).toMatch(/Required/);
    expect(messages).toMatch(/Unrecognized key/);
  });
});

describe("updateListingSchema", () => {
  it("accepts a partial update", () => {
    expect(updateListingSchema.parse({ price: 1000 })).toEqual({ price: 1000 });
  });

  it("rejects an empty body", () => {
    expect(updateListingSchema.safeParse({}).success).toBe(false);
  });
});

describe("searchQuerySchema", () => {
  it("applies pagination defaults and coerces query strings", () => {
    const q = searchQuerySchema.parse({ minPrice: "1000", bedrooms: "2", type: "rent,shortlet" });
    expect(q).toMatchObject({ page: 1, limit: 20, minPrice: 1000, bedrooms: 2, type: ["rent", "shortlet"] });
  });

  it("treats empty values as not provided", () => {
    expect(searchQuerySchema.parse({ page: "", minPrice: "" })).toEqual({ page: 1, limit: 20 });
  });

  it("rejects limit above the maximum and non-numeric values", () => {
    expect(issuesOf(searchQuerySchema.safeParse({ limit: "101" }))).toContain("limit");
    expect(issuesOf(searchQuerySchema.safeParse({ minPrice: "cheap" }))).toContain("minPrice");
  });

  it("rejects inverted ranges", () => {
    expect(issuesOf(searchQuerySchema.safeParse({ minPrice: "500", maxPrice: "100" }))).toContain("minPrice");
    expect(issuesOf(searchQuerySchema.safeParse({ minBedrooms: "4", maxBedrooms: "2" }))).toContain("minBedrooms");
  });

  it("requires lat, lng and radiusKm together", () => {
    expect(searchQuerySchema.safeParse({ lat: "6.4", lng: "3.4" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ lat: "6.4", lng: "3.4", radiusKm: "5" }).success).toBe(true);
  });

  it("rejects a radius outside (0, 500] km", () => {
    expect(searchQuerySchema.safeParse({ lat: "6.4", lng: "3.4", radiusKm: "0" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ lat: "6.4", lng: "3.4", radiusKm: "501" }).success).toBe(false);
  });

  it("caps page × limit at 10,000 results", () => {
    expect(searchQuerySchema.safeParse({ page: "500", limit: "20" }).success).toBe(true);
    expect(issuesOf(searchQuerySchema.safeParse({ page: "501", limit: "20" }))).toContain("page");
  });

  it("rejects unknown query parameters so typos don't silently return everything", () => {
    expect(searchQuerySchema.safeParse({ min_price: "100" }).success).toBe(false);
  });
});
