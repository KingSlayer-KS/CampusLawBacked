// src/routes/history.ts
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, Authed } from "../middleware/auth.js";

export const historyRouter = Router();

// List sessions (latest first)
historyRouter.get("/", authRequired, async (req: Authed, res) => {
  const sessions = await prisma.chatSession.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  res.json({ sessions });
});

// Create
historyRouter.post("/", authRequired, async (req: Authed, res) => {
  const s = await prisma.chatSession.create({
    data: { userId: req.auth!.userId, title: req.body?.title || "New chat" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  res.json({ session: s });
});

// Rename
historyRouter.patch("/:id", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  const { title } = req.body || {};
  await prisma.chatSession.update({
    where: { id },
    data: { title },
  });
  res.json({ ok: true });
});

// Delete
historyRouter.delete("/:id", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  await prisma.chatSession.delete({ where: { id } });
  res.json({ ok: true });
});

// Get messages
historyRouter.get("/:id/messages", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: { idx: "asc" },
  });
  res.json({ messages: msgs });
});

// Add message
historyRouter.post("/:id/messages", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  const { role, content, legalResponse, traceId } = req.body || {};

  const last = await prisma.chatMessage.findFirst({
    where: { sessionId: id },
    orderBy: { idx: "desc" },
    select: { idx: true },
  });
  const idx = (last?.idx ?? -1) + 1;

  const m = await prisma.chatMessage.create({
    data: {
      sessionId: id,
      role,
      content: content ?? "",
      legalResponse: legalResponse ?? null,
      traceId,
      idx,
    },
  });
  res.json({ message: m });
});
