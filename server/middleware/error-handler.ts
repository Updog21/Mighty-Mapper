import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors";

const isDev = process.env.NODE_ENV !== "production";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const isOperational = err instanceof AppError ? err.isOperational : false;
  const message = isOperational ? err.message : "Internal Server Error";

  // Structured log — always log non-operational / 5xx, log 4xx only in dev
  if (!isOperational || statusCode >= 500 || isDev) {
    console.error(
      JSON.stringify({
        level: statusCode >= 500 ? "error" : "warn",
        status: statusCode,
        method: req.method,
        path: req.originalUrl,
        message: err.message,
        ...(isDev && err.stack ? { stack: err.stack } : {}),
      })
    );
  }

  const body: Record<string, unknown> = { error: message, status: statusCode };
  if (isDev && err.stack) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}
