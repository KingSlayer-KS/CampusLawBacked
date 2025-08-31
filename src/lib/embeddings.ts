import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small';

export async function embed(text: string): Promise<number[]> {
  const { data } = await openai.embeddings.create({
    input: text.replace(/\s+/g, ' ').slice(0, 8000),
    model: EMBED_MODEL
  });
  return data[0].embedding as number[];
}

export function toVectorSqlLiteral(vec: number[]) {
  const trimmed = vec.map(v => (Number.isFinite(v) ? v : 0)).join(',');
  return `ARRAY[${trimmed}]::vector(1536)`;
}
