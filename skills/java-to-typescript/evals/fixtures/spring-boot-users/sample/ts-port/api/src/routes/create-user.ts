import type { Request, Response, NextFunction } from 'express';
import Decimal from 'decimal.js';
import { container } from 'tsyringe';
import { UserService } from '../services/user-service.js';
import { CreateUserSchema, UserResponseSchema, type UserResponse } from '../schemas/user.js';

export async function createUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = CreateUserSchema.parse(req.body);
    const service = container.resolve(UserService);
    const user = await service.create({
      name: input.name,
      balance: new Decimal(input.balance),
    });
    const body: UserResponse = UserResponseSchema.parse({
      id: user.id.toString(),
      name: user.name,
      balance: user.balance.toString(),
      createdAt: user.createdAt.toISOString(),
    });
    res.status(201).json(body);
  } catch (e) {
    next(e);
  }
}
