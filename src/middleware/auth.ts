// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;
export type Authed = Request & { auth?: { userId: string } };

function readBearer(req: Request) {
  const h = req.headers.authorization ?? req.headers.Authorization as string | undefined;
  if (!h) return null;
  const [scheme, token] = h.split(" ").filter(Boolean);
  return scheme?.toLowerCase() === "bearer" ? token ?? null : null;
}

function looksLikeJwt(token: string) {
  return token.split(".").length === 3;
}

export async function authRequired(req: Authed, res: Response, next: NextFunction) {
  try {
    // Prefer header; optionally allow a cookie named "session" with JWT
    const token =
      readBearer(req) ??
      (typeof (req as any).cookies?.session === "string" ? (req as any).cookies.session : null);

    if (!token) {
      return res.status(401).json({ error: "unauthorized", code: "missing_token" });
    }

    // Helpful guard: if it’s NOT a JWT, tell the caller immediately.
    if (!looksLikeJwt(token)) {
      return res.status(401).json({ error: "unauthorized", code: "expected_jwt_bearer" });
    }

    // Optionally allow small clock skew (seconds)
    const payload = jwt.verify(token, JWT_SECRET, { clockTolerance: 5 }) as {
      userId?: string;
      exp: number;
      iat: number;
      [k: string]: any;
    };

    if (!payload?.userId) {
      return res.status(401).json({ error: "unauthorized", code: "missing_user_in_token" });
    }

    req.auth = { userId: payload.userId };
    return next();
  } catch (err: any) {
    // Give precise signals for client logic
    if (err?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "token expired", code: "token_expired" });
    }
    if (err?.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "invalid token", code: "invalid_token" });
    }
    return res.status(401).json({ error: "unauthorized", code: "auth_error" });
  }
}