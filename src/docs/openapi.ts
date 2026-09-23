import { LISTING_TYPES, MAX_PAGE_SIZE, MAX_RADIUS_KM, MAX_RESULT_WINDOW } from "../listings/schemas.js";

// Hand-written OpenAPI 3 spec served at /docs. Kept in sync with the routes by
// tests/integration/docs.test.ts, which checks every documented operation exists.

const SEED_AGENT_ID = "11111111-1111-4111-8111-111111111111";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (description: string, schema?: object) =>
  schema ? { description, content: { "application/json": { schema } } } : { description };
const errorResponse = (description: string) => response(description, ref("Error"));

const idParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Listing id (UUID). Copy one from `GET /listings`.",
  schema: { type: "string", format: "uuid" },
};

const queryParam = (name: string, schema: object, description: string, example?: unknown) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
  ...(example !== undefined ? { example } : {}),
});

const paginationParams = [
  queryParam(
    "page",
    { type: "integer", minimum: 1, default: 1 },
    `Page number (1-based). page × limit can be at most ${MAX_RESULT_WINDOW}.`,
  ),
  queryParam("limit", { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 }, "Items per page."),
];

const listingInputExample = {
  title: "3 bedroom flat, Lekki Phase 1",
  price: 6500000,
  type: "rent",
  bedrooms: 3,
  location: { lat: 6.4478, lng: 3.4723 },
  agentId: SEED_AGENT_ID,
};

const validationErrorExample = {
  error: {
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    details: [{ field: "price", message: "Number must be greater than or equal to 0" }],
  },
};

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Property Listings API",
    version: "1.0.0",
    description:
      "CRUD and search for property listings, including radius search around a point.\n\n" +
      "The database is seeded with 12 demo listings in Lagos and Abuja. To try it: run **GET /listings** " +
      "to get ids, then use **Try it out** on any endpoint.\n\n" +
      "Handy search point: Victoria Island, Lagos is `lat=6.4281`, `lng=3.4219`.",
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "Listings", description: "Create, read, update and delete listings" },
    { name: "Search", description: "Filtering and geo search" },
    { name: "Health" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check (includes a database ping)",
        responses: {
          200: response("Service and database are up", ref("Health")),
          503: response("Database is unreachable", ref("Health")),
        },
      },
    },
    "/listings": {
      get: {
        tags: ["Listings"],
        summary: "List listings (newest first)",
        parameters: paginationParams,
        responses: {
          200: response("A page of listings", ref("ListingPage")),
          400: errorResponse("Invalid pagination parameters"),
        },
      },
      post: {
        tags: ["Listings"],
        summary: "Create a listing",
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("ListingInput"), example: listingInputExample } },
        },
        responses: {
          201: {
            ...response("Listing created", ref("ListingEnvelope")),
            headers: {
              Location: { description: "URL of the new listing", schema: { type: "string" } },
            },
          },
          400: {
            description: "Validation failed or invalid JSON",
            content: { "application/json": { schema: ref("Error"), example: validationErrorExample } },
          },
          413: errorResponse("Body larger than 100 KB"),
          415: errorResponse("Body is not JSON (send Content-Type: application/json)"),
        },
      },
    },
    "/listings/search": {
      get: {
        tags: ["Search"],
        summary: "Search listings by type, price, bedrooms and distance",
        description:
          "All filters are optional and combined with AND. Unknown query parameters are rejected with 400.\n\n" +
          "**Bedrooms:** use either `bedrooms` (exact) or `minBedrooms`/`maxBedrooms` (range), not both. " +
          "Sending both returns 400, so clear the bedroom fields you don't need before clicking Execute.\n\n" +
          "**Distance:** `lat`, `lng` and `radiusKm` must be sent together. Geo results are sorted nearest first " +
          "and include `distanceKm` (great-circle distance, within ~0.5% of the true distance); other results are newest first.\n\n" +
          `**Paging:** \`page × limit\` can be at most ${MAX_RESULT_WINDOW}. Totals are exact up to ${MAX_RESULT_WINDOW}; ` +
          "beyond that `totalExact` is false. Narrow the search with filters rather than paging deeper.",
        parameters: [
          queryParam(
            "type",
            { type: "string", example: "rent,shortlet" },
            `One type or a comma-separated list. Allowed: ${LISTING_TYPES.join(", ")}.`,
          ),
          queryParam("minPrice", { type: "number", minimum: 0 }, "Minimum price (inclusive)."),
          queryParam("maxPrice", { type: "number", minimum: 0 }, "Maximum price (inclusive)."),
          queryParam(
            "bedrooms",
            { type: "integer", minimum: 0 },
            "Exact number of bedrooms. Leave empty if you use minBedrooms/maxBedrooms.",
          ),
          queryParam(
            "minBedrooms",
            { type: "integer", minimum: 0 },
            "Minimum bedrooms (inclusive). Leave `bedrooms` empty when using this.",
          ),
          queryParam(
            "maxBedrooms",
            { type: "integer", minimum: 0 },
            "Maximum bedrooms (inclusive). Leave `bedrooms` empty when using this.",
          ),
          queryParam("lat", { type: "number", minimum: -90, maximum: 90 }, "Latitude of the search point.", 6.4281),
          queryParam("lng", { type: "number", minimum: -180, maximum: 180 }, "Longitude of the search point.", 3.4219),
          queryParam(
            "radiusKm",
            { type: "number", exclusiveMinimum: true, minimum: 0, maximum: MAX_RADIUS_KM },
            `Search radius in km (max ${MAX_RADIUS_KM}).`,
            10,
          ),
          queryParam("agentId", { type: "string", format: "uuid" }, "Only listings from this agent."),
          ...paginationParams,
        ],
        responses: {
          200: response("A page of matching listings", ref("ListingPage")),
          400: errorResponse("Invalid search parameters"),
        },
      },
    },
    "/listings/{id}": {
      parameters: [idParam],
      get: {
        tags: ["Listings"],
        summary: "Get a listing",
        responses: {
          200: response("The listing", ref("ListingEnvelope")),
          400: errorResponse("Id is not a valid UUID"),
          404: errorResponse("Listing not found"),
        },
      },
      put: {
        tags: ["Listings"],
        summary: "Replace a listing (all fields required)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("ListingInput"), example: listingInputExample } },
        },
        responses: {
          200: response("The updated listing", ref("ListingEnvelope")),
          400: errorResponse("Validation failed"),
          404: errorResponse("Listing not found"),
        },
      },
      patch: {
        tags: ["Listings"],
        summary: "Update some fields of a listing",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: ref("ListingPatch"), example: { price: 5500000, bedrooms: 2 } },
          },
        },
        responses: {
          200: response("The updated listing", ref("ListingEnvelope")),
          400: errorResponse("Validation failed (e.g. empty body)"),
          404: errorResponse("Listing not found"),
        },
      },
      delete: {
        tags: ["Listings"],
        summary: "Delete a listing",
        responses: {
          204: response("Deleted"),
          400: errorResponse("Id is not a valid UUID"),
          404: errorResponse("Listing not found"),
        },
      },
    },
  },
  components: {
    schemas: {
      Location: {
        type: "object",
        required: ["lat", "lng"],
        additionalProperties: false,
        properties: {
          lat: { type: "number", minimum: -90, maximum: 90, example: 6.4478 },
          lng: { type: "number", minimum: -180, maximum: 180, example: 3.4723 },
        },
      },
      ListingPatch: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: "string", minLength: 3, maxLength: 200 },
          price: { type: "number", minimum: 0, multipleOf: 0.01, description: "Price in Naira (max 2 decimal places)" },
          type: { type: "string", enum: [...LISTING_TYPES] },
          bedrooms: { type: "integer", minimum: 0, maximum: 50, description: "0 = studio" },
          location: ref("Location"),
          agentId: { type: "string", format: "uuid" },
        },
      },
      ListingInput: {
        allOf: [ref("ListingPatch")],
        required: ["title", "price", "type", "bedrooms", "location", "agentId"],
      },
      Listing: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          price: { type: "number" },
          type: { type: "string", enum: [...LISTING_TYPES] },
          bedrooms: { type: "integer" },
          location: ref("Location"),
          agentId: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          distanceKm: { type: "number", description: "Only present on geo searches" },
        },
      },
      ListingEnvelope: {
        type: "object",
        properties: { data: ref("Listing") },
      },
      ListingPage: {
        type: "object",
        properties: {
          data: { type: "array", items: ref("Listing") },
          pagination: {
            type: "object",
            properties: {
              page: { type: "integer", example: 1 },
              limit: { type: "integer", example: 20 },
              total: {
                type: "integer",
                example: 12,
                description: `Number of matches, counted up to ${MAX_RESULT_WINDOW}.`,
              },
              totalExact: {
                type: "boolean",
                example: true,
                description: `false when there are more than ${MAX_RESULT_WINDOW} matches; \`total\` is then a lower bound.`,
              },
              totalPages: { type: "integer", example: 1 },
            },
          },
        },
      },
      Health: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok", "unavailable"] },
          database: { type: "string", enum: ["up", "down"] },
        },
      },
      Error: {
        description:
          "Every error has this shape. Responses also carry an `X-Request-Id` header; quote it when reporting a problem.",
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: {
                type: "string",
                enum: [
                  "VALIDATION_ERROR",
                  "INVALID_JSON",
                  "CONSTRAINT_VIOLATION",
                  "NOT_FOUND",
                  "PAYLOAD_TOO_LARGE",
                  "UNSUPPORTED_MEDIA_TYPE",
                  "INTERNAL_ERROR",
                  "SERVICE_UNAVAILABLE",
                ],
              },
              message: { type: "string" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: { field: { type: "string", nullable: true }, message: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
};
