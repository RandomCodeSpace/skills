export class UsersError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'UsersError';
    this.status = status;
  }
}

export class UserNotFoundError extends UsersError {
  constructor(id: bigint) {
    super(`user not found: ${id.toString()}`, 404);
    this.name = 'UserNotFoundError';
  }
}
