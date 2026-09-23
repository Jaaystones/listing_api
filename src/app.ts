import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import type { Pool } from "./db/pool.js";
import { openApiSpec } from "./docs/openapi.js";
import { ListingRepository } from "./listings/repository.js";
import { listingsRouter } from "./listings/routes.js";
import { errorHandler, notFoundHandler } from "./middleware.js";

export function createApp(pool: Pool) {
  const app = express();
  app.disable("x-powered-by");
  // The default CSP works with Swagger UI, but upgrade-insecure-requests would break
  // its assets when the API is opened over plain HTTP on a non-localhost address.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (_req, res) => res.redirect("/docs"));
  app.get("/openapi.json", (_req, res) => res.json(openApiSpec));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: "Property Listings API" }));

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });

  app.use("/listings", listingsRouter(new ListingRepository(pool)));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
