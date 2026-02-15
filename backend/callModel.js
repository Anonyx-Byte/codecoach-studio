// backend/callModel.js
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

function extractTextFromResponse(json) {
  return json?.choices?.[0]?.message?.content?.trim() || "";
}

async function callModel(prompt, opts = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in backend/.env");
  }

  const model = opts.model || process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 900;
  const timeoutMs = Number(opts.timeoutMs ?? process.env.GROQ_TIMEOUT_MS ?? 30000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          {
            role: "system",
            content: "You are a concise programming tutor. When asked for JSON, return valid JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Groq API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const text = extractTextFromResponse(data);
    if (!text) {
      throw new Error("Groq API returned an empty completion");
    }

    return text;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Groq API request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callModel };
