// src/schemas/auth.ts
import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Reusable types
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput  = z.infer<typeof loginSchema>;
