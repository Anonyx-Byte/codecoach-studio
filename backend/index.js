// backend/index.js
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const { callModel } = require("./callModel");

const PORT = Number(process.env.PORT || 4000);
const AUTH_SECRET = process.env.AUTH_SECRET || "change_this_local_secret";
const DB_PATH = path.join(__dirname, "data", "app-db.json");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "800kb" }));

if (!process.env.GROQ_API_KEY) {
  console.warn("Warning: GROQ_API_KEY is not set. API calls will fail until it is configured in backend/.env.");
}

let dbWriteQueue = Promise.resolve();

async function ensureDb() {
  const dir = path.dirname(DB_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    const initial = {
      users: [],
      createdAt: new Date().toISOString()
    };
    await fs.writeFile(DB_PATH, JSON.stringify(initial, null, 2), "utf8");
  }
}

async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  return JSON.parse(raw || "{}") || { users: [] };
}

async function writeDb(nextDb) {
  await ensureDb();
  dbWriteQueue = dbWriteQueue.then(() =>
    fs.writeFile(DB_PATH, JSON.stringify(nextDb, null, 2), "utf8")
  );
  return dbWriteQueue;
}

async function updateDb(mutator) {
  const db = await readDb();
  const updated = (await mutator(db)) || db;
  await writeDb(updated);
  return updated;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    profile: user.profile || {},
    analyticsMeta: {
      attemptsCount: user.analytics?.attempts?.length || 0,
      questionsAsked: user.analytics?.questionsAsked || 0,
      badges: user.analytics?.badges || []
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

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return { hash, salt };
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

app.get("/api/health", (_req, res) => {
  return res.json({
    ok: true,
    provider: "groq",
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    authReady: Boolean(process.env.AUTH_SECRET)
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!name || !email || !password) {
      return sendError(res, 400, "BAD_REQUEST", "name, email, and password are required");
    }
    if (password.length < 6) {
      return sendError(res, 400, "BAD_REQUEST", "Password must be at least 6 characters");
    }

    let createdUser = null;
    await updateDb((db) => {
      const users = db.users || [];
      if (users.some((u) => u.email === email)) {
        throw new Error("EMAIL_EXISTS");
      }

      const { hash, salt } = hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: new Date().toISOString(),
        profile: {
          preferredLanguage: "English",
          goals: []
        },
        analytics: {
          attempts: [],
          questionsAsked: 0,
          proctorEvents: [],
          badges: []
        }
      };

      users.push(user);
      db.users = users;
      createdUser = user;
      return db;
    });

    const token = createToken({ uid: createdUser.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    return res.json({ ok: true, token, user: sanitizeUser(createdUser) });
  } catch (err) {
    if (String(err.message || err) === "EMAIL_EXISTS") {
      return sendError(res, 409, "EMAIL_EXISTS", "An account with this email already exists");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to register", String(err.message || err));
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return sendError(res, 400, "BAD_REQUEST", "email and password are required");
    }

    const db = await readDb();
    const user = (db.users || []).find((u) => u.email === email);
    if (!user) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const { hash } = hashPassword(password, user.passwordSalt);
    if (!safeEqual(hash, user.passwordHash)) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const token = createToken({ uid: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    return res.json({ ok: true, token, user: sanitizeUser(user) });
  } catch (err) {
    return sendError(res, 500, "SERVER_ERROR", "Failed to login", String(err.message || err));
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const db = await readDb();
  const user = (db.users || []).find((u) => u.id === req.auth.uid);
  if (!user) {
    return sendError(res, 404, "USER_NOT_FOUND", "User not found");
  }
  return res.json({ ok: true, user: sanitizeUser(user) });
});

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const { name, preferredLanguage, goals } = req.body || {};
    let updatedUser = null;

    await updateDb((db) => {
      const user = (db.users || []).find((u) => u.id === req.auth.uid);
      if (!user) throw new Error("USER_NOT_FOUND");

      if (typeof name === "string" && name.trim()) {
        user.name = name.trim();
      }
      user.profile = user.profile || {};
      if (typeof preferredLanguage === "string" && preferredLanguage.trim()) {
        user.profile.preferredLanguage = preferredLanguage.trim();
      }
      if (Array.isArray(goals)) {
        user.profile.goals = goals.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 8);
      }

      updatedUser = user;
      return db;
    });

    return res.json({ ok: true, user: sanitizeUser(updatedUser) });
  } catch (err) {
    if (String(err.message || err) === "USER_NOT_FOUND") {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to update profile", String(err.message || err));
  }
});

app.post("/api/profile/sync", authMiddleware, async (req, res) => {
  try {
    const { theme, selectedLanguage, lastOpenedAt } = req.body || {};

    await updateDb((db) => {
      const user = (db.users || []).find((u) => u.id === req.auth.uid);
      if (!user) throw new Error("USER_NOT_FOUND");

      user.profile = user.profile || {};
      user.profile.preferences = {
        ...(user.profile.preferences || {}),
        ...(theme ? { theme } : {}),
        ...(selectedLanguage ? { selectedLanguage } : {}),
        ...(lastOpenedAt ? { lastOpenedAt } : {})
      };

      return db;
    });

    return res.json({ ok: true });
  } catch (err) {
    if (String(err.message || err) === "USER_NOT_FOUND") {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to sync profile", String(err.message || err));
  }
});

app.get("/api/analytics/dashboard", authMiddleware, async (req, res) => {
  const db = await readDb();
  const user = (db.users || []).find((u) => u.id === req.auth.uid);
  if (!user) {
    return sendError(res, 404, "USER_NOT_FOUND", "User not found");
  }

  const analytics = summarizeAnalytics(user.analytics || {});
  return res.json({ ok: true, analytics });
});

app.post("/api/analytics/attempt", authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};

    await updateDb((db) => {
      const user = (db.users || []).find((u) => u.id === req.auth.uid);
      if (!user) throw new Error("USER_NOT_FOUND");

      user.analytics = user.analytics || { attempts: [], questionsAsked: 0, proctorEvents: [], badges: [] };
      user.analytics.attempts = user.analytics.attempts || [];

      const attempt = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        quizTitle: String(payload.quizTitle || "Quiz"),
        score: clampNumber(payload.score, 0, 100, 0),
        totalQuestions: clampNumber(payload.totalQuestions, 1, 100, 1),
        durationSec: clampNumber(payload.durationSec, 0, 14400, 0),
        weakAreas: Array.isArray(payload.weakAreas) ? payload.weakAreas.map((x) => String(x || "")).filter(Boolean).slice(0, 8) : [],
        proctorSummary: payload.proctorSummary || null
      };

      user.analytics.attempts.push(attempt);
      if (user.analytics.attempts.length > 300) {
        user.analytics.attempts = user.analytics.attempts.slice(-300);
      }

      user.analytics.badges = computeBadges(user.analytics);
      return db;
    });

    const freshDb = await readDb();
    const updatedUser = (freshDb.users || []).find((u) => u.id === req.auth.uid);
    return res.json({ ok: true, analytics: summarizeAnalytics(updatedUser.analytics || {}) });
  } catch (err) {
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

    await updateDb((db) => {
      const user = (db.users || []).find((u) => u.id === req.auth.uid);
      if (!user) throw new Error("USER_NOT_FOUND");

      user.analytics = user.analytics || { attempts: [], questionsAsked: 0, proctorEvents: [], badges: [] };
      user.analytics.proctorEvents = user.analytics.proctorEvents || [];
      user.analytics.proctorEvents.push({
        at: new Date().toISOString(),
        type: String(type),
        detail: String(detail || "")
      });

      if (user.analytics.proctorEvents.length > 500) {
        user.analytics.proctorEvents = user.analytics.proctorEvents.slice(-500);
      }

      return db;
    });

    return res.json({ ok: true });
  } catch (err) {
    if (String(err.message || err) === "USER_NOT_FOUND") {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    return sendError(res, 500, "SERVER_ERROR", "Failed to log proctor event", String(err.message || err));
  }
});

app.post("/api/explain", async (req, res) => {
  try {
    const { code, outputLanguage, codeLanguage } = req.body;
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
    console.error("/api/explain error:", err);
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to generate explanation", String(err.message || err));
  }
});

app.post("/api/grade", async (req, res) => {
  try {
    const { question, reference = "", answer } = req.body;
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
    console.error("/api/grade error:", err);
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to grade answer", String(err.message || err));
  }
});

app.post("/api/quiz/generate", async (req, res) => {
  try {
    const topic = String(req.body?.topic || "").trim();
    const questionType = String(req.body?.questionType || "mixed").toLowerCase();
    const difficulty = String(req.body?.difficulty || "mixed").toLowerCase();
    const outputLanguage = String(req.body?.outputLanguage || "English");
    const contextCode = String(req.body?.contextCode || "");
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
    console.error("/api/quiz/generate error:", err);
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to generate quiz", String(err.message || err));
  }
});

app.post("/api/ask", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const code = String(req.body?.code || "");
    const outputLanguage = String(req.body?.outputLanguage || "English");
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8).map((h) => ({ role: String(h.role || "user"), content: String(h.content || "") })) : [];

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
        await updateDb((db) => {
          const user = (db.users || []).find((u) => u.id === payload.uid);
          if (user) {
            user.analytics = user.analytics || { attempts: [], questionsAsked: 0, proctorEvents: [], badges: [] };
            user.analytics.questionsAsked = Number(user.analytics.questionsAsked || 0) + 1;
            user.analytics.badges = computeBadges(user.analytics);
          }
          return db;
        });
      }
    }

    return res.json({ ok: true, answer, followups });
  } catch (err) {
    return sendError(res, 500, "UPSTREAM_AI_ERROR", "Failed to answer question", String(err.message || err));
  }
});

app.post("/api/study-plan", authMiddleware, async (req, res) => {
  try {
    const outputLanguage = String(req.body?.outputLanguage || "English");
    const db = await readDb();
    const user = (db.users || []).find((u) => u.id === req.auth.uid);
    if (!user) {
      return sendError(res, 404, "USER_NOT_FOUND", "User not found");
    }

    const analytics = summarizeAnalytics(user.analytics || {});
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

ensureDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Groq-backed API server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize backend datastore", err);
    process.exit(1);
  });
