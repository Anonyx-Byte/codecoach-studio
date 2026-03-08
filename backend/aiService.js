const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

function normalizeProvider(value) {
  const v = String(value || "groq").trim().toLowerCase();
  if (v === "gemma" || v === "bedrock" || v === "aws" || v === "aws_bedrock") return "gemma";
  if (v === "auto") return "auto";
  return "groq";
}

function normalizeReviewType(value) {
  const v = String(value || "quick").trim().toLowerCase();
  return v === "detailed" ? "detailed" : "quick";
}

function extractTextFromUnknown(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload.trim();

  const choiceContent = payload?.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") return choiceContent.trim();
  if (Array.isArray(choiceContent)) {
    const joined = choiceContent.map((x) => (typeof x === "string" ? x : x?.text || "")).join("\n").trim();
    if (joined) return joined;
  }

  if (Array.isArray(payload?.output)) {
    const joined = payload.output.map((x) => x?.text || "").join("\n").trim();
    if (joined) return joined;
  }

  if (Array.isArray(payload?.content)) {
    const joined = payload.content.map((x) => (typeof x === "string" ? x : x?.text || "")).join("\n").trim();
    if (joined) return joined;
  }

  if (Array.isArray(payload?.candidates)) {
    const first = payload.candidates[0];
    const parts = first?.content?.parts;
    if (Array.isArray(parts)) {
      const joined = parts.map((x) => x?.text || "").join("\n").trim();
      if (joined) return joined;
    }
    if (typeof first?.content === "string" && first.content.trim()) return first.content.trim();
  }

  if (typeof payload?.generation === "string" && payload.generation.trim()) return payload.generation.trim();
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  if (typeof payload?.text === "string" && payload.text.trim()) return payload.text.trim();
  return "";
}

async function decodeBody(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (typeof body.transformToString === "function") {
    return body.transformToString("utf8");
  }
  return Buffer.from(body).toString("utf8");
}

class AIService {
  constructor(env = process.env) {
    this.env = env;
    this._bedrockClient = null;
    this._bedrockClientRegion = "";
  }

  getGroqModel() {
    return String(this.env.GROQ_MODEL || this.env.AI_MODEL || "llama-3.1-8b-instant");
  }

  getGemmaModel(reviewType = "quick") {
    const mode = normalizeReviewType(reviewType);
    if (mode === "detailed") {
      return String(this.env.GEMMA_DETAILED_MODEL_ID || "google.gemma-3-12b-it");
    }
    return String(this.env.GEMMA_QUICK_MODEL_ID || "google.gemma-3-4b-it");
  }

  getBedrockRegion() {
    return String(this.env.AWS_REGION || this.env.BEDROCK_REGION || "").trim();
  }

  isGroqConfigured() {
    return Boolean(String(this.env.GROQ_API_KEY || "").trim());
  }

  isGemmaConfigured() {
    return Boolean(this.getBedrockRegion() && this.getGemmaModel("quick") && this.getGemmaModel("detailed"));
  }

  getStatus() {
    return {
      groq: {
        configured: this.isGroqConfigured(),
        model: this.getGroqModel()
      },
      gemma: {
        configured: this.isGemmaConfigured(),
        region: this.getBedrockRegion() || null,
        models: {
          quick: this.getGemmaModel("quick"),
          detailed: this.getGemmaModel("detailed")
        }
      }
    };
  }

  getBedrockClient() {
    const region = this.getBedrockRegion();
    if (!region) {
      throw new Error("AWS_REGION (or BEDROCK_REGION) is required for Gemma via Bedrock");
    }

    if (this._bedrockClient && this._bedrockClientRegion === region) {
      return this._bedrockClient;
    }

    this._bedrockClientRegion = region;
    this._bedrockClient = new BedrockRuntimeClient({
      region,
      ...(this.env.AWS_ACCESS_KEY_ID && this.env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: this.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: this.env.AWS_SECRET_ACCESS_KEY,
              ...(this.env.AWS_SESSION_TOKEN ? { sessionToken: this.env.AWS_SESSION_TOKEN } : {})
            }
          }
        : {})
    });
    return this._bedrockClient;
  }

  async callGroq(prompt, opts = {}) {
    const apiKey = String(this.env.GROQ_API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set");
    }

    const model = String(opts.model || this.getGroqModel());
    const temperature = Number(opts.temperature ?? 0.2);
    const maxTokens = Number(opts.maxTokens ?? 900);
    const timeoutMs = Number(opts.timeoutMs ?? 30000);
    const systemPrompt = String(opts.systemPrompt || "You are a concise programming tutor.");

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
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ]
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Groq API error ${resp.status}: ${errText}`);
      }

      const data = await resp.json();
      const text = extractTextFromUnknown(data);
      if (!text) {
        throw new Error("Groq API returned empty output");
      }

      return {
        ok: true,
        provider: "groq",
        model,
        reviewType: normalizeReviewType(opts.reviewType),
        text
      };
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`Groq request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async callGemma(prompt, opts = {}) {
    const reviewType = normalizeReviewType(opts.reviewType);
    const model = String(opts.model || this.getGemmaModel(reviewType));
    const temperature = Number(opts.temperature ?? 0.7);
    const maxTokens = Number(opts.maxTokens ?? (reviewType === "detailed" ? 700 : 300));
    const timeoutMs = Number(opts.timeoutMs ?? 30000);

    const body = {
      messages: [{ role: "user", content: String(prompt || "") }],
      max_tokens: maxTokens,
      temperature
    };

    const client = this.getBedrockClient();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const command = new InvokeModelCommand({
        modelId: model,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body)
      });
      const response = await client.send(command, { abortSignal: controller.signal });
      const rawText = await decodeBody(response?.body);
      const parsed = rawText ? JSON.parse(rawText) : {};
      const text = extractTextFromUnknown(parsed);
      if (!text) {
        throw new Error("Gemma returned empty output");
      }

      return {
        ok: true,
        provider: "gemma",
        model,
        reviewType,
        text
      };
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`Gemma request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateText({ prompt, provider = "groq", reviewType = "quick", maxTokens, temperature, timeoutMs = 30000, fallback = true } = {}) {
    const normalizedProvider = normalizeProvider(provider);
    const normalizedReviewType = normalizeReviewType(reviewType);

    const primary = normalizedProvider === "auto"
      ? (this.isGemmaConfigured() ? "gemma" : "groq")
      : normalizedProvider;
    const secondary = primary === "groq" ? "gemma" : "groq";
    const order = fallback ? [primary, secondary] : [primary];

    const errors = [];
    for (let i = 0; i < order.length; i += 1) {
      const current = order[i];
      try {
        const result = current === "gemma"
          ? await this.callGemma(prompt, { reviewType: normalizedReviewType, maxTokens, temperature, timeoutMs })
          : await this.callGroq(prompt, { reviewType: normalizedReviewType, maxTokens, temperature, timeoutMs });

        if (i > 0) {
          result.fallbackFrom = primary;
        }
        return result;
      } catch (err) {
        errors.push(`${current}: ${String(err?.message || err)}`);
      }
    }

    throw new Error(`All providers failed. ${errors.join(" | ")}`);
  }

  async generateReview({ prompt, provider = "groq", reviewType = "quick", timeoutMs = 30000 } = {}) {
    const mode = normalizeReviewType(reviewType);
    return this.generateText({
      prompt,
      provider,
      reviewType: mode,
      maxTokens: 300,
      temperature: 0.7,
      timeoutMs,
      fallback: true
    });
  }

  async generateExercise({ prompt, timeoutMs = 35000 } = {}) {
    return this.generateText({
      prompt,
      provider: "gemma",
      reviewType: "detailed",
      maxTokens: 1200,
      temperature: 0.4,
      timeoutMs,
      fallback: true
    });
  }
}

module.exports = { AIService };
