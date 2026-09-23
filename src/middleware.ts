import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function body(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

/** Rejects request bodies that aren't JSON, rather than reporting every field as missing. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  // req.is() returns null when there is no body at all; that case is left to validation.
  if (METHODS_WITH_BODY.has(req.method) && req.is("application/json") === false) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Request body must be JSON (Content-Type: application/json)");
  }
  next();
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(body("NOT_FOUND", `Route ${req.method} ${req.path} not found`));
};

// Node network errors and Postgres SQLSTATEs (class 08 = connection exception,
// 57P0x = server shutting down / starting up) that mean the database can't be reached.
const DB_UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01",
  "57P02",
  "57P03",
]);

export function isDatabaseUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && (DB_UNAVAILABLE_CODES.has(code) || code.startsWith("08"))) return true;
  // pg raises these without a code.
  return /Connection terminated|timeout exceeded when trying to connect/i.test(err.message);
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  // Fields set by body-parser (`type`) and by pg / Node (`code`).
  const { type, code } = (err ?? {}) as { type?: string; code?: string };

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join(".") || null, message: i.message }));
    res.status(400).json(body("VALIDATION_ERROR", "Request validation failed", details));
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json(body(err.code, err.message, err.details));
    return;
  }
  // Errors raised by express.json() body parsing.
  if (type === "entity.parse.failed") {
    res.status(400).json(body("INVALID_JSON", "Request body is not valid JSON"));
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json(body("PAYLOAD_TOO_LARGE", "Request body is too large"));
    return;
  }
  // Postgres constraint violations that slipped past validation are still client errors.
  if (code === "23514" || code === "22003") {
    res.status(400).json(body("CONSTRAINT_VIOLATION", "A value is out of the allowed range"));
    return;
  }
  if (isDatabaseUnavailable(err)) {
    req.log.error({ err }, "Database unavailable");
    res.status(503).json(body("SERVICE_UNAVAILABLE", "The service is temporarily unavailable, please retry"));
    return;
  }

  req.log.error({ err }, "Unhandled error");
  res.status(500).json(body("INTERNAL_ERROR", "Something went wrong"));
};
