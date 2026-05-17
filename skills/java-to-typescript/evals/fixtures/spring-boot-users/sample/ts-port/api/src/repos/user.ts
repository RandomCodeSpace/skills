import Decimal from 'decimal.js';
import type { UserRow } from '../db/schema.js';

export type User = {
  id: bigint;
  name: string;
  balance: Decimal;
  createdAt: Date;
};

export type UserRepo = {
  findById(id: bigint): Promise<User | null>;
  insert(input: { name: string; balance: Decimal }): Promise<User>;
};

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    balance: new Decimal(row.balance),
    createdAt: row.createdAt,
  };
}

export function makeUserRepo(store: Map<bigint, UserRow> = new Map()): UserRepo {
  let nextId = 1n;
  return {
    async findById(id) {
      const row = store.get(id);
      return row ? rowToUser(row) : null;
    },
    async insert(input) {
      const id = nextId++;
      const row: UserRow = {
        id,
        name: input.name,
        balance: input.balance.toString(),
        createdAt: new Date(),
      };
      store.set(id, row);
      return rowToUser(row);
    },
  };
}
