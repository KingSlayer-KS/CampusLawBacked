// src/routes/ask.ts
import { Router } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import { keywordDocs, vectorChunks, buildContext } from "../lib/retrieval.js";
import { answerWithLLMJSON, FrontendAnswer } from "../lib/llm.js";
import { authRequired, Authed } from "../middleware/auth.js";

export const askRouter = Router();

/**
 * POST /ask
 * Body: { query: string; topic?: "tenancy"|"traffic"; sessionId?: string }
 * Auth: Bearer JWT (payload must include userId)
 */
askRouter.post("/", authRequired, async (req: Authed, res) => {
  try {
    const { query, topic, sessionId } = (req.body ?? {}) as {
      query?: string;
      topic?: "tenancy" | "traffic";
      sessionId?: string;
    };
    if (!query) return res.status(400).json({ error: "Missing query" });
    if (!req.auth?.userId) return res.status(401).json({ error: "unauthorized" });

    const userId = req.auth.userId;
    const traceId = randomUUID();

    // 1) Ensure we have a valid ChatSession for this user.
    let session = null as null | { id: string; title: string };
    if (sessionId) {
      session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
        select: { id: true, title: true },
      });
      // if client sent a session that doesn't belong to them, reject (or ignore & create)
      if (!session) {
        return res.status(403).json({ error: "Invalid sessionId" });
      }
    } else {
      // Create a new session when none provided
      session = await prisma.chatSession.create({
        data: { userId, title: "New chat" },
        select: { id: true, title: true },
      });
    }
    const sid = session.id;

    // 2) Log the query with a guaranteed-valid FK.
    await prisma.queryLog.create({
      data: {
        userId,
        sessionId: sid,
        query,
        topic: topic ?? "unknown",
        traceId,
      },
    });

    // 3) Retrieval
    const kdocs = await keywordDocs(query, 20);
    const docIds = kdocs.map((d) => d.id);
    const vchunks = await vectorChunks(query, 30, docIds);
    const { contextMd, cites } = await buildContext(vchunks, 2, 8);

    // 4) LLM
    let json = await answerWithLLMJSON(query, contextMd);

    // 5) Merge & dedupe sources
    const merged = [
      ...(json.sources ?? []),
      ...cites.map((c) => ({ title: c.act ?? undefined, url: c.url })),
    ];
    const seen = new Set<string>();
    const sources = merged.filter((s: any) => {
      if (!s?.url) return false;
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    // 6) Fallback for "what_the_law_says"
    if (!json.what_the_law_says?.length && cites.length) {
      const fallback = cites.slice(0, 5).map((c) => ({
        act: c.act || "Source",
        section: c.section ?? "",
        url: c.url,
        quote: c.snippet ?? "",
      }));
      json = { ...json, what_the_law_says: fallback as FrontendAnswer["what_the_law_says"] };
    }

    // 7) Return sessionId so the frontend can bind to it.
    return res.json({
      sessionId: sid,
      traceId,
      ...json,
      sources,
    });
  } catch (err) {
    console.error("POST /ask error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});
