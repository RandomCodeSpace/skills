import 'reflect-metadata';
import Decimal from 'decimal.js';
import { inject, injectable } from 'tsyringe';
import type { User, UserRepo } from '../repos/user.js';
import { UserNotFoundError } from '../errors.js';

@injectable()
export class UserService {
  constructor(@inject('UserRepo') private readonly repo: UserRepo) {}

  async getById(id: bigint): Promise<User> {
    const u = await this.repo.findById(id);
    if (!u) throw new UserNotFoundError(id);
    return u;
  }

  async create(input: { name: string; balance: Decimal }): Promise<User> {
    return this.repo.insert(input);
  }
}
