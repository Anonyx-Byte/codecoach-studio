const express = require("express");
const { findArenaMatch }       = require("../arena/matchmaker");
const { callModel }            = require("../../callModel");
const { ddbDocClient }         = require("../../libs/dynamo");
const { getToken: getTGToken, runQuery } = require("../graph/tigergraphClient");
const { QueryCommand, PutCommand, ScanCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const router = express.Router();

// ─── Caches ──────────────────────────────────────────────────────────────────
const problemCache  = new Map();                // roomId → problem
const aiMatchCache  = new Map();                // roomId → { problem, ai_solution, ai_solve_time }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tryParseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

function slugify(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function getQuizTopicsForStudent(userId) {
  const client = ddbDocClient();
  if (!client) return [];
  try {
    const out = await client.send(new QueryCommand({
      TableName: "QuizAttempts",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": userId },
      ScanIndexForward: false,
      Limit: 20
    }));
    const seen = new Set();
    return (out?.Items || [])
      .map((i) => String(i.quizTitle || i.quizId || ""))
      .filter((t) => t && !seen.has(t) && seen.add(t));
  } catch (err) {
    console.warn("[arena] getQuizTopicsForStudent failed:", err?.message || err);
    return [];
  }
}

const PROBLEM_FALLBACK = {
  title: "Sum of Array Elements",
  description: "Given an array of integers, return their sum using recursion.",
  examples: "sumArray([1,2,3,4]) = 10",
  constraints: "Array length 1-100",
  difficulty: "Easy",
  timeLimit: 15,
  testCases: [
    { input: "[1,2,3,4]", expected: "10" },
    { input: "[5,5]",     expected: "10" },
    { input: "[0]",       expected: "0"  }
  ],
  hints: [
    "Think about the base case first",
    "What happens when the array has one element?"
  ],
  optimalApproach: "Recursive: return arr[0] + sumArray(arr.slice(1))",
  conceptsTested: ["Recursion", "Arrays"]
};

async function generateArenaProblem(matchData, roomId) {
  if (problemCache.has(roomId)) return problemCache.get(roomId);

  const {
    shared_weak_concepts = [],
    student1_id,
    student2_id,
    avg_skill_level = 50
  } = matchData;

  const primary   = shared_weak_concepts[0] || "Arrays";
  const secondary = shared_weak_concepts[1] || "general";
  const difficulty = avg_skill_level < 50 ? "Easy" : avg_skill_level < 75 ? "Medium" : "Hard";

  const [history1, history2] = await Promise.all([
    getQuizTopicsForStudent(student1_id),
    getQuizTopicsForStudent(student2_id)
  ]);

  const prompt = `You are a coding contest problem setter.
Generate a unique coding problem:
- Primary concept: ${primary}
- Secondary concept: ${secondary}
- Difficulty: ${difficulty}
- Student 1 has seen these topics: ${history1.join(", ") || "none yet"}
- Student 2 has seen these topics: ${history2.join(", ") || "none yet"}
- Must be solvable in 15-25 minutes
- NOT a standard LeetCode problem
Return ONLY valid JSON:
{
  "title": "string",
  "description": "string",
  "examples": "string",
  "constraints": "string",
  "difficulty": "Easy|Medium|Hard",
  "timeLimit": 15,
  "testCases": [{"input": "string", "expected": "string"}],
  "hints": ["string", "string"],
  "optimalApproach": "string",
  "conceptsTested": ["string"]
}`;

  let problem = PROBLEM_FALLBACK;
  try {
    const out = await callModel(prompt, { maxTokens: 1500, temperature: 0.7, timeoutMs: 30000 });
    problem = tryParseJson(out) || PROBLEM_FALLBACK;
  } catch (err) {
    console.warn("[arena] generateArenaProblem AI call failed:", err?.message || err);
  }

  problemCache.set(roomId, problem);
  return problem;
}

const RUNTIMES = {
  javascript: { language: "javascript", version: "18.15.0" },
  python:     { language: "python",     version: "3.10.0"  },
  java:       { language: "java",       version: "15.0.2"  },
  cpp:        { language: "cpp",        version: "10.2.0"  },
  typescript: { language: "typescript", version: "5.0.3"   },
  go:         { language: "go",         version: "1.16.2"  }
};

async function runCodeAgainstTestCase(code, language, input) {
  const runtime = RUNTIMES[language] || RUNTIMES.javascript;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch("https://emkc.org/api/v2/piston/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ content: code }],
        stdin: input,
        run_timeout: 3000
      })
    });
    if (!resp.ok) return { stdout: "", ok: false };
    const data = await resp.json();
    return { stdout: String(data?.run?.stdout || "").trim(), ok: true };
  } catch {
    return { stdout: "", ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function updateArenaWeakEdge(userId, conceptId, scorePercent) {
  const tgHost  = process.env.TG_HOST;
  const tgGraph = process.env.TG_GRAPH || "LearningGraph";
  if (!tgHost) return;
  try {
    const token = await getTGToken();
    if (!token) return;
    const errorFrequency = Math.round(100 - scorePercent);
    const body = {
      vertices: {},
      edges: {
        Student: {
          [userId]: {
            weak_in: {
              Concept: {
                [conceptId]: {
                  error_frequency: { value: errorFrequency, op: "max" }
                }
              }
            }
          }
        }
      }
    };
    const resp = await fetch(`${tgHost}/restpp/graph/${tgGraph}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!resp.ok) console.warn("[arena] TigerGraph edge update returned", resp.status);
  } catch (err) {
    console.warn("[arena] TigerGraph edge update failed:", err?.message || err);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/arena/match
router.post("/match", async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || "s001");
    const embedding = Array.isArray(req.body?.embedding) ? req.body.embedding : [];
    const match     = await findArenaMatch(studentId, embedding);
    const roomId    = `${Date.now()}-${studentId}`;

    const problem = await generateArenaProblem({
      shared_weak_concepts: match.shared_weak_concepts || [],
      student1_id:   studentId,
      student2_id:   match.matched_student?.id || "s002",
      avg_skill_level: Number(match.matched_student?.skill_level || 50)
    }, roomId);

    return res.json({
      ...match,
      roomId,
      problem: {
        title:          problem.title,
        description:    problem.description,
        examples:       problem.examples,
        constraints:    problem.constraints,
        difficulty:     problem.difficulty,
        timeLimit:      problem.timeLimit,
        hints:          problem.hints,
        conceptsTested: problem.conceptsTested
      }
    });
  } catch (err) {
    console.error("[arena] /match error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to find match" });
  }
});

// POST /api/arena/submit
router.post("/submit", async (req, res) => {
  try {
    const roomId    = String(req.body?.roomId    || "");
    const studentId = String(req.body?.studentId || "");
    const code      = String(req.body?.code      || "");
    const language  = String(req.body?.language  || "javascript").toLowerCase();
    const timeTaken = Number(req.body?.timeTaken || 0);

    if (!roomId || !studentId || !code.trim()) {
      return res.status(400).json({ ok: false, error: "roomId, studentId, and code are required" });
    }

    const problem = problemCache.get(roomId);
    if (!problem) {
      return res.status(404).json({ ok: false, error: "Room not found or session expired" });
    }

    const testCases = Array.isArray(problem.testCases) ? problem.testCases : [];
    let passed = 0;
    for (const tc of testCases) {
      const result = await runCodeAgainstTestCase(code, language, String(tc.input || ""));
      if (result.stdout === String(tc.expected || "").trim()) passed++;
    }

    const total      = testCases.length || 1;
    const base       = (passed / total) * 100;
    const timeLimitS = Number(problem.timeLimit || 20) * 60;
    const speedBonus = timeTaken < timeLimitS * 0.5 ? 20 : 0;
    const score      = Math.min(100, Math.round(base + speedBonus));

    const timestamp = new Date().toISOString();
    const client = ddbDocClient();
    if (client) {
      try {
        await client.send(new PutCommand({
          TableName: "ArenaResults",
          Item: {
            studentId,
            timestamp,
            roomId,
            score,
            timeTaken,
            problemTitle: problem.title || "",
            passed_tests: passed,
            total_tests:  total
          }
        }));
      } catch (err) {
        console.warn("[arena] ArenaResults write failed:", err?.message || err);
      }
    }

    const conceptId = slugify(problem.conceptsTested?.[0] || problem.title || "");
    if (conceptId) {
      if (score > 70) {
        updateArenaWeakEdge(studentId, conceptId, score - 10).catch(() => {});
      } else if (score < 40) {
        updateArenaWeakEdge(studentId, conceptId, score + 5).catch(() => {});
      }
    }

    return res.json({
      ok:          true,
      score,
      passed_tests: passed,
      total_tests:  total,
      winner:       score > 70 ? studentId : null
    });
  } catch (err) {
    console.error("[arena] /submit error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to submit solution" });
  }
});

// POST /api/arena/analyze
router.post("/analyze", async (req, res) => {
  try {
    const studentId    = String(req.body?.studentId    || "");
    const code         = String(req.body?.code         || "");
    const problemTitle = String(req.body?.problemTitle || "");
    const score        = Number(req.body?.score        || 0);
    const weakConcepts = Array.isArray(req.body?.weak_concepts) ? req.body.weak_concepts : [];
    const language     = String(req.body?.language     || "javascript");

    const prompt = `A student just completed a coding contest problem.
Problem: ${problemTitle}
Their solution (${language}):
${code}
Test result: ${score}/100
Student's known weak areas: ${weakConcepts.join(", ") || "none specified"}

Write a coaching analysis in plain text (NOT JSON, no code fences):

**What You Did Well:** 1-2 sentences.
**Areas for Improvement:** 2-3 sentences.
**Optimal Approach:** Explain simply.
**Pro Tip:** One specific tip for their weak area.
**Keep Going:** Encouragement message.

Keep it concise, friendly, and specific to their code. Use the headers above as section markers.`;

    let analysis = "Great effort! Keep practicing and focusing on breaking problems into smaller parts.";
    try {
      analysis = await callModel(prompt, { maxTokens: 600, temperature: 0.5, timeoutMs: 20000 });
    } catch (err) {
      console.warn("[arena] /analyze AI call failed:", err?.message || err);
    }

    const hintStyle = score > 70 ? "advanced" : score > 40 ? "intermediate" : "beginner";
    return res.json({ ok: true, analysis, hint_style: hintStyle });
  } catch (err) {
    console.error("[arena] /analyze error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to generate analysis" });
  }
});

// GET /api/arena/leaderboard
router.get("/leaderboard", async (req, res) => {
  try {
    const client = ddbDocClient();
    if (!client) {
      return res.json({ ok: true, leaderboard: [] });
    }

    const out = await client.send(new ScanCommand({
      TableName: "ArenaResults",
      Limit: 200
    }));

    const items = Array.isArray(out?.Items) ? out.Items : [];

    // Group by studentId
    const byStudent = new Map();
    for (const item of items) {
      const sid   = String(item.studentId || "");
      const score = Number(item.score || 0);
      if (!sid) continue;
      if (!byStudent.has(sid)) {
        byStudent.set(sid, { wins: 0, losses: 0, totalScore: 0, count: 0 });
      }
      const entry = byStudent.get(sid);
      entry.count++;
      entry.totalScore += score;
      if (score > 70) entry.wins++;
      else            entry.losses++;
    }

    // Look up names in Users table
    const leaderboard = [];
    for (const [studentId, stats] of byStudent) {
      let name = studentId;
      try {
        const userOut = await client.send(new GetCommand({
          TableName: "Users",
          Key: { userId: studentId }
        }));
        if (userOut?.Item?.name) name = String(userOut.Item.name);
      } catch {}
      leaderboard.push({
        studentId,
        name,
        wins:      stats.wins,
        losses:    stats.losses,
        avg_score: stats.count > 0 ? Math.round(stats.totalScore / stats.count) : 0
      });
    }

    leaderboard.sort((a, b) => b.wins - a.wins || b.avg_score - a.avg_score);

    return res.json({ ok: true, leaderboard: leaderboard.slice(0, 10) });
  } catch (err) {
    console.error("[arena] /leaderboard error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to fetch leaderboard" });
  }
});

// POST /api/arena/ai-match
router.post("/ai-match", async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || "s001");

    // Fetch weak concepts from TigerGraph
    let weakConcepts = [];
    let skillLevel   = 50;
    try {
      const tgData = await runQuery("skillIntelligence", { s: studentId });
      const items  = tgData?.results?.[0]?.weak_concepts
        || tgData?.results?.[0]?.Result
        || tgData?.results || [];
      if (Array.isArray(items)) {
        weakConcepts = items
          .slice(0, 4)
          .map((i) => i?.name || i?.attributes?.name || i?.concept_id || "")
          .filter(Boolean);
        const lvl = items[0]?.skill_level || items[0]?.attributes?.skill_level;
        if (lvl) skillLevel = Number(lvl);
      }
    } catch (err) {
      console.warn("[arena] ai-match skillIntelligence failed:", err?.message || err);
    }
    if (!weakConcepts.length) weakConcepts = ["Arrays", "Recursion"];

    const roomId  = `ai_${Date.now()}-${studentId}`;
    const problem = await generateArenaProblem({
      shared_weak_concepts: weakConcepts,
      student1_id:   studentId,
      student2_id:   studentId,   // same student — AI adapts
      avg_skill_level: skillLevel
    }, roomId);

    // Pre-generate AI solution
    const aiPrompt = `Write an optimal JavaScript solution for this problem:\n${problem.description}\n\nReturn ONLY the code, no explanation, no markdown fences.`;
    let aiSolution = `// AI solution unavailable\nconsole.log("0");`;
    try {
      aiSolution = await callModel(aiPrompt, { maxTokens: 800, temperature: 0.2, timeoutMs: 25000 });
      // Strip any accidental markdown fences
      aiSolution = aiSolution.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
    } catch (err) {
      console.warn("[arena] ai-match code generation failed:", err?.message || err);
    }

    // Calculate AI solve time
    const base       = (problem.timeLimit || 20) * 60 * 0.6;
    const levelMult  = skillLevel < 50 ? 1.4 : skillLevel > 75 ? 0.7 : 1.0;
    const variance   = 0.9 + Math.random() * 0.2;
    const aiSolveTime = Math.round(base * levelMult * variance);

    // Adapted difficulty maps to a pseudo skill_level for the UI
    const adaptedSkillLevel = problem.difficulty === "Easy" ? 45
      : problem.difficulty === "Hard" ? 88 : 65;

    aiMatchCache.set(roomId, { problem, ai_solution: aiSolution, ai_solve_time: aiSolveTime });

    return res.json({
      opponent: {
        id:          "ai-opponent",
        name:        "CodeCoach AI",
        skill_level: adaptedSkillLevel,
        is_ai:       true,
        avatar:      "🤖"
      },
      problem: {
        title:          problem.title,
        description:    problem.description,
        examples:       problem.examples,
        constraints:    problem.constraints,
        difficulty:     problem.difficulty,
        timeLimit:      problem.timeLimit,
        hints:          problem.hints,
        conceptsTested: problem.conceptsTested
      },
      roomId,
      ai_solve_time_seconds: aiSolveTime,
      shared_weak_concepts:  weakConcepts,
      source:                "graph-matched"
    });
  } catch (err) {
    console.error("[arena] /ai-match error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to create AI match" });
  }
});

// POST /api/arena/ai-result
router.post("/ai-result", async (req, res) => {
  try {
    const roomId    = String(req.body?.roomId    || "");
    const studentId = String(req.body?.studentId || "");
    const code      = String(req.body?.code      || "");
    const language  = String(req.body?.language  || "javascript").toLowerCase();
    const timeTaken = Number(req.body?.timeTaken || 0);

    if (!roomId || !studentId || !code.trim()) {
      return res.status(400).json({ ok: false, error: "roomId, studentId, and code are required" });
    }

    const cached = aiMatchCache.get(roomId);
    if (!cached) {
      return res.status(404).json({ ok: false, error: "AI match session not found or expired" });
    }

    const { problem, ai_solution, ai_solve_time } = cached;
    const testCases = Array.isArray(problem.testCases) ? problem.testCases : [];

    let passed = 0;
    for (const tc of testCases) {
      const result = await runCodeAgainstTestCase(code, language, String(tc.input || ""));
      if (result.stdout === String(tc.expected || "").trim()) passed++;
    }

    const total      = testCases.length || 1;
    const base       = (passed / total) * 100;
    const timeLimitS = Number(problem.timeLimit || 20) * 60;
    const speedBonus = timeTaken < timeLimitS * 0.5 ? 20 : 0;
    const userScore  = Math.min(100, Math.round(base + speedBonus));

    const allPassed  = passed === total;
    let winner;
    if (allPassed && timeTaken < ai_solve_time) winner = "user";
    else if (allPassed && timeTaken >= ai_solve_time) winner = "tie";
    else winner = "ai";

    const message = winner === "user"
      ? "You outsmarted the AI! Your solution was faster."
      : winner === "tie"
        ? "Tied on correctness, but the AI was a bit faster. Great job!"
        : "The AI wins this round — but every loss is a lesson. Review the AI solution below!";

    // TigerGraph edge update (fire-and-forget)
    const conceptId = slugify(problem.conceptsTested?.[0] || problem.title || "");
    if (conceptId) {
      if (userScore > 70) {
        updateArenaWeakEdge(studentId, conceptId, userScore - 10).catch(() => {});
      } else if (userScore < 40) {
        updateArenaWeakEdge(studentId, conceptId, userScore + 5).catch(() => {});
      }
    }

    // Clean up cache
    aiMatchCache.delete(roomId);

    return res.json({
      ok:           true,
      user_score:   userScore,
      ai_score:     100,
      winner,
      ai_solution,
      ai_time:      ai_solve_time,
      user_time:    timeTaken,
      passed_tests: passed,
      total_tests:  total,
      message
    });
  } catch (err) {
    console.error("[arena] /ai-result error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to evaluate AI result" });
  }
});

module.exports = router;
