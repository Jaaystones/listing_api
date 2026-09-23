import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function body(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(body("NOT_FOUND", `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
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
  if (err?.type === "entity.parse.failed") {
    res.status(400).json(body("INVALID_JSON", "Request body is not valid JSON"));
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json(body("PAYLOAD_TOO_LARGE", "Request body is too large"));
    return;
  }
  // Postgres constraint violations that slipped past validation are still client errors.
  if (err?.code === "23514" || err?.code === "22003") {
    res.status(400).json(body("CONSTRAINT_VIOLATION", "A value is out of the allowed range"));
    return;
  }

  console.error(err);
  res.status(500).json(body("INTERNAL_ERROR", "Something went wrong"));
};
