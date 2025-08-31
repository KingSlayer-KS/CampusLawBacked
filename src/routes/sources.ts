import { Router } from 'express';
import { prisma } from '../db.js';
export const sourcesRouter = Router();

sourcesRouter.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Number(req.query.limit || 10);
  if (!q) {
    const recent = await prisma.doc.findMany({ orderBy: { updatedAt: 'desc' }, take: limit });
    return res.json(recent);
  }
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, title, "actName", section, url
    FROM "Doc"
    WHERE tsv @@ plainto_tsquery('english', ${q})
    ORDER BY ts_rank(tsv, plainto_tsquery('english', ${q})) DESC
    LIMIT ${limit}
  `;
  res.json(rows);
});
