const express = require("express");
const { runQuery } = require("../graph/tigergraphClient");
const { DEMO_STUDENTS, fallbackSkillIntelligence } = require("../graph/seedData");

const router = express.Router();

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
          weakness_score: Number(concept.attributes["@weakness_score"] || concept?.weakness_score || concept?.score || 50)
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

  if (records.length) {
    const topConcepts = records.map((item) => ({
      id: String(item?.id || item?.name || ""),
      name: String(item?.name || item?.id || ""),
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

module.exports = router;
