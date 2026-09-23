import { z } from "zod";

export const LISTING_TYPES = ["rent", "sale", "shortlet"] as const;
export const MAX_RADIUS_KM = 500;
export const MAX_PAGE_SIZE = 100;

const listingType = z.enum(LISTING_TYPES);

const location = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

export const createListingSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    price: z
      .number()
      .nonnegative()
      .max(1e13)
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Price can have at most 2 decimal places"),
    type: listingType,
    bedrooms: z.number().int().min(0).max(50),
    location,
    agentId: z.string().uuid(),
  })
  .strict();

export const updateListingSchema = createListingSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

export const listingIdSchema = z.string().uuid("Listing id must be a valid UUID");

// ---- Query strings -------------------------------------------------------

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Treats a missing or empty query value as "not provided", otherwise coerces to a number. */
const queryNumber = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

const num = () => z.coerce.number({ invalid_type_error: "Must be a number" }).finite();

const paginationShape = {
  page: z.preprocess(emptyToUndefined, num().int().min(1).default(1)),
  limit: z.preprocess(emptyToUndefined, num().int().min(1).max(MAX_PAGE_SIZE).default(20)),
};

export const listQuerySchema = z.object(paginationShape).strict();

export const searchQuerySchema = z
  .object({
    ...paginationShape,
    // Accepts `type=rent` or `type=rent,shortlet` (or repeated `type=` params).
    type: z
      .preprocess(
        (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v),
        z.array(listingType).min(1),
      )
      .optional(),
    minPrice: queryNumber(num().min(0)),
    maxPrice: queryNumber(num().min(0)),
    bedrooms: queryNumber(num().int().min(0)),
    minBedrooms: queryNumber(num().int().min(0)),
    maxBedrooms: queryNumber(num().int().min(0)),
    lat: queryNumber(num().min(-90).max(90)),
    lng: queryNumber(num().min(-180).max(180)),
    radiusKm: queryNumber(num().gt(0).max(MAX_RADIUS_KM)),
    agentId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
      ctx.addIssue({ code: "custom", path: ["minPrice"], message: "minPrice cannot be greater than maxPrice" });
    }
    if (q.minBedrooms !== undefined && q.maxBedrooms !== undefined && q.minBedrooms > q.maxBedrooms) {
      ctx.addIssue({ code: "custom", path: ["minBedrooms"], message: "minBedrooms cannot be greater than maxBedrooms" });
    }
    if (q.bedrooms !== undefined && (q.minBedrooms !== undefined || q.maxBedrooms !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["bedrooms"], message: "Use either bedrooms or minBedrooms/maxBedrooms, not both" });
    }
    const geo = [q.lat, q.lng, q.radiusKm].filter((v) => v !== undefined).length;
    if (geo !== 0 && geo !== 3) {
      ctx.addIssue({ code: "custom", path: ["radiusKm"], message: "lat, lng and radiusKm must be provided together" });
    }
  });

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type ListingType = z.infer<typeof listingType>;
