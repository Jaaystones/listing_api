const DEFAULT_DATABASE_URL = "postgres://listings:listings@localhost:5434/listings";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  logLevel: process.env.LOG_LEVEL ?? "info",
  // "*" allows any origin; otherwise a comma-separated allow-list, e.g. "https://app.example.com,https://admin.example.com".
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
