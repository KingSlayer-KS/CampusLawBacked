// src/utils/jwt.ts
import { createRequire } from "node:module";
import crypto from "crypto";

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET env var is required");
}
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m";

export type AccessJWTPayload = {
  userId: string; // <-- this is what authRequired expects
  sid?: string;   // optional – unused in stateless mode
  ver?: string;   // optional – unused in stateless mode
};

export function signAccessToken(payload: AccessJWTPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessJWTPayload {
  return jwt.verify(token, JWT_SECRET) as AccessJWTPayload;
}

export function deriveSessionVersion(sessionToken: string) {
  return crypto.createHash("sha256").update(sessionToken).digest("base64url").slice(0, 16);
}
