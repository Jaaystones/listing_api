import { Router, type Request, type Response } from "express";
import { NotFoundError } from "../errors.js";
import type { ListingRepository, Listing, Page } from "./repository.js";
import {
  createListingSchema,
  listQuerySchema,
  listingIdSchema,
  searchQuerySchema,
  updateListingSchema,
} from "./schemas.js";

function paginated(result: Page<Listing>, page: number, limit: number) {
  return {
    data: result.items,
    pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
  };
}

export function listingsRouter(repo: ListingRepository): Router {
  const router = Router();

  const getId = (req: Request) => listingIdSchema.parse(req.params.id);
  const notFound = () => new NotFoundError("Listing not found");

  router.get("/", async (req, res) => {
    const { page, limit } = listQuerySchema.parse(req.query);
    res.json(paginated(await repo.search({ page, limit }), page, limit));
  });

  // Must be registered before "/:id" so "search" isn't treated as an id.
  router.get("/search", async (req, res) => {
    const query = searchQuerySchema.parse(req.query);
    res.json(paginated(await repo.search(query), query.page, query.limit));
  });

  router.post("/", async (req, res) => {
    const input = createListingSchema.parse(req.body ?? {});
    const listing = await repo.create(input);
    res.status(201).location(`${req.baseUrl}/${listing.id}`).json({ data: listing });
  });

  router.get("/:id", async (req, res) => {
    const listing = await repo.findById(getId(req));
    if (!listing) throw notFound();
    res.json({ data: listing });
  });

  // PUT replaces the whole resource; PATCH updates only the supplied fields.
  const update =
    (schema: typeof createListingSchema | typeof updateListingSchema) => async (req: Request, res: Response) => {
      const id = getId(req);
      const input = schema.parse(req.body ?? {});
      const listing = await repo.update(id, input);
      if (!listing) throw notFound();
      res.json({ data: listing });
    };
  router.put("/:id", update(createListingSchema));
  router.patch("/:id", update(updateListingSchema));

  router.delete("/:id", async (req, res) => {
    if (!(await repo.delete(getId(req)))) throw notFound();
    res.status(204).end();
  });

  return router;
}
