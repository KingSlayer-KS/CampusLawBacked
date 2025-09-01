// src/routes/auth.ts
import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { addDays } from "date-fns";
import { prisma } from "../db.js";                // your Prisma client export
import { signAccessToken } from "../utils/jwt.js"; // your existing JWT helper
import { validate } from "../middleware/validate.js";
import { signupSchema, loginSchema } from "../schemas/auth.js";

export const authRouter = Router();

/* ────────────────────────────────────────────────
   DB-backed refresh session (opaque token)
   ──────────────────────────────────────────────── */
async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const ttlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
  return prisma.session.create({
    data: {
      userId,
      token,
      expiresAt: addDays(new Date(), ttlDays), // ✅ real Date object
    },
    select: { id: true, token: true, expiresAt: true, userId: true },
  });
}

async function rotateSession(oldToken: string) {
  const existing = await prisma.session.findUnique({ where: { token: oldToken } });
  if (!existing) return null;
  await prisma.session.delete({ where: { token: oldToken } });
  return createSession(existing.userId);
}

/* ────────────────────────────────────────────────
   POST /auth/signup
   ──────────────────────────────────────────────── */
authRouter.post("/signup", validate(signupSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, name } = (req as any).validated;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: "User already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true, name: true },
    });

    const accessToken = signAccessToken({ userId: user.id });
    const session = await createSession(user.id);

    console.info("[auth/signup] created", { userId: user.id, email });
    return res.json({
      token: accessToken,          // short-lived JWT
      refreshToken: session.token, // long-lived opaque token
      user,
    });
  } catch (err: any) {
    console.error("[auth/signup] error:", err?.message || err);
    return res.status(400).json({ error: err?.message ?? "Signup failed" });
  }
});

/* ────────────────────────────────────────────────
   POST /auth/login
   ──────────────────────────────────────────────── */
authRouter.post("/login", validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = (req as any).validated;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.warn("[auth/login] no user", { email });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      console.warn("[auth/login] bad password", { userId: user.id });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accessToken = signAccessToken({ userId: user.id });
    const session = await createSession(user.id);

    console.info("[auth/login] success", { userId: user.id });
    return res.json({
      token: accessToken,
      refreshToken: session.token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err: any) {
    console.error("[auth/login] error:", err?.message || err);
    return res.status(400).json({ error: err?.message ?? "Login failed" });
  }
});

/* ────────────────────────────────────────────────
   POST /auth/refresh { refreshToken }
   ──────────────────────────────────────────────── */
authRouter.post("/refresh", async (req: Request, res: Response) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: "Missing refreshToken" });

  const session = await prisma.session.findUnique({ where: { token: refreshToken } });
  if (!session) {
    console.warn("[auth/refresh] invalid token");
    return res.status(401).json({ error: "Invalid refreshToken" });
  }

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { token: refreshToken } });
    console.warn("[auth/refresh] expired", { userId: session.userId });
    return res.status(401).json({ error: "Refresh token expired" });
  }

  const newSession = await rotateSession(refreshToken);
  if (!newSession) {
    console.warn("[auth/refresh] rotate failed", { userId: session.userId });
    return res.status(401).json({ error: "Invalid session" });
  }

  const accessToken = signAccessToken({ userId: session.userId });
  console.info("[auth/refresh] success", { userId: session.userId });
  return res.json({
    token: accessToken,
    refreshToken: newSession.token,
    expiresAt: newSession.expiresAt,
  });
});

/* ────────────────────────────────────────────────
   POST /auth/logout { refreshToken }
   ──────────────────────────────────────────────── */
authRouter.post("/logout", async (req: Request, res: Response) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    try {
      await prisma.session.delete({ where: { token: refreshToken } });
    } catch {
      // ignore if already deleted
    }
  }
  return res.json({ ok: true });
});
