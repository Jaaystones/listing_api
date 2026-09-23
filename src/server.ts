import { createApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";
import { logger } from "./logger.js";

const pool = createPool(config.databaseUrl);
const server = createApp(pool).listen(config.port, () => {
  logger.info(`Listings API listening on http://localhost:${config.port} (docs at /docs)`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
