import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../middleware/auth.js";
import type { Authed } from "../middleware/auth.js";

export const feedbackRouter = Router();

// Require auth so we can reliably capture userId
feedbackRouter.post("/", authRequired, async (req: Authed, res) => {
  const body = req.body as {
    traceId: string;
    helpful: boolean;
    reasons?: string[];
    comment?: string;
    answerSummary?: string;
    sessionId?: string;
  };

  if (!body?.traceId || typeof body.helpful !== "boolean") {
    return res.status(400).json({ error: "Missing fields" });
  }

  await prisma.feedback.create({
    data: {
      userId: req.auth?.userId ?? null,
      sessionId: body.sessionId ?? null,
      traceId: body.traceId,
      helpful: body.helpful,
      reasons: body.reasons ?? [],
      note: body.comment ?? null,
      answerSummary: body.answerSummary ?? null,
    },
  });
  console.info("[feedback] created", {
    userId: req.auth?.userId ?? null,
    sessionId: body.sessionId ?? null,
    traceId: body.traceId,
    helpful: body.helpful,
  });

  res.json({ ok: true });
});
