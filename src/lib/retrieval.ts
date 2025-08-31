import { prisma } from '../db.js';
import { Prisma } from '@prisma/client';
import { embed, toVectorSqlLiteral } from './embeddings.js';

export async function keywordDocs(q: string, limit = 25) {
  return prisma.$queryRaw<
    { id: string; title: string; actname: string | null; section: string | null }[]
  >(Prisma.sql`
    SELECT id, title, "actName" as actname, section,
           ts_rank(tsv, plainto_tsquery('english', ${q})) AS rank
    FROM "Doc"
    WHERE tsv @@ plainto_tsquery('english', ${q})
       OR title ILIKE ${'%' + q + '%'}
       OR section ILIKE ${'%' + q + '%'}
    ORDER BY rank DESC
    LIMIT ${limit}
  `);
}

export async function vectorChunks(q: string, limit = 25, docIds?: string[]) {
  const qVec = toVectorSqlLiteral(await embed(q));
  const filterDocIds =
    docIds && docIds.length
      ? Prisma.sql`WHERE c."docId" = ANY(${Prisma.join([docIds])})`
      : Prisma.sql``;

  return prisma.$queryRaw<
    { id: string; docId: string; text: string; sim: number }[]
  >(Prisma.sql`
    SELECT c.id, c."docId", c.text,
           1 - (ce.embedding <=> ${Prisma.raw(qVec)}) AS sim
    FROM "Chunk" c
    JOIN chunk_embedding ce ON ce.chunk_id = c.id
    ${filterDocIds}
    ORDER BY ce.embedding <=> ${Prisma.raw(qVec)}
    LIMIT ${limit}
  `);
}

export async function buildContext(chunks: { id: string; docId: string; text: string; sim: number }[], maxPerDoc = 2, maxTotal = 8) {
  const docIds = [...new Set(chunks.map(c => c.docId))];
  const docs = await prisma.doc.findMany({ where: { id: { in: docIds } } });
  const byId: Record<string, any> = Object.fromEntries(docs.map(d => [d.id, d]));

  const selected: { doc: any; chunk: any }[] = [];
  const perDocCount: Record<string, number> = {};
  for (const ch of chunks.sort((a, b) => b.sim - a.sim)) {
    if (selected.length >= maxTotal) break;
    perDocCount[ch.docId] = (perDocCount[ch.docId] ?? 0) + 1;
    if (perDocCount[ch.docId] > maxPerDoc) continue;
    selected.push({ doc: byId[ch.docId], chunk: ch });
  }

  const contextMd = selected.map(({ doc, chunk }) => {
    const head = `### ${doc.title}${doc.section ? ` — ${doc.section}` : ''}\n${doc.actName ? `Act: ${doc.actName}\n` : ''}URL: ${doc.url}\n`;
    const body = `> ${chunk.text.slice(0, 800)}\n`;
    return `${head}${body}`;
  }).join('\n');

  const cites = selected.map(({ doc, chunk }) => ({
    act: doc.actName ?? doc.title,
    section: doc.section ?? '',
    url: doc.url,
    snippet: chunk.text.slice(0, 280),
    score: 0
  }));

  return { contextMd, cites };
}
