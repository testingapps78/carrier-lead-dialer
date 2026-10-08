// Thin client for any OpenAI-compatible chat API (Groq by default).
// Swap providers by changing env vars only: AI_BASE_URL, AI_API_KEY, AI_MODEL, AI_FALLBACK_MODEL.

const BASE_URL = () => (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const PRIMARY_MODEL = () => process.env.AI_MODEL || "openai/gpt-oss-120b";
const FALLBACK_MODEL = () => process.env.AI_FALLBACK_MODEL || "openai/gpt-oss-20b";
const TIMEOUT_MS = 20000;

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI isn't set up yet.");
    this.name = "AiNotConfiguredError";
  }
}
export class AiBusyError extends Error {
  constructor(message = "The free AI service is busy right now. Try again in a minute.") {
    super(message);
    this.name = "AiBusyError";
  }
}

export function aiConfigured(): boolean {
  return !!process.env.AI_API_KEY;
}

/** Pulls a JSON object out of a model reply, tolerating code fences or stray text. */
export function parseJsonLoose(text: string): any {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI returned an unreadable answer.");
  }
}

async function callModel(model: string, system: string, user: string, maxTokens: number, jsonMode: boolean) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.6,
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  if (model.includes("gpt-oss")) body.reasoning_effort = "low"; // keep it fast; the tasks are simple

  return fetch(`${BASE_URL()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Asks the model for a JSON object. Falls back to a second model if the first is rate limited. */
export async function aiJson(system: string, user: string, maxTokens = 1500): Promise<any> {
  if (!aiConfigured()) throw new AiNotConfiguredError();

  const models = [PRIMARY_MODEL(), FALLBACK_MODEL()].filter((m, i, a) => a.indexOf(m) === i);
  let lastStatus = 0;

  for (const model of models) {
    let jsonMode = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await callModel(model, system, user, maxTokens, jsonMode);
      } catch {
        lastStatus = 0; // timeout or network — try the next model
        break;
      }
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const content: string = data?.choices?.[0]?.message?.content ?? "";
        if (!content) break;
        return parseJsonLoose(content);
      }
      lastStatus = res.status;
      if (res.status === 400 && jsonMode) {
        jsonMode = false; // this model rejected JSON mode — retry the same model without it
        continue;
      }
      break;
    }
    if (lastStatus === 401 || lastStatus === 403) throw new Error("The AI key was rejected. Check AI_API_KEY in Vercel.");
  }
  throw new AiBusyError();
}
