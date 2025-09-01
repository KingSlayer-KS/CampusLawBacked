import { Router } from "express";
import { prisma } from "../db.js";
import axios from "axios";
import * as cheerio from "cheerio";
import pdfParseModule from "pdf-parse/lib/pdf-parse.js";
import { embed, toVectorSqlLiteral } from "../lib/embeddings.js";
import { Prisma } from "@prisma/client";
import { authRequired } from "../middleware/auth.js";

const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
  (pdfParseModule as any).default || (pdfParseModule as any);

export const ingestRouter = Router();

/** ---- Tuning knobs (env overrides) ---- */
const MAX_TEXT_CHARS = Number(process.env.MAX_TEXT_CHARS ?? 250_000);   // cap per doc
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE ?? 1000);
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP ?? 150);
const MAX_EMBED_CHUNKS_PER_DOC = Number(process.env.MAX_EMBED_CHUNKS_PER_DOC ?? 120);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 60_000);

/** Utilities */
function looksLikePdf(url: string, contentType?: string) {
  const ct = (contentType || "").toLowerCase();
  return ct.includes("application/pdf") || url.toLowerCase().endsWith(".pdf");
}
function sanitizeText(t: string) {
  return t.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Generator: yields chunk ranges so we don't allocate a big array */
function* iterChunkRanges(s: string, max = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  let i = 0;
  const len = s.length;
  while (i < len) {
    const hardEnd = Math.min(i + max, len);
    // prefer to end at a boundary near the end of this window
    const dot = s.lastIndexOf(". ", hardEnd);
    const nl = s.lastIndexOf("\n", hardEnd);
    const boundary = Math.max(dot, nl);
    const end = boundary > i + Math.floor(max * 0.5) ? boundary + 1 : hardEnd;
    yield { start: i, end };
    i = Math.max(0, end - overlap);
  }
}

/** Main ingest */
ingestRouter.post("/", authRequired, async (req, res) => {
  console.info("[ingest] start", { userId: (req as any).auth?.userId, count: (req.body?.docs || []).length });
  const docs = (req.body?.docs ?? []) as { url: string; html?: string }[];
  if (!Array.isArray(docs) || docs.length === 0) return res.status(400).json({ error: "No docs" });

  const perDoc: Array<{
    url: string;
    title: string;
    actName?: string;
    section?: string;
    contentType?: string;
    textLength: number;
    chunks: number;
    error?: string;
  }> = [];

  let totalInserted = 0;

  for (const d of docs) {
    let text = "";
    let title = d.url;
    let actName: string | undefined;
    let section: string | undefined;
    let contentType: string | undefined;

    try {
      if (d.html) {
        const $ = cheerio.load(d.html);
        $("script, style, nav, header, footer").remove();
        title = $("h1").first().text().trim() || $("title").text().trim() || d.url;
        const h2 = $("h2").first().text().trim();
        actName = /Act/i.test(title) ? title : undefined;
        section = h2?.match(/s\.?\s?\d+[A-Za-z\-]*/)?.[0] || undefined;
        text = sanitizeText($("body").text()).slice(0, MAX_TEXT_CHARS);
      } else {
        const r = await axios.get(d.url, {
          timeout: FETCH_TIMEOUT_MS,
          responseType: "arraybuffer", // handle PDFs safely
          headers: {
            Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
            "User-Agent": "legalcopilot-ingester/1.0",
          },
          maxRedirects: 5,
        });

        contentType = String(r.headers["content-type"] || "");
        if (looksLikePdf(d.url, contentType)) {
          const buf = Buffer.from(r.data);
          const parsed = await pdfParse(buf);
          text = sanitizeText(parsed.text || "").slice(0, MAX_TEXT_CHARS);
          title = d.url; // PDFs rarely have a reliable title
          actName = /Act/i.test(title) ? title : undefined;
        } else {
          const html = Buffer.from(r.data).toString("utf8");
          const $ = cheerio.load(html);
          $("script, style, nav, header, footer").remove();
          title = $("h1").first().text().trim() || $("title").text().trim() || d.url;
          const h2 = $("h2").first().text().trim();
          actName = /Act/i.test(title) ? title : undefined;
          section = h2?.match(/s\.?\s?\d+[A-Za-z\-]*/)?.[0] || undefined;
          text = sanitizeText($("body").text()).slice(0, MAX_TEXT_CHARS);
        }
      }

      if (!text) {
        perDoc.push({ url: d.url, title, textLength: 0, chunks: 0 });
        continue;
      }

      // Upsert doc meta + content
      const doc = await prisma.doc.upsert({
        where: { url: d.url },
        create: {
          url: d.url,
          title,
          jurisdiction: "ON",
          actName,
          section,
          lastChecked: new Date(),
          content: text,
        },
        update: { title, actName, section, lastChecked: new Date(), content: text },
      });

      // Replace previous chunks for this doc
      await prisma.chunk.deleteMany({ where: { docId: doc.id } });

      let idx = 0;
      let createdCount = 0;

      // Process chunks sequentially (no big arrays)
      for (const { start, end } of iterChunkRanges(text)) {
        const ch = text.slice(start, end); // short-lived substring
        const created = await prisma.chunk.create({
          data: { docId: doc.id, idx: idx++, text: ch },
          select: { id: true }, // only what we need
        });

        const vec = await embed(ch.slice(0, 4000)); // keep token count in check
        const vecSql = toVectorSqlLiteral(vec);
        await prisma.$executeRaw(
          Prisma.sql`
            insert into chunk_embedding (chunk_id, embedding)
            values (${created.id}, ${Prisma.raw(vecSql)})
            on conflict (chunk_id) do update set embedding = excluded.embedding
          `
        );

        createdCount++;
        totalInserted++;

        // Yield every 20 chunks to let GC work
        if (createdCount % 20 === 0) {
          await new Promise((r) => setImmediate(r));
        }
        if (createdCount >= MAX_EMBED_CHUNKS_PER_DOC) break;
      }

      // release big refs ASAP
      text = "";

      perDoc.push({
        url: d.url,
        title,
        actName,
        section,
        contentType,
        textLength: doc.content?.length ?? 0,
        chunks: idx,
      });
    } catch (err: any) {
      console.error("Ingest failed for", d.url, err?.message || err);
      perDoc.push({
        url: d.url,
        title,
        actName,
        section,
        contentType,
        textLength: 0,
        chunks: 0,
        error: err?.message || String(err),
      });
      // continue with next doc
    }
  }

  console.info("[ingest] done", { inserted: totalInserted, docsProcessed: perDoc.length });
  return res.json({ inserted: totalInserted, docsProcessed: perDoc.length, perDoc });
});
