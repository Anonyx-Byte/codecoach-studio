const { runQuery } = require("../graph/tigergraphClient");
const { DEMO_STUDENTS, fallbackArenaMatch } = require("../graph/seedData");

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || !vecA.length || vecA.length !== vecB.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i += 1) {
    const a = Number(vecA[i] || 0);
    const b = Number(vecB[i] || 0);
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseEmbedding(value) {
  if (Array.isArray(value)) return value.map((item) => Number(item || 0));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => Number(item || 0)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extractCandidates(data) {
  if (!data) return [];

  if (Array.isArray(data.results)) {
    const nested = data.results.flatMap((item) => {
      if (Array.isArray(item?.candidates)) return item.candidates;
      if (Array.isArray(item?.matches)) return item.matches;
      if (Array.isArray(item?.recommended_matches)) return item.recommended_matches;
      return item && typeof item === "object" ? [item] : [];
    });
    return nested;
  }

  if (Array.isArray(data.candidates)) return data.candidates;
  if (Array.isArray(data.matches)) return data.matches;
  return [];
}

function normalizeCandidate(candidate) {
  const studentId = candidate?.id
    || candidate?.student_id
    || candidate?.studentId
    || candidate?.matched_student?.id;
  if (!studentId) return null;

  return {
    id: String(studentId),
    name: String(candidate?.name || candidate?.student_name || candidate?.matched_student?.name || studentId),
    skill_level: Number(
      candidate?.skill_level
      || candidate?.skillLevel
      || candidate?.matched_student?.skill_level
      || 50
    ),
    embedding: parseEmbedding(candidate?.embedding || candidate?.vector || candidate?.matched_student?.embedding),
    weaknessScore: Number(
      candidate?.weaknessScore
      || candidate?.weakness_score
      || candidate?.shared_weakness_score
      || candidate?.score
      || 0
    ),
    shared_weak_concepts: Array.isArray(candidate?.shared_weak_concepts)
      ? candidate.shared_weak_concepts
      : Array.isArray(candidate?.sharedWeakConcepts)
        ? candidate.sharedWeakConcepts
        : []
  };
}

async function findArenaMatch(studentId, studentEmbedding) {
  const demoStudent = DEMO_STUDENTS.find((student) => student.id === studentId);
  const queryResult = await runQuery("arenaMatchmaking", { target_student: studentId });
  const candidates = extractCandidates(queryResult)
    .map(normalizeCandidate)
    .filter(Boolean)
    .filter((candidate) => candidate.id !== studentId);

  if (!candidates.length) {
    return fallbackArenaMatch(studentId);
  }

  const sourceEmbedding = Array.isArray(studentEmbedding) && studentEmbedding.length
    ? studentEmbedding
    : demoStudent?.embedding || [];

  let bestMatch = null;

  for (const candidate of candidates) {
    const cosine = cosineSimilarity(sourceEmbedding, candidate.embedding);
    const finalScore = (0.6 * cosine) + (0.4 * (candidate.weaknessScore / 100));

    if (!bestMatch || finalScore > bestMatch.final_score) {
      bestMatch = {
        matched_student: {
          id: candidate.id,
          name: candidate.name,
          skill_level: candidate.skill_level
        },
        shared_weak_concepts: candidate.shared_weak_concepts,
        final_score: Math.round(finalScore * 1000) / 1000,
        source: "graph-matched"
      };
    }
  }

  return bestMatch || fallbackArenaMatch(studentId);
}

module.exports = { findArenaMatch, cosineSimilarity };
