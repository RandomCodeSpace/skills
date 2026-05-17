import type { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { UserService } from '../services/user-service.js';
import { UserResponseSchema, type UserResponse } from '../schemas/user.js';

export async function getUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const idStr = req.params.id;
    if (!idStr || !/^\d+$/.test(idStr)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const service = container.resolve(UserService);
    const user = await service.getById(BigInt(idStr));
    const body: UserResponse = UserResponseSchema.parse({
      id: user.id.toString(),
      name: user.name,
      balance: user.balance.toString(),
      createdAt: user.createdAt.toISOString(),
    });
    res.json(body);
  } catch (e) {
    next(e);
  }
}
