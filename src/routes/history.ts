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
  console.info("[history/list]", { userId: req.auth!.userId, count: sessions.length });
  res.json({ sessions });
});

// Create
historyRouter.post("/", authRequired, async (req: Authed, res) => {
  const s = await prisma.chatSession.create({
    data: { userId: req.auth!.userId, title: req.body?.title || "New chat" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  console.info("[history/create]", { userId: req.auth!.userId, sessionId: s.id });
  res.json({ session: s });
});

// Rename
historyRouter.patch("/:id", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  const { title } = req.body || {};
  const r = await prisma.chatSession.updateMany({
    where: { id, userId: req.auth!.userId },
    data: { title },
  });
  if (r.count === 0) return res.status(404).json({ error: "Not found" });
  console.info("[history/rename]", { userId: req.auth!.userId, id, title });
  res.json({ ok: true });
});

// Delete
historyRouter.delete("/:id", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  const r = await prisma.chatSession.deleteMany({ where: { id, userId: req.auth!.userId } });
  if (r.count === 0) return res.status(404).json({ error: "Not found" });
  console.info("[history/delete]", { userId: req.auth!.userId, id });
  res.json({ ok: true });
});

// Get messages
historyRouter.get("/:id/messages", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  const belongs = await prisma.chatSession.findFirst({ where: { id, userId: req.auth!.userId }, select: { id: true } });
  if (!belongs) return res.status(404).json({ error: "Not found" });
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: { idx: "asc" },
  });
  console.info("[history/messages]", { userId: req.auth!.userId, id, count: msgs.length });
  res.json({ messages: msgs });
});

// Add message
historyRouter.post("/:id/messages", authRequired, async (req: Authed, res) => {
  const { id } = req.params;
  const { role, content, legalResponse, traceId } = req.body || {};

  const belongs = await prisma.chatSession.findFirst({ where: { id, userId: req.auth!.userId }, select: { id: true } });
  if (!belongs) return res.status(404).json({ error: "Not found" });

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
  console.info("[history/addMessage]", { userId: req.auth!.userId, id, role, idx });
  res.json({ message: m });
});
