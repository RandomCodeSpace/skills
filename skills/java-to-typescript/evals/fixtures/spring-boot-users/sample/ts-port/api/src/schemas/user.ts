import { z } from 'zod';

export const CreateUserSchema = z.object({
  name: z.string().min(1).max(200),
  balance: z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string'),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UserResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  balance: z.string(),
  createdAt: z.string(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;
