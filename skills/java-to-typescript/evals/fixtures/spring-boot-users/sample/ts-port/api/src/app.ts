import 'reflect-metadata';
import express, { type Express } from 'express';
import { wireContainer } from './wiring.js';
import { getUserHandler } from './routes/get-user.js';
import { createUserHandler } from './routes/create-user.js';
import { errorMiddleware } from './middleware/errors.js';

export function buildApp(): Express {
  wireContainer();
  const app = express();
  app.use(express.json());
  app.get('/users/:id', getUserHandler);
  app.post('/users', createUserHandler);
  app.use(errorMiddleware);
  return app;
}
