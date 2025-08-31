-- Run this ONCE in Supabase SQL Editor

-- 1) Enable extensions (if not already)
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists vector;

-- 2) FTS trigger for Doc.tsv
create or replace function doc_tsv_trigger() returns trigger as $$
begin
  new.tsv :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new."actName", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.section, '')), 'A') ||
    setweight(to_tsvector('english', regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g')), 'B');
  return new;
end
$$ language plpgsql;

drop trigger if exists doc_tsv_update on "Doc";
create trigger doc_tsv_update
before insert or update on "Doc"
for each row execute function doc_tsv_trigger();

-- 3) FTS index
create index if not exists idx_doc_tsv on "Doc" using gin (tsv);

-- 4) Vector companion table for chunk embeddings
create table if not exists chunk_embedding (
  chunk_id text primary key references "Chunk"(id) on delete cascade,
  embedding vector(1536) not null
);

-- 5) Vector index (IVFFlat). Adjust lists as needed.
create index if not exists idx_chunk_embedding
  on chunk_embedding using ivfflat (embedding vector_cosine_ops) with (lists = 100);
