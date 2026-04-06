const express = require("express");
const { callModel } = require("../../callModel");
const { runQuery } = require("../graph/tigergraphClient");
const { triggerWakeOnDemand } = require("../graph/keepAlive");
const { graphAgentAsk } = require("../llm/graphAgent");
const { DEMO_STUDENTS, fallbackSkillIntelligence } = require("../graph/seedData");

const router = express.Router();

router.get("/wake", (_req, res) => {
  triggerWakeOnDemand().catch(() => {});
  return res.status(202).json({
    ok: true,
    status: "warming"
  });
});

router.post("/agent-ask", async (req, res) => {
  try {
    const studentId = sanitizeId(req.body?.studentId || "");
    const question = String(req.body?.question || "").trim();

    if (!studentId || !question) {
      return res.status(400).json({
        ok: false,
        error: "studentId and question are required"
      });
    }

    const result = await graphAgentAsk(studentId, question);
    return res.json(result);
  } catch (err) {
    console.error("[graph] /agent-ask error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "Failed to answer with graph agent"
    });
  }
});

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50);
}

function extractPrimaryRecord(data) {
  if (!data) return null;
  if (Array.isArray(data.results) && data.results.length > 0) return data.results[0];
  if (data.results && typeof data.results === "object") return data.results;
  return data;
}

function normalizeConcepts(rawConcepts) {
  if (!Array.isArray(rawConcepts)) return [];

  return rawConcepts
    .map((concept) => {
      if (concept?.attributes) {
        return {
          id: String(concept.v_id || concept.attributes.concept_id || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          name: String(concept.attributes.name || concept?.name || ""),
          weakness_score: Number(concept.attributes["@weakness_score"] || concept.attributes["@err_freq"] || concept.attributes["@debt_score"] || concept.attributes.error_frequency || concept?.weakness_score || concept?.score || 50)
        };
      }

      if (typeof concept === "string") {
        return {
          id: concept.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: concept,
          weakness_score: 50
        };
      }

      return {
        id: String(concept?.id || concept?.name || concept?.concept || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: String(concept?.name || concept?.concept || concept?.id || ""),
        weakness_score: Number(concept?.weakness_score || concept?.score || 50)
      };
    })
    .filter((concept) => concept.name);
}

function normalizeLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function extractPagerankConcepts(data) {
  const records = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.top_concepts)
      ? data.top_concepts
      : [];

  return records.map((item) => ({
    id: String(item?.id || item?.name || "").trim(),
    name: String(item?.name || item?.id || "").trim(),
    score: Number(item?.score || item?.pagerank || 0)
  }));
}

function buildSkillIntelligenceResponse(studentId, data) {
  const record = extractPrimaryRecord(data);
  if (!record) {
    return fallbackSkillIntelligence(studentId);
  }

  const weakConcepts = normalizeConcepts(
    record.WeakConcepts || record.weak_concepts || []
  );
  const prerequisites = normalizeConcepts(
    record.Prerequisites || record.prerequisites || []
  );
  const recommendedTopicsRaw = Array.isArray(record.RecommendedTopics || record.recommended_topics)
    ? record.RecommendedTopics || record.recommended_topics
    : [];
  const recommendedTopics = recommendedTopicsRaw
    .map((topic) => {
      if (topic?.attributes) {
        return {
          id: String(topic.v_id || topic.attributes.concept_id || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          name: String(topic.attributes.name || "")
        };
      }

      if (typeof topic === "string") {
        return {
          id: topic.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: topic
        };
      }

      return {
        id: String(topic?.id || topic?.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: String(topic?.name || topic?.id || "")
      };
    })
    .filter((topic) => topic.name);

  if (!weakConcepts.length && !prerequisites.length && !recommendedTopics.length) {
    return fallbackSkillIntelligence(studentId);
  }

  return {
    weak_concepts: weakConcepts,
    prerequisites,
    recommended_topics: recommendedTopics,
    root_cause: String(record.root_cause || weakConcepts[0]?.name || "Problem Solving"),
    hint_style: String(record.hint_style || record.hintStyle || "intermediate"),
    source: "tigergraph"
  };
}

router.post("/socratic-question", async (req, res) => {
  try {
    const studentId = sanitizeId(req.body?.studentId || "s001");
    const currentCode = String(req.body?.currentCode || "").slice(0, 12000);
    const problemContext = String(req.body?.problemContext || "").slice(0, 1500);

    const queryResult = await runQuery("skillIntelligence", { s: studentId });
    const response = buildSkillIntelligenceResponse(studentId, queryResult);
    const weakestPrerequisite = [...response.prerequisites]
      .sort((a, b) => Number(b.weakness_score || 0) - Number(a.weakness_score || 0))[0];

    const rootCause = response.root_cause || response.weak_concepts[0]?.name || "problem solving";
    const weakestConcept = weakestPrerequisite?.name || rootCause;
    const prompt = `You are a Socratic tutor. Student struggles with ${rootCause}. Their weakest prerequisite is ${weakestConcept}. Problem context: ${problemContext || "not provided"}. Current code: ${currentCode || "not provided"}. Ask ONE targeted question guiding them to discover the answer. No answers. Under 2 sentences.`;
    const question = await callModel(prompt, {
      maxTokens: 120,
      temperature: 0.4,
      timeoutMs: 20000
    });

    return res.json({
      question,
      targets_concept: weakestConcept,
      source: "graph-socratic"
    });
  } catch (err) {
    console.error("[graph] /socratic-question error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "Failed to generate Socratic question"
    });
  }
});

router.get("/predict/:studentId", async (req, res) => {
  try {
    const studentId = sanitizeId(req.params?.studentId || "s001");
    const [skillResult, pagerankResult] = await Promise.all([
      runQuery("skillIntelligence", { s: studentId }),
      runQuery("tg_pagerank", {
        v_type: "Concept",
        e_type: "prerequisite",
        top_k: 10
      })
    ]);

    const response = buildSkillIntelligenceResponse(studentId, skillResult);
    const pagerankConcepts = extractPagerankConcepts(pagerankResult);

    const predictions = response.weak_concepts
      .filter((concept) => Number(concept.weakness_score || 0) > 30)
      .map((concept) => {
        const pagerankMatch = pagerankConcepts.find((item) => (
          normalizeLookupValue(item.id) === normalizeLookupValue(concept.id)
          || normalizeLookupValue(item.name) === normalizeLookupValue(concept.name)
        ));
        const predictedDifficulty = Math.max(
          0,
          Math.min(
            100,
            Math.round(Number(concept.weakness_score || 0) * Number(pagerankMatch?.score || 0.1) * 10)
          )
        );

        return {
          concept: concept.name,
          predicted_score: predictedDifficulty,
          reason: "High graph centrality + weak prerequisites",
          will_struggle: predictedDifficulty < 50
        };
      })
      .sort((a, b) => b.predicted_score - a.predicted_score)
      .slice(0, 3);

    return res.json({
      predictions,
      source: "graph-gnn-lite"
    });
  } catch (err) {
    console.error("[graph] /predict error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "Failed to generate graph prediction"
    });
  }
});

router.post("/skill-intelligence", async (req, res) => {
  const studentId = sanitizeId(req.body?.studentId || "s001");
  const queryResult = await runQuery("skillIntelligence", { s: studentId });
  const response = buildSkillIntelligenceResponse(studentId, queryResult);

  return res.json({
    weak_concepts: response.weak_concepts,
    prerequisites: response.prerequisites,
    recommended_topics: response.recommended_topics,
    root_cause: response.root_cause,
    source: response.source
  });
});

router.get("/skill-map/:studentId", async (req, res) => {
  const studentId = sanitizeId(req.params?.studentId || "s001");
  const queryResult = await runQuery("skillIntelligence", { s: studentId });
  const response = buildSkillIntelligenceResponse(studentId, queryResult);
  const nodesById = new Map();

  for (const concept of [...response.weak_concepts, ...response.prerequisites]) {
    const weaknessScore = Number(concept.weakness_score || 0);
    const color = weaknessScore > 60
      ? "#ef4444"
      : weaknessScore > 30
        ? "#f97316"
        : "#22c55e";

    nodesById.set(concept.id, {
      id: concept.id,
      label: concept.name,
      color,
      size: 20 + (weaknessScore / 5)
    });
  }

  const edges = response.prerequisites.flatMap((prerequisite) =>
    response.weak_concepts
      .filter((concept) => concept.id !== prerequisite.id)
      .map((concept) => ({
        from: prerequisite.id,
        to: concept.id,
        label: "requires",
        arrows: "to"
      }))
  );

  return res.json({
    nodes: Array.from(nodesById.values()),
    edges,
    source: response.source
  });
});

router.get("/impostors", async (_req, res) => {
  const queryResult = await runQuery("findImpostors", {
    quiz_threshold: 75,
    weakness_threshold: 60
  });
  const records = Array.isArray(queryResult?.results)
    ? queryResult.results
    : Array.isArray(queryResult?.impostors)
      ? queryResult.impostors
      : [];

  if (records.length) {
    const impostors = records.map((item) => ({
      id: String(item?.id || item?.student_id || item?.studentId || ""),
      name: String(item?.name || item?.student_name || item?.studentName || ""),
      quiz_score: Number(item?.quiz_score || item?.avg_quiz_score || 0),
      skill_level: Number(item?.skill_level || 0)
    }));

    return res.json({
      impostors,
      source: "tigergraph"
    });
  }

  const ishaan = DEMO_STUDENTS.find((student) => student.id === "s010");
  return res.json({
    impostors: [
      {
        id: ishaan.id,
        name: ishaan.name,
        quiz_score: ishaan.avg_quiz_score,
        skill_level: ishaan.skill_level
      }
    ],
    source: "demo-mode"
  });
});

router.get("/pagerank", async (_req, res) => {
  const queryResult = await runQuery("tg_pagerank", {
    v_type: "Concept",
    e_type: "prerequisite",
    top_k: 5
  });
  const records = Array.isArray(queryResult?.results)
    ? queryResult.results
    : Array.isArray(queryResult?.top_concepts)
      ? queryResult.top_concepts
      : [];

  // tg_pagerank returns { results: [{ pagerank_top_nodes: [{ Vertex_ID, score }] }] }
  const pagerankNodes = records?.[0]?.pagerank_top_nodes || records?.[0]?.top_scores || records;
  const flatRecords = Array.isArray(pagerankNodes) ? pagerankNodes : records;

  if (flatRecords.length) {
    const topConcepts = flatRecords.map((item) => ({
      id: String(item?.Vertex_ID || item?.v_id || item?.id || item?.name || ""),
      name: String(item?.name || item?.Vertex_ID || item?.v_id || item?.id || ""),
      score: Number(item?.score || item?.pagerank || 0)
    }));

    return res.json({
      top_concepts: topConcepts,
      source: "tigergraph"
    });
  }

  return res.json({
    top_concepts: [
      { id: "arrays", name: "Arrays", score: 0.98 },
      { id: "recursion", name: "Recursion", score: 0.92 },
      { id: "trees", name: "Trees", score: 0.89 },
      { id: "graph-traversal", name: "Graph Traversal", score: 0.84 },
      { id: "memoization", name: "Memoization", score: 0.81 }
    ],
    source: "demo-mode"
  });
});

router.get("/knowledge-debt/:studentId", async (req, res) => {
  const studentId = sanitizeId(req.params?.studentId || "s001");
  const queryResult = await runQuery("knowledgeDebt", { s: studentId });

  // TigerGraph returns: { results: [{ DebtList: [{v_id, attributes:{name,@debt_score,@blocks_count}}] }] }
  const debtList = queryResult?.results?.[0]?.DebtList;
  if (Array.isArray(debtList) && debtList.length > 0) {
    const knowledge_debt = debtList.map((item) => ({
      concept_id:   String(item.v_id || item.attributes?.concept_id || ""),
      name:         String(item.attributes?.name || item.v_id || ""),
      debt_score:   Math.round(Number(item.attributes?.["@debt_score"] || 0)),
      blocks_count: Number(item.attributes?.["@blocks_count"] || 0)
    }));
    const total_debt   = knowledge_debt.reduce((sum, c) => sum + c.debt_score, 0);
    const debt_level   = total_debt > 200 ? "critical" : total_debt > 100 ? "high" : "moderate";
    const optimal_path = [...knowledge_debt]
      .sort((a, b) => b.blocks_count - a.blocks_count || a.debt_score - b.debt_score)
      .map((c) => c.name);
    return res.json({ knowledge_debt, total_debt, debt_level, optimal_path, source: "tigergraph" });
  }

  return res.json({
    knowledge_debt: [
      { concept_id: "c003", name: "Recursion",   debt_score: 132, blocks_count: 3 },
      { concept_id: "c001", name: "Arrays",      debt_score: 98,  blocks_count: 4 },
      { concept_id: "c005", name: "Memoization", debt_score: 74,  blocks_count: 2 }
    ],
    total_debt: 304,
    debt_level: "critical",
    optimal_path: ["Arrays", "Recursion", "Memoization"],
    source: "demo-mode"
  });
});

// POST /api/graph/learning-flowchart
router.post("/learning-flowchart", async (req, res) => {
  try {
    const studentId = sanitizeId(req.body?.studentId || "s001");
    const queryResult = await runQuery("skillIntelligence", { s: studentId });
    const response = buildSkillIntelligenceResponse(studentId, queryResult);

    const weakNames  = response.weak_concepts.map(c => c.name).filter(Boolean);
    const prereqNames = response.prerequisites.map(c => c.name).filter(Boolean);
    const rootCause  = response.root_cause || weakNames[0] || "Fundamentals";

    // Build flowchart nodes from actual graph data — no AI hallucination risk
    const nodes = [];
    const edges = [];
    let y = 0;

    // Phase 1: Root cause (start node)
    nodes.push({ id: "start", label: "Start Here", type: "start", x: 0, y });
    y += 1;

    // Phase 2: Prerequisites (foundation)
    const prereqs = prereqNames.length ? prereqNames : [rootCause];
    for (let i = 0; i < Math.min(prereqs.length, 4); i++) {
      const id = `prereq-${i}`;
      nodes.push({ id, label: prereqs[i], type: "prereq", x: i - (Math.min(prereqs.length, 4) - 1) / 2, y });
      edges.push({ from: "start", to: id });
    }
    y += 1;

    // Phase 3: Weak concepts (what to fix)
    const bridge = `bridge-${Date.now()}`;
    nodes.push({ id: bridge, label: "Practice & Apply", type: "checkpoint", x: 0, y });
    for (let i = 0; i < Math.min(prereqs.length, 4); i++) {
      edges.push({ from: `prereq-${i}`, to: bridge });
    }
    y += 1;

    for (let i = 0; i < Math.min(weakNames.length, 5); i++) {
      const id = `weak-${i}`;
      const score = response.weak_concepts[i]?.weakness_score || 50;
      nodes.push({ id, label: weakNames[i], type: score > 60 ? "critical" : "weak", x: i - (Math.min(weakNames.length, 5) - 1) / 2, y });
      edges.push({ from: bridge, to: id });
    }
    y += 1;

    // Phase 4: Mastery checkpoint
    const masteryId = "mastery";
    nodes.push({ id: masteryId, label: "Mastery Check", type: "checkpoint", x: 0, y });
    for (let i = 0; i < Math.min(weakNames.length, 5); i++) {
      edges.push({ from: `weak-${i}`, to: masteryId });
    }
    y += 1;

    // Phase 5: Goal
    nodes.push({ id: "goal", label: "Skill Level Up!", type: "goal", x: 0, y });
    edges.push({ from: masteryId, to: "goal" });

    // Now ask AI for study recommendations per weak concept
    let recommendations = {};
    try {
      const prompt = `Given a student's weak concepts: ${weakNames.join(", ")}
And their prerequisites: ${prereqNames.join(", ")}
Root cause: ${rootCause}

For each weak concept, give ONE specific study action (max 10 words each).
Return ONLY valid JSON like: {"concept": "action", ...}
Example: {"Recursion": "Practice with base case + recursive step drills"}`;

      const aiOut = await callModel(prompt, { maxTokens: 300, temperature: 0.3, timeoutMs: 15000 });
      // Try to parse
      try { recommendations = JSON.parse(aiOut); } catch {
        const m = (aiOut || "").match(/\{[\s\S]*\}/);
        if (m) try { recommendations = JSON.parse(m[0]); } catch { /* skip */ }
      }
    } catch { /* AI recommendations are optional */ }

    return res.json({
      nodes,
      edges,
      recommendations,
      root_cause: rootCause,
      source: response.source
    });
  } catch (err) {
    console.error("[graph] /learning-flowchart error:", err?.message || err);
    return res.status(500).json({ error: "Failed to generate flowchart" });
  }
});

module.exports = router;
