# Ontario Legal Copilot — Backend (Express + TS + Supabase)

This is a minimal **Express + TypeScript** API that uses **Supabase Postgres** (with `pgvector` + FTS) and OpenAI for embeddings + answers.
No Docker. Point Prisma at your Supabase connection string.

## Setup (Supabase + local dev)

1) **Create a Supabase project** and get the **Direct connection string (URI)**  
   Supabase → Settings → Database → Connection string → **URI** (Direct)  
   Example:  
   `postgresql://postgres:<PASSWORD>@<HOST>:5432/postgres?sslmode=require`

2) **Enable extensions and create vector table/index** in Supabase SQL editor:  
   Copy the contents of `api/sql/supabase_init.sql` into the Supabase SQL editor and run it **once**.

3) **Local env**
```bash
cd api
cp .env.example .env   # paste your Supabase DATABASE_URL and OpenAI key
npm i
```

4) **Prisma**
```bash
npx prisma generate
# Push the Prisma models to Supabase (creates tables only).
npx prisma db push
```

5) **Run the API**
```bash
npm run dev   # starts http://localhost:4001
```

6) **Seed a few official sources** (optional to demo Q&A)
```bash
npx tsx scripts/seed.ts
```

7) **Try a question**
```bash
curl -s http://localhost:4001/ask -H "content-type: application/json" -d '{"query":"Can my landlord raise rent mid-lease?","topic":"tenancy"}' | jq .
```

---

## Endpoints (Internal REST)
- `POST /ask` → Main Q&A. Body: `{ query: string, topic: "tenancy"|"traffic" }`  
  Returns: `{ answer, cites[], traceId }`
- `POST /ingest` → Add/refresh sources. Body: `{ docs: {url:string, html?:string}[] }`  
  Returns: `{ inserted }` (number of chunks embedded)
- `GET /sources?q=&limit=` → Debug search over stored laws/pages.
- `POST /feedback` → Save rating. Body: `{ traceId, helpful, note? }`

## External APIs
- **OpenAI API**
  - Embeddings: `text-embedding-3-small` (1536-dim).
  - Chat: `gpt-4o-mini` (swap as you prefer).

## Notes
- This is **general information** only — not legal advice.
- Start with a small, curated set of **official Ontario** pages (seed included).
