import { createApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";

const pool = createPool(config.databaseUrl);
const server = createApp(pool).listen(config.port, () => {
  console.log(`Listings API listening on http://localhost:${config.port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
