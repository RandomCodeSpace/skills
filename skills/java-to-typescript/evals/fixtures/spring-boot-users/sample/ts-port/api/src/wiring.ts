import 'reflect-metadata';
import { container } from 'tsyringe';
import { makeUserRepo } from './repos/user.js';

export function wireContainer(): void {
  container.register('UserRepo', { useValue: makeUserRepo() });
}
