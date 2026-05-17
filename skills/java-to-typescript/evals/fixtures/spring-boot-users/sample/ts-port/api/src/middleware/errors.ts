import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { UsersError } from '../errors.js';
import { childLogger } from '../logger.js';

const log = childLogger('errors');

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_error', issues: err.issues });
    return;
  }
  if (err instanceof UsersError) {
    res.status(err.status).json({ error: err.name, message: err.message });
    return;
  }
  log.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'internal_error' });
}
