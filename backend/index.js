// backend/index.js
const path = require("path");
const crypto = require("crypto");
const util = require("util");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const { DescribeTableCommand } = require("@aws-sdk/client-dynamodb");

// Load shared local env (codecoach/.env) first, then backend/.env as override.
dotenv.config({ path: path.join(__dirname, "..", "codecoach", ".env") });
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const { GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { callModel } = require("./callModel");
const { AIService } = require("./aiService");
const {
  initDynamo,
  ensureTablesIfNeeded,
  ddbDocClient,
  putUser,
  updateUser,
  putAnalyticsAttempt
} = require("./libs/dynamo");
const { initRedis, redis: getRedis } = require("./libs/redisClient");
const pbkdf2 = util.promisify(crypto.pbkdf2);

const PORT = process.env.PORT || 4000;
const IS_PROD = process.env.NODE_ENV === "production";
// Auth secret is process-critical in production; fail fast if it is missing or weak.
const configuredAuthSecret = String(process.env.AUTH_SECRET || "");
if (process.env.NODE_ENV === "production" && (!configuredAuthSecret || configuredAuthSecret.length < 32)) {
  console.error("FATAL: AUTH_SECRET must be set in environment and be at least 32 characters (production).");
  process.exit(1);
}
const AUTH_SECRET = configuredAuthSecret.length >= 32 ? configuredAuthSecret : crypto.randomBytes(32).toString("hex");
const TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS || 1000 * 60 * 60 * 24);
const ENFORCE_HTTPS = String(process.env.ENFORCE_HTTPS || "").toLowerCase() === "true";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const allowedOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!allowedOrigins.length) {
      if (!IS_PROD) return cb(null, true);
      return cb(new Error("CORS blocked: origin not allowed"));
    }
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked: origin not allowed"));
  }
}));
app.use(bodyParser.json({ limit: "800kb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; font-src 'self' data:"
  );
  next();
});

if (IS_PROD && ENFORCE_HTTPS) {
  app.use((req, res, next) => {
    const proto = req.headers["x-forwarded-proto"];
    const isHttps = req.secure || proto === "https";
    if (isHttps) return next();
    return sendError(res, 400, "HTTPS_REQUIRED", "Use HTTPS in production");
  });
}

const AI_PROVIDER = String(process.env.AI_PROVIDER || (process.env.BEDROCK_MODEL_ID ? "bedrock" : "groq")).toLowerCase();
const BEDROCK_SELECTED = AI_PROVIDER === "bedrock" || AI_PROVIDER === "aws" || AI_PROVIDER === "aws_bedrock" || AI_PROVIDER === "auto";
const GROQ_SELECTED = AI_PROVIDER === "groq" || AI_PROVIDER === "auto";
if (GROQ_SELECTED && !process.env.GROQ_API_KEY) {
  console.warn("Warning: GROQ_API_KEY is not set. AI calls may fail for Groq provider.");
}
if (BEDROCK_SELECTED
  && (!(process.env.AWS_REGION || process.env.BEDROCK_REGION) || !process.env.BEDROCK_MODEL_ID)) {
  console.warn("Warning: Bedrock requires AWS_REGION (or BEDROCK_REGION) and BEDROCK_MODEL_ID.");
}

function getDocClient() {
  const client = ddbDocClient();
  if (!client) {
    throw new Error("DynamoDB client is not initialized");
  }
  return client;
}

async function getUserByEmail(email) {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: "Users",
      IndexName: "email-index",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email
      }
    })
  );

  return result.Items?.[0] || null;
}

async function getUserById(userId) {
  const out = await getDocClient().send(new GetCommand({
    TableName: "Users",
    Key: { userId }
  }));
  return out?.Item || null;
}

function userIdOf(user) {
  return user?.userId || user?.id;
}

async function getAnalyticsRecordsForUser(userId) {
  try {
    const out = await getDocClient().send(new QueryCommand({
      TableName: "Analytics",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": userId },
      ScanIndexForward: false,
      Limit: 300
    }));
    return Array.isArray(out?.Items) ? out.Items : [];
  } catch {
    return [];
  }
}

function buildAnalyticsFromDynamo(user, analyticsItems = []) {
  const attempts = [];
  const proctorEvents = [];

  for (const item of analyticsItems) {
    if (item?.type === "quiz_attempt" && item?.data) {
      attempts.push(item.data);
    } else if (item?.type === "proctor_event" && item?.data) {
      proctorEvents.push(item.data);
    }
  }

  const summary = user?.analyticsSummary || {};
  return {
    attempts,
    questionsAsked: Number(summary.questionsAsked || 0),
    proctorEvents,
    badges: Array.isArray(summary.badges) ? summary.badges : []
  };
}

async function getUserAnalytics(userId) {
  const [user, items] = await Promise.all([
    getUserById(userId),
    getAnalyticsRecordsForUser(userId)
  ]);
  if (!user) return null;
  return buildAnalyticsFromDynamo(user, items);
}

function sanitizeUser(user) {
  const analyticsSummary = user.analyticsSummary || user.analytics || {};
  return {
    id: userIdOf(user),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    profile: user.profile || {},
    analyticsMeta: {
      attemptsCount: Number(analyticsSummary.attemptsCount || 0),
      questionsAsked: Number(analyticsSummary.questionsAsked || 0),
      badges: Array.isArray(analyticsSummary.badges) ? analyticsSummary.badges : []
    }
  };
}

function sendError(res, status, code, message, detail = null) {
  return res.status(status).json({
    ok: false,
    code,
    message,
    detail
  });
}

function parseJsonStrict(text) {
  return JSON.parse(text);
}

function tryExtractJson(text) {
  if (!text) return null;

  try {
    return parseJsonStrict(text);
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return parseJsonStrict(fenced[1]);
    } catch {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const maybeJson = text.slice(firstBrace, lastBrace + 1);
    try {
      return parseJsonStrict(maybeJson);
    } catch {}
  }

  return null;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sanitizeText(value, maxLen, fieldName) {
  const out = String(value ?? "");
  if (out.length > maxLen) {
    const err = new Error(`${fieldName} exceeds ${maxLen} characters`);
    err.code = "FIELD_TOO_LONG";
    throw err;
  }
  return out;
}

function validateHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-8).map((h) => ({
    role: String(h?.role || "user").slice(0, 20),
    content: sanitizeText(h?.content || "", 1200, "history.content")
  }));
}

function normalizeAiProvider(raw) {
  const value = String(raw || "groq").trim().toLowerCase();
  if (value === "gemma" || value === "bedrock" || value === "aws" || value === "aws_bedrock") return "gemma";
  if (value === "auto") return "auto";
  return "groq";
}

function normalizeReviewType(raw) {
  const value = String(raw || "quick").trim().toLowerCase();
  return value === "detailed" ? "detailed" : "quick";
}

function createRateLimiter({ windowMs, max, keyPrefix }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
      return sendError(res, 429, "RATE_LIMITED", "Too many requests. Please retry later.");
    }

    bucket.count += 1;
    return next();
  };
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  const hash = await bcrypt.hash(password, salt);
  return { hash, salt };
}

async function verifyPassword(password, user) {
  if (!user) return { ok: false, legacy: false };
  if (user.passwordHash && String(user.passwordHash).startsWith("$2")) {
    const ok = await bcrypt.compare(password, user.passwordHash);
    return { ok, legacy: false };
  }
  if (user.passwordHash && user.passwordSalt) {
    const derived = await pbkdf2(password, user.passwordSalt, 100000, 64, "sha512");
    const hex = derived.toString("hex");
    return { ok: safeEqual(hex, user.passwordHash), legacy: true };
  }
  return { ok: false, legacy: false };
}

function safeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function createToken(payload) {
  const raw = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(raw).digest("base64url");
  return `${raw}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [raw, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(raw).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(raw));
    if (!payload?.uid || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) {
    return sendError(res, 401, "UNAUTHORIZED", "Valid authentication token required");
  }
  req.auth = payload;
  req.token = token;
  next();
}

const authLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 40, keyPrefix: "auth" });
const aiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 24, keyPrefix: "ai" });
const runLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: "run" });
const voiceLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 18, keyPrefix: "voice" });
const aiService = new AIService(process.env);

function computeBadges(analytics) {
  const attempts = analytics?.attempts || [];
  const questionsAsked = analytics?.questionsAsked || 0;

  const badges = [];
  if (attempts.length >= 1) badges.push("first-quiz-complete");
  if (attempts.length >= 5) badges.push("consistency-starter");
  if (attempts.filter((a) => (a.score || 0) >= 80).length >= 3) badges.push("high-scorer");
  if (questionsAsked >= 5) badges.push("curious-learner");

  return badges;
}

function summarizeAnalytics(analytics) {
  const attempts = analytics?.attempts || [];
  const questionsAsked = analytics?.questionsAsked || 0;
  const proctorEvents = analytics?.proctorEvents || [];

  const totalAttempts = attempts.length;
  const avgScore = totalAttempts
    ? Math.round((attempts.reduce((acc, a) => acc + Number(a.score || 0), 0) / totalAttempts) * 100) / 100
    : 0;

  const recentAttempts = [...attempts].slice(-10);
  const scoreTrend = recentAttempts.map((a) => ({ at: a.createdAt, score: a.score || 0 }));

  const weaknessMap = {};
  for (const attempt of attempts) {
    const areas = attempt.weakAreas || [];
    for (const area of areas) {
      weaknessMap[area] = (weaknessMap[area] || 0) + 1;
    }
  }
  const weakTopics = Object.entries(weaknessMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));

  const badges = computeBadges(analytics);

  return {
    totalAttempts,
    avgScore,
    questionsAsked,
    proctorFlags: proctorEvents.length,
    scoreTrend,
    weakTopics,
    badges,
    recentAttempts
  };
}

function buildExplainPrompt({ code, codeLanguage = "javascript", outputLanguage = "English" }) {
  return `
You are a concise programming tutor. Analyze the following ${codeLanguage} code.
Explain everything in ${outputLanguage} for students learning to code.
Return ONLY valid JSON with the following fields:
- summary: one short paragraph description in ${outputLanguage}
- responsibilities: array of short responsibilities (strings)
- edge_cases: array of strings listing possible edge cases
- suggested_unit_test: a one-line unit test snippet
- used_lines: array of "start-end" strings like ["1-3"]
- flashcards: array of { "q": short title, "a": one-line key takeaway sentence (max 18 words) } in ${outputLanguage}
- key_points: array of 5-8 one-line key takeaway sentences in ${outputLanguage}
- transcript: a single-paragraph explanation suitable to be read aloud in ${outputLanguage}
- confidence: "low" | "medium" | "high"

Code:
\`\`\`
${code}
\`\`\`

Return only JSON.
`.trim();
}

function buildStructuredReviewPrompt({ code, codeLanguage = "javascript", outputLanguage = "English", reviewType = "quick" }) {
  const mode = normalizeReviewType(reviewType);
  const isDetailed = mode === "detailed";
  return `
You are a senior code reviewer.
Review the following ${codeLanguage} code in ${outputLanguage}.
Review depth: ${isDetailed ? "detailed architecture + maintainability review" : "quick review for fast feedback"}.
Return ONLY valid JSON with this shape:
{
  "summary": "short review summary",
  "responsibilities": ["..."],
  "edge_cases": ["..."],
  "suggested_unit_test": "one short test snippet",
  "used_lines": ["1-2", "3-5"],
  "flashcards": [{"q":"...", "a":"..."}],
  "key_points": ["..."],
  "transcript": "single paragraph spoken-style explanation",
  "confidence": "low|medium|high"
}

Rules:
- Keep summary ${isDetailed ? "4-7 sentences" : "2-4 sentences"}.
- Include ${isDetailed ? "6-10" : "3-6"} key_points.
- Use concise beginner-friendly language.
- used_lines should reference important lines from the code.
- Return valid JSON only. No markdown.

Code:
\`\`\`
${code}
\`\`\`
`.trim();
}

function buildExercisePrompt({ topic, difficulty, count, outputLanguage = "English" }) {
  return `
You are a programming instructor creating practice exercises.
Generate ${count} coding exercises in ${outputLanguage}.
Topic: ${topic || "programming fundamentals"}.
Difficulty: ${difficulty}.

Return ONLY valid JSON with this exact shape:
{
  "title": "string",
  "exercises": [
    {
      "id": "ex-1",
      "title": "string",
      "difficulty": "easy|medium|hard",
      "prompt": "exercise prompt",
      "starterCode": "optional starter code",
      "hints": ["hint 1", "hint 2"],
      "testCases": ["test case 1", "test case 2"]
    }
  ]
}

Rules:
- Keep each exercise practical and beginner-friendly.
- Provide at least 2 hints per exercise.
- Provide at least 2 testCases per exercise.
- Return valid JSON only. No markdown.
`.trim();
}

function buildGradePrompt({ question, reference = "", answer }) {
  return `
You are an expert programming tutor and grader. Compare the student's answer to the reference answer.
Return ONLY valid JSON with these fields:
- score: integer 0-100 (how correct)
- feedback: short paragraph explaining what is missing/wrong and how to improve
- corrected_answer: concise corrected answer (1-2 sentences)
- keywords_matched: array of important keywords found in student's answer

Question: ${question}
Reference: ${reference}
Student answer: ${answer}

Only return valid JSON.
`.trim();
}

function buildQuizPrompt({ topic, questionType, difficulty, count, outputLanguage, contextCode }) {
  return `
You are creating a coding-learning quiz in ${outputLanguage}.
Create ${count} questions about: ${topic || "programming fundamentals"}.
Question type requirement: ${questionType}.
Difficulty requirement: ${difficulty}.
If context code is provided, include questions tied to that code.

Context code (optional):
\`\`\`
${contextCode || ""}
\`\`\`

Return ONLY valid JSON in this shape:
{
  "title": "...",
  "description": "...",
  "questions": [
    {
      "id": "q1",
      "type": "mcq",
      "level": "easy",
      "q": "...",
      "options": ["...", "...", "...", "..."],
      "correctIndex": 0,
      "points": 1
    },
    {
      "id": "q2",
      "type": "text",
      "level": "medium",
      "q": "...",
      "keywords": ["...", "..."],
      "points": 2
    },
    {
      "id": "q3",
      "type": "code",
      "level": "hard",
      "q": "...",
      "starterCode": "// optional starter code",
      "expectedKeyPoints": ["...", "..."],
      "points": 3
    }
  ]
}

Rules:
- Allowed type values: mcq, text, code.
- Allowed level values: easy, medium, hard.
- Each question must have one level.
- Keep question text concise and student-friendly.
- For MCQ include exactly 4 options and one correctIndex.
- For code questions, include starterCode when useful.
- Do not include markdown or extra text.
`.trim();
}

function buildAskPrompt({ question, code, outputLanguage, history }) {
  return `
You are an interactive coding mentor for students.
Respond in ${outputLanguage}.
Answer the student's question clearly and briefly.
If relevant, reference the code context.
If the answer contains code, format it in proper fenced code blocks using triple backticks and correct indentation.
Keep explanation and code structure readable for beginners.
Return ONLY valid JSON:
{
  "answer": "short clear explanation",
  "followups": ["optional next question 1", "optional next question 2"]
}

Recent chat history:
${history.map((h) => `${h.role}: ${h.content}`).join("\n")}

Code context:
\`\`\`
${code || ""}
\`\`\`

Student question:
${question}
`.trim();
}

function buildStudyPlanPrompt({ outputLanguage, analytics }) {
  return `
Create a 7-day coding study plan in ${outputLanguage} for a student.
Use analytics below:
${JSON.stringify(analytics)}

Return ONLY valid JSON with shape:
{
  "title": "...",
  "daily_plan": [
    {"day": 1, "focus": "...", "task": "...", "practice_minutes": 45},
    {"day": 2, "focus": "...", "task": "...", "practice_minutes": 45}
  ],
  "tips": ["...", "..."]
}
`.trim();
}

function mapLangToPollyVoice(lang = "en") {
  const key = String(lang).slice(0, 2).toLowerCase();
  if (key === "hi") return { languageCode: "hi-IN", voiceId: "Aditi" };
  if (key === "es") return { languageCode: "es-ES", voiceId: "Lucia" };
  if (key === "fr") return { languageCode: "fr-FR", voiceId: "Lea" };
  if (key === "de") return { languageCode: "de-DE", voiceId: "Vicki" };
  if (key === "ta") return { languageCode: "en-IN", voiceId: "Aditi" };
  if (key === "te") return { languageCode: "en-IN", voiceId: "Aditi" };
  return { languageCode: "en-US", voiceId: "Joanna" };
}

const LEVEL_POINTS = { easy: 1, medium: 2, hard: 3 };

function normalizeLevel(value) {
  const v = String(value || "").toLowerCase();
  if (v === "easy" || v === "medium" || v === "hard") return v;
  return "medium";
}

function normalizeQuestion(raw, idx) {
  const type = ["mcq", "text", "code"].includes(raw?.type) ? raw.type : "text";
  const level = normalizeLevel(raw?.level);
  const base = {
    id: raw?.id || `q${idx + 1}`,
    type,
    level,
    q: String(raw?.q || `Question ${idx + 1}`),
    points: clampNumber(raw?.points, 1, 10, LEVEL_POINTS[level])
  };

  if (type === "mcq") {
    const options = Array.isArray(raw?.options)
      ? raw.options.map((x) => String(x || "")).filter(Boolean).slice(0, 4)
      : [];

    while (options.length < 4) {
      options.push(`Option ${options.length + 1}`);
    }

    const correctIndex = clampNumber(raw?.correctIndex, 0, 3, 0);
    return { ...base, options, correctIndex };
  }

  if (type === "code") {
    const expectedKeyPoints = Array.isArray(raw?.expectedKeyPoints)
      ? raw.expectedKeyPoints.map((x) => String(x || "")).filter(Boolean)
      : [];

    return {
      ...base,
      starterCode: String(raw?.starterCode || ""),
      expectedKeyPoints
    };
  }

  const keywords = Array.isArray(raw?.keywords)
    ? raw.keywords.map((x) => String(x || "")).filter(Boolean)
    : [];

  return { ...base, keywords };
}

function normalizeQuiz(parsed, fallbackCount = 5) {
  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions = rawQuestions.slice(0, fallbackCount).map((q, idx) => normalizeQuestion(q, idx));
  if (!questions.length) {
    throw new Error("AI response did not contain questions");
  }

  return {
    title: String(parsed?.title || "AI Generated Quiz"),
    description: String(parsed?.description || "Practice quiz generated by AI"),
    questions
  };
}

function decodeLooseJsonString(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\")
    .trim();
}

function extractStringField(blob, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "s");
  const match = String(blob || "").match(pattern);
  if (!match?.[1]) return "";
  return decodeLooseJsonString(match[1]);
}

function extractStringArrayField(blob, key, limit = 8) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "s");
  const match = String(blob || "").match(pattern);
  if (!match?.[1]) return [];
  const values = [];
  const rx = /"((?:\\.|[^"\\])*)"/g;
  let item = null;
  while ((item = rx.exec(match[1])) !== null) {
    values.push(decodeLooseJsonString(item[1]));
    if (values.length >= limit) break;
  }
  return values.filter(Boolean);
}

function extractEmbeddedReview(blob) {
  const source = String(blob || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  if (!source || (!source.includes("\"summary\"") && !source.includes("\"responsibilities\""))) {
    return null;
  }

  const summary = extractStringField(source, "summary");
  const transcript = extractStringField(source, "transcript");
  const suggestedUnitTest = extractStringField(source, "suggested_unit_test");
  const confidenceRaw = extractStringField(source, "confidence").toLowerCase();
  const confidence = ["low", "medium", "high"].includes(confidenceRaw) ? confidenceRaw : "medium";

  const responsibilities = extractStringArrayField(source, "responsibilities", 8);
  const edgeCases = extractStringArrayField(source, "edge_cases", 8);
  const usedLines = extractStringArrayField(source, "used_lines", 8);
  const keyPoints = extractStringArrayField(source, "key_points", 10);

  if (!summary && !responsibilities.length && !edgeCases.length && !keyPoints.length) {
    return null;
  }

  return {
    summary,
    transcript,
    responsibilities,
    edge_cases: edgeCases,
    suggested_unit_test: suggestedUnitTest,
    used_lines: usedLines,
    key_points: keyPoints,
    confidence
  };
}

function normalizeReviewPayload(raw, fallbackText = "") {
  let src = raw && typeof raw === "object" ? raw : {};
  const fallbackEmbedded = extractEmbeddedReview(fallbackText);
  if (fallbackEmbedded) {
    src = { ...fallbackEmbedded, ...src };
  }

  if (typeof src.summary === "string" && src.summary.includes("\"summary\"")) {
    const nested = extractEmbeddedReview(src.summary);
    if (nested) {
      src = { ...src, ...nested };
    }
  }

  const summary = String(src.summary || fallbackText || "").trim();
  const transcript = String(src.transcript || summary || fallbackText || "").trim();
  const responsibilities = Array.isArray(src.responsibilities)
    ? src.responsibilities.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const edgeCases = Array.isArray(src.edge_cases)
    ? src.edge_cases.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const keyPoints = Array.isArray(src.key_points)
    ? src.key_points.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 10)
    : [];
  const usedLines = Array.isArray(src.used_lines)
    ? src.used_lines.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const flashcards = Array.isArray(src.flashcards)
    ? src.flashcards
      .map((c) => ({ q: String(c?.q || "").trim(), a: String(c?.a || "").trim() }))
      .filter((c) => c.q || c.a)
      .slice(0, 8)
    : [];

  const confidenceRaw = String(src.confidence || "").toLowerCase();
  const confidence = ["low", "medium", "high"].includes(confidenceRaw) ? confidenceRaw : "medium";

  return {
    summary: summary || "Review generated.",
    transcript: transcript || summary || "Review generated.",
    responsibilities,
    edge_cases: edgeCases,
    suggested_unit_test: String(src.suggested_unit_test || "").trim(),
    used_lines: usedLines,
    flashcards,
    key_points: keyPoints,
    confidence
  };
}
app.get("/", (_req, res) => res.send("CodeCoach backend running"));
app.get("/api/health", async (_req, res) => {
  try {
    const provider = AI_PROVIDER;
    const model = provider === "bedrock" || provider === "aws" || provider === "aws_bedrock"
      ? (process.env.BEDROCK_MODEL_ID || process.env.AI_MODEL || "bedrock-model")
      : provider === "auto"
        ? (process.env.BEDROCK_MODEL_ID || process.env.GROQ_MODEL || process.env.AI_MODEL || "auto")
        : (process.env.GROQ_MODEL || process.env.AI_MODEL || "llama-3.1-8b-instant");

    let dynamoOk = true;
    try {
      const { ddb } = initDynamo({ region: process.env.AWS_REGION });
      await ddb.send(new DescribeTableCommand({ TableName: "Users" }));
    } catch {
      dynamoOk = false;
    }

    const r = initRedis();
    let redisOk = false;
    if (r) {
      try {
        const pong = await r.ping();
        redisOk = pong === "PONG" || Boolean(pong);
      } catch {
        redisOk = false;
      }
    }

    const ok = dynamoOk && (IS_PROD ? redisOk : true);
    return res.status(ok ? 200 : 503).json({
      ok,
      provider,
      model,
      dynamo: dynamoOk,
      redis: Boolean(redisOk),
      authReady: Boolean(process.env.AUTH_SECRET)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/api/status", (_req, res) => {
  try {
    return res.json({
      ok: true,
      providers: aiService.getStatus()
    });
  } catch (err) {
    return sendError(res, 500, "SERVER_ERROR", "Failed to get provider status", String(err.message || err));
  }
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const name = sanitizeText(req.body?.name || "", 80, "name").trim();
    const email = sanitizeText(req.body?.email || "", 160, "email").trim().toLowerCase();
    const password = sanitizeText(req.body?.password || "", 128, "password");

    if (!name || !email || !password) {
      return sendError(res, 400, "BAD_REQUEST", "name, email, and password are required");
    }
    if (password.length < 6) {
      return sendError(res, 400, "BAD_REQUEST", "Password must be at least 6 characters");
    }

    const existing = await getUserByEmail(email);
    if (existing) throw new Error("EMAIL_EXISTS");

    const { hash, salt } = await hashPassword(password);
    const user = {
      userId: crypto.randomUUID(),
      email,
      name,
      createdAt: new Date().toISOString(),
      passwordHash: hash,
      passwordSalt: salt,
      profile: { preferredLanguage: "English", goals: [] },
      analyticsSummary: { questionsAsked: 0, badges: [], attemptsCount: 0 }
    };

    await putUser(user);
    const token = createToken({ uid: user.userId, exp: Date.now() + TOKEN_TTL_MS });
    return res.json({ ok: true, token, user: sanitizeUser(user) });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    if (String(err.message || err) === "EMAIL_EXISTS") {
      return sendError(res, 409, "EMAIL_EXISTS", "An account with this email already exists");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to register", String(err.message || err));
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const email = sanitizeText(req.body?.email || "", 160, "email").trim().toLowerCase();
    const password = sanitizeText(req.body?.password || "", 128, "password");

    if (!email || !password) {
      return sendError(res, 400, "BAD_REQUEST", "email and password are required");
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    if (!user.passwordHash) {
      return sendError(res, 401, "GOOGLE_SIGNIN_REQUIRED", "This account uses Google Sign-In");
    }

    const verified = await verifyPassword(password, user);
    if (!verified.ok) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    if (verified.legacy) {
      const upgraded = await hashPassword(password);
      await updateUser(
        { userId: user.userId },
        "SET passwordHash = :hash, passwordSalt = :salt",
        { ":hash": upgraded.hash, ":salt": upgraded.salt }
      );
      user.passwordHash = upgraded.hash;
      user.passwordSalt = upgraded.salt;
    }

    const token = createToken({ uid: userIdOf(user), exp: Date.now() + TOKEN_TTL_MS });
    return res.json({ ok: true, token, user: sanitizeUser(user) });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to login", String(err.message || err));
  }
});

app.post("/api/auth/google", authLimiter, async (req, res) => {
  try {
    const idToken = sanitizeText(req.body?.idToken || "", 4000, "idToken");
    if (!idToken) {
      return sendError(res, 400, "BAD_REQUEST", "idToken is required");
    }

    const verifyResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!verifyResp.ok) {
      return sendError(res, 401, "INVALID_GOOGLE_TOKEN", "Google token verification failed");
    }

    const profile = await verifyResp.json();
    const email = sanitizeText(profile?.email || "", 160, "email").trim().toLowerCase();
    const name = sanitizeText(profile?.name || "Google User", 80, "name").trim();
    const googleSub = sanitizeText(profile?.sub || "", 80, "sub");
    const aud = sanitizeText(profile?.aud || "", 200, "aud");
    if (!email || !googleSub) {
      return sendError(res, 401, "INVALID_GOOGLE_TOKEN", "Google token missing required fields");
    }

    const expectedAud = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    if (expectedAud && aud !== expectedAud) {
      return sendError(res, 401, "INVALID_GOOGLE_TOKEN", "Google token audience mismatch");
    }

    let resolvedUser = await getUserByEmail(email);
    if (!resolvedUser) {
      resolvedUser = {
        userId: crypto.randomUUID(),
        name,
        email,
        authProvider: "google",
        providerUserId: googleSub,
        createdAt: new Date().toISOString(),
        profile: { preferredLanguage: "English", goals: [] },
        analyticsSummary: { questionsAsked: 0, badges: [], attemptsCount: 0 }
      };
      await putUser(resolvedUser);
    } else {
      const updateExpr = "SET authProvider = :provider, providerUserId = :pid, #name = if_not_exists(#name, :name)";
      await updateUser(
        { userId: resolvedUser.userId },
        updateExpr,
        { ":provider": "google", ":pid": googleSub, ":name": name },
        { "#name": "name" }
      );
      resolvedUser = { ...resolvedUser, authProvider: "google", providerUserId: googleSub, name: resolvedUser.name || name };
    }

    const token = createToken({ uid: userIdOf(resolvedUser), exp: Date.now() + TOKEN_TTL_MS });
    return res.json({ ok: true, token, user: sanitizeUser(resolvedUser) });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed Google sign-in", String(err.message || err));
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const user = await getUserById(req.auth.uid);
  if (!user) {
    return sendError(res, 404, "USER_NOT_FOUND", "User not found");
  }
  return res.json({ ok: true, user: sanitizeUser(user) });
});

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const { name, preferredLanguage, goals } = req.body || {};
    const existingUser = await getUserById(req.auth.uid);
    if (!existingUser) throw new Error("USER_NOT_FOUND");

    const setExpr = [];
    const values = {};
    const names = {};
    let profileChanged = false;
    const nextProfile = { ...(existingUser.profile || {}) };

    if (typeof name === "string" && name.trim()) {
      names["#name"] = "name";
      values[":name"] = sanitizeText(name, 80, "name").trim();
      setExpr.push("#name = :name");
    }

    if (typeof preferredLanguage === "string" && preferredLanguage.trim()) {
      nextProfile.preferredLanguage = sanitizeText(preferredLanguage, 40, "preferredLanguage").trim();
      profileChanged = true;
    }

    if (Array.isArray(goals)) {
      nextProfile.goals = goals.map((g) => sanitizeText(g || "", 120, "goal").trim()).filter(Boolean).slice(0, 8);
      profileChanged = true;
    }

    if (profileChanged) {
      names["#profile"] = "profile";
      values[":profile"] = nextProfile;
      setExpr.push("#profile = :profile");
    }

    if (setExpr.length) {
      await updateUser(
        { userId: req.auth.uid },
        `SET ${setExpr.join(", ")}`,
        values,
        Object.keys(names).length ? names : undefined
      );
    }

    const updatedUser = await getUserById(req.auth.uid);
    return res.json({ ok: true, user: sanitizeUser(updatedUser) });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    if (String(err.message || err) === "USER_NOT_FOUND") {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to update profile", String(err.message || err));
  }
});

app.post("/api/profile/sync", authMiddleware, async (req, res) => {
  try {
    const { theme, selectedLanguage, lastOpenedAt } = req.body || {};
    const existingUser = await getUserById(req.auth.uid);
    if (!existingUser) throw new Error("USER_NOT_FOUND");

    const existingPrefs = existingUser.profile?.preferences || {};
    const nextPrefs = {
      ...existingPrefs,
      ...(theme ? { theme: sanitizeText(theme, 20, "theme") } : {}),
      ...(selectedLanguage ? { selectedLanguage: sanitizeText(selectedLanguage, 40, "selectedLanguage") } : {}),
      ...(lastOpenedAt ? { lastOpenedAt: sanitizeText(lastOpenedAt, 60, "lastOpenedAt") } : {})
    };
    const nextProfile = {
      ...(existingUser.profile || {}),
      preferences: nextPrefs
    };

    await updateUser(
      { userId: req.auth.uid },
      "SET #profile = :profile",
      { ":profile": nextProfile },
      { "#profile": "profile" }
    );

    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    if (String(err.message || err) === "USER_NOT_FOUND") {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to sync profile", String(err.message || err));
  }
});

app.get("/api/analytics/dashboard", authMiddleware, async (req, res) => {
  const user = await getUserById(req.auth.uid);
  if (!user) {
    return sendError(res, 404, "USER_NOT_FOUND", "User not found");
  }

  const analyticsData = await getUserAnalytics(req.auth.uid);
  const analytics = summarizeAnalytics(analyticsData || user.analyticsSummary || {});
  return res.json({ ok: true, analytics });
});

app.post("/api/analytics/attempt", authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};
    const user = await getUserById(req.auth.uid);
    if (!user) throw new Error("USER_NOT_FOUND");

    const attempt = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      quizTitle: sanitizeText(payload.quizTitle || "Quiz", 140, "quizTitle"),
      score: clampNumber(payload.score, 0, 100, 0),
      totalQuestions: clampNumber(payload.totalQuestions, 1, 100, 1),
      durationSec: clampNumber(payload.durationSec, 0, 14400, 0),
      weakAreas: Array.isArray(payload.weakAreas)
        ? payload.weakAreas.map((x) => sanitizeText(x || "", 80, "weakArea")).filter(Boolean).slice(0, 8)
        : [],
      proctorSummary: payload.proctorSummary || null
    };

    await putAnalyticsAttempt({
      userId: req.auth.uid,
      createdAt: attempt.createdAt,
      type: "quiz_attempt",
      data: attempt
    });

    const records = await getAnalyticsRecordsForUser(req.auth.uid);
    const attempts = records
      .filter((x) => x?.type === "quiz_attempt" && x?.data)
      .map((x) => x.data);
    const questionsAsked = Number(user.analyticsSummary?.questionsAsked || 0);
    const badges = computeBadges({ attempts, questionsAsked });
    const nextSummary = {
      attemptsCount: attempts.length,
      questionsAsked,
      badges
    };

    await updateUser(
      { userId: req.auth.uid },
      "SET analyticsSummary = :summary",
      { ":summary": nextSummary }
    );

    const proctorEvents = records
      .filter((x) => x?.type === "proctor_event" && x?.data)
      .map((x) => x.data);

    return res.json({
      ok: true,
      analytics: summarizeAnalytics({ attempts, questionsAsked, proctorEvents, badges })
    });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    if (String(err.message || err) === "USER_NOT_FOUND") {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to record attempt", String(err.message || err));
  }
});

app.post("/api/proctor/event", authMiddleware, async (req, res) => {
  try {
    const { type, detail } = req.body || {};
    if (!type) {
      return sendError(res, 400, "BAD_REQUEST", "type is required");
    }

    const user = await getUserById(req.auth.uid);
    if (!user) throw new Error("USER_NOT_FOUND");

    const eventData = {
      at: new Date().toISOString(),
      type: sanitizeText(type, 80, "type"),
      detail: sanitizeText(detail || "", 300, "detail")
    };
    await putAnalyticsAttempt({
      userId: req.auth.uid,
      createdAt: eventData.at,
      type: "proctor_event",
      data: eventData
    });

    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    if (String(err.message || err) === "USER_NOT_FOUND") {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to log proctor event", String(err.message || err));
  }
});

app.post("/api/review", aiLimiter, async (req, res) => {
  try {
    const code = sanitizeText(req.body?.code || "", 50000, "code");
    const outputLanguage = sanitizeText(req.body?.outputLanguage || "English", 40, "outputLanguage");
    const codeLanguage = sanitizeText(req.body?.codeLanguage || "javascript", 30, "codeLanguage");
    const provider = normalizeAiProvider(req.body?.provider || "groq");
    const reviewType = normalizeReviewType(req.body?.reviewType || "quick");

    if (!code.trim()) {
      return sendError(res, 400, "BAD_REQUEST", "`code` is required");
    }

    const prompt = buildStructuredReviewPrompt({
      code,
      codeLanguage: codeLanguage || "javascript",
      outputLanguage: outputLanguage || "English",
      reviewType
    });

    const ai = await aiService.generateReview({
      prompt,
      provider,
      reviewType,
      timeoutMs: 35000
    });

    const parsed = tryExtractJson(ai.text);
    const base = normalizeReviewPayload(parsed, ai.text);

    return res.json({
      ok: true,
      provider: ai.provider,
      model: ai.model,
      reviewType,
      fallbackFrom: ai.fallbackFrom || null,
      ...base
    });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to generate review", String(err.message || err));
  }
});

app.post("/api/exercise", aiLimiter, async (req, res) => {
  try {
    const topic = sanitizeText(req.body?.topic || "programming fundamentals", 220, "topic").trim();
    const difficultyRaw = sanitizeText(req.body?.difficulty || "medium", 20, "difficulty").toLowerCase();
    const difficulty = ["easy", "medium", "hard", "mixed"].includes(difficultyRaw) ? difficultyRaw : "medium";
    const outputLanguage = sanitizeText(req.body?.outputLanguage || "English", 40, "outputLanguage");
    const count = clampNumber(req.body?.count, 1, 10, 3);

    const prompt = buildExercisePrompt({
      topic,
      difficulty,
      count,
      outputLanguage
    });

    const ai = await aiService.generateExercise({
      prompt,
      timeoutMs: 40000
    });

    const parsed = tryExtractJson(ai.text);
    if (!parsed || !Array.isArray(parsed.exercises)) {
      return sendError(res, 502, "INVALID_AI_OUTPUT", "Exercise generator returned invalid JSON", ai.text.slice(0, 500));
    }

    return res.json({
      ok: true,
      provider: ai.provider,
      model: ai.model,
      title: String(parsed.title || "Coding Exercises"),
      exercises: parsed.exercises.slice(0, count)
    });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to generate exercise", String(err.message || err));
  }
});

app.post("/api/explain", aiLimiter, async (req, res) => {
  try {
    const code = sanitizeText(req.body?.code || "", 50000, "code");
    const outputLanguage = sanitizeText(req.body?.outputLanguage || "English", 40, "outputLanguage");
    const codeLanguage = sanitizeText(req.body?.codeLanguage || "javascript", 30, "codeLanguage");
    if (!code) {
      return sendError(res, 400, "BAD_REQUEST", "`code` is required");
    }

    const prompt = buildExplainPrompt({
      code,
      codeLanguage: codeLanguage || "javascript",
      outputLanguage: outputLanguage || "English"
    });

    const out = await callModel(prompt, {
      maxTokens: 1100,
      temperature: 0.2,
      timeoutMs: 30000
    });

    const parsed = tryExtractJson(out);
    if (parsed) return res.json(parsed);

    return res.json({ summary: out, transcript: out });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    console.error("/api/explain error:", err);
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to generate explanation", String(err.message || err));
  }
});

app.post("/api/grade", aiLimiter, async (req, res) => {
  try {
    const question = sanitizeText(req.body?.question || "", 1200, "question");
    const reference = sanitizeText(req.body?.reference || "", 6000, "reference");
    const answer = sanitizeText(req.body?.answer || "", 8000, "answer");
    if (!question || answer == null) {
      return sendError(res, 400, "BAD_REQUEST", "`question` and `answer` are required");
    }

    const prompt = buildGradePrompt({ question, reference, answer });
    const out = await callModel(prompt, {
      maxTokens: 700,
      temperature: 0.1,
      timeoutMs: 25000
    });

    const parsed = tryExtractJson(out);
    if (!parsed) {
      return res.json({ score: null, feedback: out, corrected_answer: out, keywords_matched: [] });
    }

    const score = typeof parsed.score === "number" ? parsed.score : null;
    parsed.pointsAwarded = score != null ? Math.round((score / 100) * 100) / 100 : null;
    return res.json(parsed);
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    console.error("/api/grade error:", err);
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to grade answer", String(err.message || err));
  }
});

app.post("/api/quiz/generate", aiLimiter, async (req, res) => {
  try {
    const topic = sanitizeText(req.body?.topic || "", 220, "topic").trim();
    const questionType = sanitizeText(req.body?.questionType || "mixed", 20, "questionType").toLowerCase();
    const difficulty = sanitizeText(req.body?.difficulty || "mixed", 20, "difficulty").toLowerCase();
    const outputLanguage = sanitizeText(req.body?.outputLanguage || "English", 40, "outputLanguage");
    const contextCode = sanitizeText(req.body?.contextCode || "", 50000, "contextCode");
    const count = clampNumber(req.body?.count, 1, 15, 5);

    const validType = ["mcq", "text", "code", "mixed"].includes(questionType) ? questionType : "mixed";
    const validDifficulty = ["easy", "medium", "hard", "mixed"].includes(difficulty) ? difficulty : "mixed";

    if (!topic && !contextCode) {
      return sendError(res, 400, "BAD_REQUEST", "Provide at least `topic` or `contextCode` for quiz generation");
    }

    const prompt = buildQuizPrompt({
      topic,
      questionType: validType,
      difficulty: validDifficulty,
      count,
      outputLanguage,
      contextCode
    });

    const out = await callModel(prompt, {
      maxTokens: 1700,
      temperature: 0.35,
      timeoutMs: 35000
    });

    const parsed = tryExtractJson(out);
    if (!parsed) {
      return sendError(res, 502, "INVALID_AI_OUTPUT", "Model response was not valid JSON", out.slice(0, 500));
    }

    const quiz = normalizeQuiz(parsed, count);
    return res.json({ ok: true, quiz });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    console.error("/api/quiz/generate error:", err);
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to generate quiz", String(err.message || err));
  }
});

app.post("/api/ask", aiLimiter, async (req, res) => {
  try {
    const question = sanitizeText(req.body?.question || "", 1200, "question").trim();
    const code = sanitizeText(req.body?.code || "", 50000, "code");
    const outputLanguage = sanitizeText(req.body?.outputLanguage || "English", 40, "outputLanguage");
    const history = validateHistory(req.body?.history);

    if (!question) {
      return sendError(res, 400, "BAD_REQUEST", "question is required");
    }

    const prompt = buildAskPrompt({ question, code, outputLanguage, history });
    const out = await callModel(prompt, {
      maxTokens: 700,
      temperature: 0.3,
      timeoutMs: 30000
    });

    const parsed = tryExtractJson(out);
    const answer = parsed?.answer || out;
    const followups = Array.isArray(parsed?.followups)
      ? parsed.followups.map((x) => String(x || "")).filter(Boolean).slice(0, 3)
      : [];

    if (req.headers.authorization?.startsWith("Bearer ")) {
      const payload = verifyToken(req.headers.authorization.slice(7));
      if (payload?.uid) {
        const user = await getUserById(payload.uid);
        if (user) {
          const summary = user.analyticsSummary || {};
          const questionsAsked = Number(summary.questionsAsked || 0) + 1;
          const attemptsCount = Number(summary.attemptsCount || 0);
          const syntheticAttempts = Array.from({ length: attemptsCount }, () => ({ score: 0 }));
          const badges = computeBadges({ attempts: syntheticAttempts, questionsAsked });

          await updateUser(
            { userId: payload.uid },
            "SET analyticsSummary.questionsAsked = :questionsAsked, analyticsSummary.badges = :badges, analyticsSummary.attemptsCount = if_not_exists(analyticsSummary.attemptsCount, :zero)",
            {
              ":questionsAsked": questionsAsked,
              ":badges": badges,
              ":zero": attemptsCount
            }
          );
        }
      }
    }

    return res.json({ ok: true, answer, followups });
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to answer question", String(err.message || err));
  }
});

app.post("/api/run", runLimiter, async (req, res) => {
  try {
    const language = sanitizeText(req.body?.language || "javascript", 20, "language").toLowerCase();
    const code = sanitizeText(req.body?.code || "", 60000, "code");
    const stdin = sanitizeText(req.body?.stdin || "", 10000, "stdin");
    if (!code.trim()) {
      return sendError(res, 400, "BAD_REQUEST", "code is required");
    }

    const runtimes = {
      javascript: { language: "javascript", version: "18.15.0" },
      typescript: { language: "typescript", version: "5.0.3" },
      python: { language: "python", version: "3.10.0" },
      java: { language: "java", version: "15.0.2" },
      c: { language: "c", version: "10.2.0" },
      cpp: { language: "cpp", version: "10.2.0" },
      go: { language: "go", version: "1.16.2" },
      rust: { language: "rust", version: "1.68.2" }
    };
    const runtime = runtimes[language];
    if (!runtime) {
      return sendError(res, 400, "BAD_REQUEST", "Unsupported language");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let pistonResp;
    try {
      pistonResp = await fetch("https://emkc.org/api/v2/piston/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          language: runtime.language,
          version: runtime.version,
          files: [{ content: code }],
          stdin,
          compile_timeout: 10000,
          run_timeout: 4000
        })
      });
    } finally {
      clearTimeout(timer);
    }

    if (!pistonResp?.ok) {
      const errText = pistonResp ? await pistonResp.text() : "Execution service unavailable";
      return sendError(res, 502, "RUNNER_ERROR", "Execution failed", errText.slice(0, 500));
    }

    const payload = await pistonResp.json();
    const run = payload?.run || {};
    const compile = payload?.compile || {};
    return res.json({
      ok: true,
      language,
      stdout: String(run.stdout || ""),
      stderr: String(run.stderr || ""),
      output: String(run.output || ""),
      code: Number(run.code ?? 0),
      compileOutput: String(compile.output || "")
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      return sendError(res, 504, "RUNNER_TIMEOUT", "Code execution timed out");
    }
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to execute code", String(err.message || err));
  }
});

app.post("/api/voice/synthesize", voiceLimiter, async (req, res) => {
  try {
    const text = sanitizeText(req.body?.text || "", 2800, "text").trim();
    const lang = sanitizeText(req.body?.lang || "en", 10, "lang");
    if (!text) {
      return sendError(res, 400, "BAD_REQUEST", "text is required");
    }

    let PollyClient;
    let SynthesizeSpeechCommand;
    try {
      ({ PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly"));
    } catch {
      return sendError(res, 501, "POLLY_SDK_MISSING", "Install @aws-sdk/client-polly in backend");
    }

    const region = process.env.AWS_REGION || process.env.BEDROCK_REGION;
    if (!region) {
      return sendError(res, 501, "AWS_REGION_REQUIRED", "AWS_REGION is required for Polly");
    }

    const voiceCfg = mapLangToPollyVoice(lang);
    const client = new PollyClient({
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

    const cmd = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: "mp3",
      VoiceId: process.env.AWS_POLLY_VOICE_ID || voiceCfg.voiceId,
      LanguageCode: process.env.AWS_POLLY_LANGUAGE_CODE || voiceCfg.languageCode,
      Engine: process.env.AWS_POLLY_ENGINE || "neural"
    });

    const out = await client.send(cmd);
    if (!out?.AudioStream) {
      return sendError(res, 502, "POLLY_EMPTY_AUDIO", "No audio returned from Polly");
    }

    const bytes = Buffer.from(await out.AudioStream.transformToByteArray());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(bytes);
  } catch (err) {
    if (err?.code === "FIELD_TOO_LONG") {
      return sendError(res, 400, "BAD_REQUEST", err.message);
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed voice synthesis", String(err.message || err));
  }
});

app.post("/api/study-plan", authMiddleware, async (req, res) => {
  try {
    const outputLanguage = String(req.body?.outputLanguage || "English");
    const user = await getUserById(req.auth.uid);
    if (!user) {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }

    const analyticsData = await getUserAnalytics(req.auth.uid);
    const analytics = summarizeAnalytics(analyticsData || user.analyticsSummary || {});
    const prompt = buildStudyPlanPrompt({ outputLanguage, analytics });
    const out = await callModel(prompt, {
      maxTokens: 1000,
      temperature: 0.35,
      timeoutMs: 30000
    });

    const parsed = tryExtractJson(out);
    if (!parsed) {
      return sendError(res, 502, "INVALID_AI_OUTPUT", "Model response was not valid JSON", out.slice(0, 500));
    }

    return res.json({ ok: true, plan: parsed });
  } catch (err) {
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to generate study plan", String(err.message || err));
  }
});

async function startup() {
  try {
    if (!process.env.AWS_REGION) throw new Error("AWS_REGION is required");
    if (IS_PROD && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)) {
      throw new Error("AUTH_SECRET must be set and >= 32 chars in production");
    }

    initDynamo({ region: process.env.AWS_REGION });
    await ensureTablesIfNeeded();

    const r = initRedis();
    if (IS_PROD && !r) throw new Error("REDIS_URL required in production");

    console.log("ENV", process.env.NODE_ENV || "dev", "PORT", PORT);
    app.listen(PORT, (err) => {
      if (err) {
        console.error("Failed to start server on port " + PORT, err.message || err);
        process.exit(1);
      }
      console.log("Server running on port " + PORT);
    });
  } catch (err) {
    console.error("Failed to initialize backend:", err && (err.message || err));
    process.exit(1);
  }
}

startup();
