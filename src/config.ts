const DEFAULT_DATABASE_URL = "postgres://listings:listings@localhost:5434/listings";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
};
