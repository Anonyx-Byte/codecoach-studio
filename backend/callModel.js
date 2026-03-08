// backend/callModel.js
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

function extractTextFromGroqResponse(json) {
  return json?.choices?.[0]?.message?.content?.trim() || "";
}

function getProvider() {
  const raw = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (raw) return raw;
  if (process.env.BEDROCK_MODEL_ID) return "bedrock";
  return "groq";
}

function hasGroqConfig() {
  return Boolean(String(process.env.GROQ_API_KEY || "").trim());
}

function hasBedrockConfig() {
  const region = String(process.env.AWS_REGION || process.env.BEDROCK_REGION || "").trim();
  const modelId = String(process.env.BEDROCK_MODEL_ID || "").trim();
  return Boolean(region && modelId);
}

function getCommonOpts(opts = {}) {
  return {
    systemPrompt: opts.systemPrompt || "You are a concise programming tutor. When asked for JSON, return valid JSON only.",
    model: opts.model || process.env.AI_MODEL || process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    temperature: opts.temperature ?? 0.2,
    maxTokens: opts.maxTokens ?? 900,
    timeoutMs: Number(opts.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? process.env.GROQ_TIMEOUT_MS ?? 30000)
  };
}

async function callGroq(prompt, opts = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in backend/.env");
  }

  const { model, temperature, maxTokens, timeoutMs, systemPrompt } = getCommonOpts(opts);

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
    const text = extractTextFromGroqResponse(data);
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

async function callBedrock(prompt, opts = {}) {
  let BedrockRuntimeClient;
  let ConverseCommand;

  try {
    ({ BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime"));
  } catch {
    throw new Error("AWS Bedrock SDK missing. Run: npm i @aws-sdk/client-bedrock-runtime in backend");
  }

  const region = process.env.AWS_REGION || process.env.BEDROCK_REGION;
  const modelId = opts.model || process.env.BEDROCK_MODEL_ID;
  if (!region) throw new Error("AWS_REGION (or BEDROCK_REGION) is required for Bedrock");
  if (!modelId) throw new Error("BEDROCK_MODEL_ID is required for Bedrock");

  const { temperature, maxTokens, timeoutMs, systemPrompt } = getCommonOpts(opts);

  const client = new BedrockRuntimeClient({
    region,
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {})
          }
        }
      : {})
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const command = new ConverseCommand({
      modelId,
      system: [{ text: systemPrompt }],
      messages: [
        {
          role: "user",
          content: [{ text: prompt }]
        }
      ],
      inferenceConfig: {
        maxTokens,
        temperature
      }
    });

    const resp = await client.send(command, { abortSignal: controller.signal });
    const blocks = resp?.output?.message?.content || [];
    const text = blocks
      .map((x) => x?.text || "")
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("Bedrock returned an empty completion");
    }

    return text;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Bedrock request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(prompt, opts = {}) {
  const provider = getProvider();
  if (provider === "auto") {
    const preferred = String(process.env.AI_PRIMARY_PROVIDER || "").trim().toLowerCase();
    const order = [];
    if (preferred === "groq" || preferred === "bedrock") order.push(preferred);
    if (hasBedrockConfig() && !order.includes("bedrock")) order.push("bedrock");
    if (hasGroqConfig() && !order.includes("groq")) order.push("groq");
    if (!order.length) {
      throw new Error("No AI provider configured. Set Bedrock vars or GROQ_API_KEY.");
    }

    let lastErr = null;
    for (const p of order) {
      try {
        return p === "bedrock" ? await callBedrock(prompt, opts) : await callGroq(prompt, opts);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("All configured AI providers failed");
  }

  if (provider === "bedrock" || provider === "aws" || provider === "aws_bedrock") {
    return callBedrock(prompt, opts);
  }
  return callGroq(prompt, opts);
}

module.exports = { callModel };
