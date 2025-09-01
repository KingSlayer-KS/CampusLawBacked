// src/services/llm.ts
import OpenAI from 'openai';
import { z } from 'zod';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

export const FrontendAnswerSchema = z.object({
  question: z.string(),
  jurisdiction: z.literal("Ontario"),
  // ask for more bullets
  short_answer: z.array(z.string()).min(3).max(6),
  // allow empty when we truly have no law text
  what_the_law_says: z.array(z.object({
    act: z.string(),
    section: z.string(),
    url: z.string().url(),
    quote: z.string()
  })).default([]),
  // default to [] so UI can render consistently
  process_and_forms: z.array(z.object({
    step: z.string(),
    forms: z.array(z.object({ name: z.string(), url: z.string().url() })).optional()
  })).default([]),
  caveats: z.array(z.string()).default([]),
  sources: z.array(z.object({ title: z.string().optional(), url: z.string().url() })).default([]),
  followups: z.array(z.string()).default([]),
  confidence: z.enum(["high","medium","low"]).default("medium")
});
export type FrontendAnswer = z.infer<typeof FrontendAnswerSchema>;

const ToolParameters: any = {
  type: "object",
  properties: {
    question: { type: "string" },
    jurisdiction: { type: "string", enum: ["Ontario"] },
    short_answer: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
    what_the_law_says: {
      type: "array",
      items: {
        type: "object",
        properties: {
          act: { type: "string" },
          section: { type: "string" },
          url: { type: "string", format: "uri" },
          quote: { type: "string" }
        },
        required: ["act","section","url","quote"],
        additionalProperties: false
      }
    },
    process_and_forms: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        properties: {
          step: { type: "string" },
          forms: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, url: { type: "string", format: "uri" } },
              required: ["name","url"],
              additionalProperties: false
            }
          }
        },
        required: ["step"],
        additionalProperties: false
      }
    },
    caveats: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: {
      type: "object",
      properties: { title: { type: "string" }, url: { type: "string", format: "uri" } },
      required: ["url"], additionalProperties: false
    }},
    followups: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
    confidence: { type: "string", enum: ["high","medium","low"] }
  },
  // don't require what_the_law_says so we can truthfully return [] with confidence:"low"
  required: ["question","jurisdiction","short_answer"],
  additionalProperties: false
};

const SYSTEM = `You are a neutral legal information assistant for Ontario, Canada.

Write substantial but concise answers for laypeople. Use ONLY the provided snippets as ground truth; if the law text is missing or unclear, say so and set confidence:"low". Never invent section numbers, quotes, forms, deadlines, or fees. Ontario-only. Avoid sensitive personal data.

Scope constraints:
- Answer ONLY Ontario legal questions. If the question is general (e.g., tech explainers like "What is GitHub?"), not legal, or not about Ontario (or Canada where relevant), politely refuse. Provide 2–3 example Ontario-legal questions the user could ask instead. Do not attempt to answer out-of-scope content.

Return JSON via the function "emit_answer" only. Always include:
- question (echo the user text) and jurisdiction:"Ontario"
- short_answer: 6-10 crisp bullets
- what_the_law_says: 1–3 items with act, section, url, and a short direct quote (≤40 words)
- process_and_forms: 2–5 practical steps; include official form names + URLs when relevant
- caveats: 2–4 items (scope limits, deadlines, exemptions)
- sources: authoritative Ontario URLs (can duplicate law URLs)
- followups: 2–4 helpful next questions
Target ~350–450 words across fields.`;

function parseOrThrow(jsonStr: string) {
  const obj = JSON.parse(jsonStr);
  return FrontendAnswerSchema.parse(obj);
}

export async function answerWithLLMJSON(question: string, contextMd: string) {
  const resp = await openai.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.2,
    // (optional) let answers breathe a bit more
    max_tokens: 800,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: question },
      { role: 'assistant', content: 'Relevant sources and excerpts:\n' + contextMd }
    ],
    tools: [{
      type: "function",
      function: { name: "emit_answer", description: "Return JSON for frontend", parameters: ToolParameters }
    }],
    tool_choice: { type: "function", function: { name: "emit_answer" } }
  });

  const toolArgs = resp.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (toolArgs) return parseOrThrow(toolArgs);

  const content = resp.choices?.[0]?.message?.content;
  if (content) {
    try { return parseOrThrow(content); } catch {}
  }

  // minimal safe fallback
  return FrontendAnswerSchema.parse({
    question,
    jurisdiction: "Ontario",
    short_answer: ["No structured answer received."],
    what_the_law_says: [],
    process_and_forms: [],
    caveats: [],
    sources: [],
    followups: [],
    confidence: "low"
  });
}
