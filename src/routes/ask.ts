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

    // 3b) Simple gating + allowlist to keep scope Ontario-legal
    const allowedHosts = [
      "ontario.ca",
      "canlii.org",
      "tribunalsontario.ca",
      "laws-lois.justice.gc.ca",
      "ontariocourts.ca",
    ];
    const urlToHost = (u: string) => {
      try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
    };
    const isAllowed = (u?: string) => {
      const h = u ? urlToHost(u) : "";
      return !!h && allowedHosts.some((d) => h === d || h.endsWith("." + d));
    };

    const allowedCites = cites.filter((c) => isAllowed(c.url));

    const minDocsOk = kdocs.length >= 2;
    const minChunksOk = vchunks.length >= 4;
    const hasAllowedCite = allowedCites.length > 0;

    function refusal(): FrontendAnswer {
      return {
        question: query,
        jurisdiction: "Ontario",
        short_answer: [
          "I focus on Ontario legal information.",
          "This question appears outside that scope (not an Ontario legal question).",
          "Try rephrasing with a clear Ontario law topic or situation.",
        ],
        what_the_law_says: [],
        process_and_forms: [],
        caveats: [
          "General or non-legal questions cannot be answered here.",
          "I can help with Ontario statutes, tribunals, and procedures.",
        ],
        sources: [],
        followups: [
          "What laws govern rent increases in Ontario?",
          "How do I dispute a speeding ticket in Ontario?",
          "How can I end a tenancy in Ontario?",
        ],
        confidence: "low",
      };
    }

    if (!minDocsOk || !minChunksOk || !hasAllowedCite) {
      console.warn("[ask] gating refusal", {
        userId,
        sessionId: sid,
        minDocsOk,
        minChunksOk,
        hasAllowedCite,
        kdocs: kdocs.length,
        vchunks: vchunks.length,
        allowedCites: allowedCites.length,
      });
      // Out-of-scope or poor retrieval; return structured refusal
      const json = refusal();
      return res.json({
        sessionId: sid,
        traceId,
        ...json,
        sources: [],
      });
    }

    // 4) LLM
    let json = await answerWithLLMJSON(query, contextMd);

    // 5) Merge & dedupe sources
    const mergedAll = [
      ...(json.sources ?? []),
      ...cites.map((c) => ({ title: c.act ?? undefined, url: c.url })),
    ];
    const seen = new Set<string>();
    const sources = mergedAll
      .filter((s: any) => s?.url && isAllowed(s.url))
      .filter((s: any) => {
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

    // 6b) If after filtering there are no allowed sources, downgrade to refusal
    if (sources.length === 0) {
      const r = refusal();
      return res.json({ sessionId: sid, traceId, ...r, sources: [] });
    }

    // 7) Return sessionId so the frontend can bind to it.
    console.info("[ask] success", {
      userId,
      sessionId: sid,
      traceId,
      sources: sources.length,
    });
    return res.json({
      sessionId: sid,
      traceId,
      ...json,
      sources,
    });
  } catch (err) {
    console.error("[ask] error", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});
