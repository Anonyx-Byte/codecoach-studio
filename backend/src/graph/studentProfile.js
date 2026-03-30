const { runQuery } = require("./tigergraphClient");
const { DEMO_STUDENTS, fallbackSkillIntelligence } = require("./seedData");

function getHintStyle(skillLevel) {
  if (skillLevel < 50) return "beginner";
  if (skillLevel < 75) return "intermediate";
  return "advanced";
}

function extractPayload(data) {
  if (!data) return null;
  if (Array.isArray(data.results) && data.results.length > 0) return data.results[0];
  if (data.results && typeof data.results === "object") return data.results;
  return data;
}

function normalizeWeakConcepts(rawConcepts) {
  if (!Array.isArray(rawConcepts)) return [];

  return rawConcepts
    .map((concept) => {
      if (typeof concept === "string") return concept;
      return concept?.name || concept?.concept || concept?.id || "";
    })
    .filter(Boolean);
}

async function getStudentProfile(studentId) {
  const fallbackProfile = (() => {
    const student = DEMO_STUDENTS.find((item) => item.id === studentId);
    const fallback = fallbackSkillIntelligence(studentId);
    const skillLevel = Number(student?.skill_level || 50);

    return {
      skill_level: skillLevel,
      weak_concepts: fallback.weak_concepts.map((concept) => concept.name),
      hint_style: getHintStyle(skillLevel),
      source: "demo-mode"
    };
  })();

  const queryResult = await runQuery("skillIntelligence", { s: studentId });
  const payload = extractPayload(queryResult);

  if (!payload) {
    return fallbackProfile;
  }

  const skillLevel = Number(
    payload.skill_level
    || payload.skillLevel
    || payload.student?.skill_level
    || payload.student?.skillLevel
    || fallbackProfile.skill_level
  );
  const weakConcepts = normalizeWeakConcepts(
    payload.weak_concepts
    || payload.weakConcepts
    || payload.student?.weak_concepts
    || payload.student?.weakConcepts
  );

  return {
    skill_level: skillLevel,
    weak_concepts: weakConcepts.length ? weakConcepts : fallbackProfile.weak_concepts,
    hint_style: getHintStyle(skillLevel),
    source: "tigergraph"
  };
}

function buildAdaptivePromptPrefix(profile) {
  const weakConcepts = Array.isArray(profile?.weak_concepts) && profile.weak_concepts.length
    ? profile.weak_concepts.join(", ")
    : "core concepts";
  const hintStyle = profile?.hint_style || getHintStyle(Number(profile?.skill_level || 50));

  if (hintStyle === "beginner") {
    return `This student is a beginner who struggles with ${weakConcepts}. Give step-by-step hints, explain prerequisites, use simple language.`;
  }

  if (hintStyle === "intermediate") {
    return `Intermediate student weak in ${weakConcepts}. Give hints connecting to weak areas. Don't give away the solution.`;
  }

  return "Advanced student. One sentence nudge only.";
}

module.exports = { getStudentProfile, buildAdaptivePromptPrefix };
