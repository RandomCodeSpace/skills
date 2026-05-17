import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { makeUserRepo } from './repos/user.js';
import { CreateUserSchema, UserResponseSchema } from './schemas/user.js';
import { UsersError, UserNotFoundError } from './errors.js';

describe('sanity', () => {
  it('arithmetic still works', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('schemas', () => {
  it('CreateUserSchema accepts a valid body', () => {
    const parsed = CreateUserSchema.parse({ name: 'Ada', balance: '10.5' });
    expect(parsed.name).toBe('Ada');
  });

  it('CreateUserSchema rejects non-decimal balance', () => {
    expect(() => CreateUserSchema.parse({ name: 'Ada', balance: 'abc' })).toThrow();
  });

  it('UserResponseSchema round-trips', () => {
    const out = UserResponseSchema.parse({
      id: '1',
      name: 'Ada',
      balance: '10.5',
      createdAt: new Date(0).toISOString(),
    });
    expect(out.id).toBe('1');
  });
});

describe('repo', () => {
  it('insert + findById returns a User with Decimal balance', async () => {
    const repo = makeUserRepo();
    const created = await repo.insert({ name: 'Ada', balance: new Decimal('1.25') });
    const fetched = await repo.findById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.balance.toString()).toBe('1.25');
    expect(typeof fetched!.id).toBe('bigint');
  });
});

describe('errors', () => {
  it('UserNotFoundError extends UsersError with status 404', () => {
    const e = new UserNotFoundError(7n);
    expect(e).toBeInstanceOf(UsersError);
    expect(e.status).toBe(404);
  });
});
