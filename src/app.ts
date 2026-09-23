import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { config } from "./config.js";
import type { Pool } from "./db/pool.js";
import { openApiSpec } from "./docs/openapi.js";
import { ListingRepository } from "./listings/repository.js";
import { listingsRouter } from "./listings/routes.js";
import { logger } from "./logger.js";
import { errorHandler, notFoundHandler, requireJsonBody } from "./middleware.js";

const REQUEST_ID_HEADER = "X-Request-Id";

export function createApp(pool: Pool) {
  const app = express();
  app.disable("x-powered-by");

  // Structured request logging. Reuses an incoming X-Request-Id (e.g. from a load balancer)
  // or generates one, and echoes it back so clients can quote it in bug reports.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && /^[\w-]{1,128}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      autoLogging: { ignore: (req) => req.url?.startsWith("/docs") ?? false },
      // Keep log lines short: headers are noise for day-to-day debugging.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // The default CSP works with Swagger UI, but upgrade-insecure-requests would break
  // its assets when the API is opened over plain HTTP on a non-localhost address.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(
    cors({
      origin: config.corsOrigin === "*" ? "*" : config.corsOrigin.split(",").map((o) => o.trim()),
      exposedHeaders: ["Location", REQUEST_ID_HEADER],
    }),
  );
  app.use(requireJsonBody);
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (_req, res) => res.redirect("/docs"));
  app.get("/openapi.json", (_req, res) => res.json(openApiSpec));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: "Property Listings API" }));

  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", database: "up" });
    } catch (err) {
      req.log.error({ err }, "Health check failed");
      res.status(503).json({ status: "unavailable", database: "down" });
    }
  });

  app.use("/listings", listingsRouter(new ListingRepository(pool)));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
