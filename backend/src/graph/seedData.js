const DEMO_STUDENTS = [
  {
    id: "s001",
    name: "Arjun",
    skill_level: 72,
    avg_quiz_score: 78.5,
    embedding: [0.82, 0.34, 0.67, 0.21, 0.55],
    weak_concepts: ["Recursion", "Memoization"]
  },
  {
    id: "s002",
    name: "Priya",
    skill_level: 68,
    avg_quiz_score: 85,
    embedding: [0.75, 0.41, 0.7, 0.33, 0.48],
    weak_concepts: ["Graph Traversal", "Binary Search"]
  },
  {
    id: "s003",
    name: "Ravi",
    skill_level: 55,
    avg_quiz_score: 62,
    embedding: [0.45, 0.67, 0.38, 0.72, 0.29],
    weak_concepts: ["Arrays", "Recursion"]
  },
  {
    id: "s004",
    name: "Sneha",
    skill_level: 88,
    avg_quiz_score: 91,
    embedding: [0.91, 0.22, 0.88, 0.15, 0.76],
    weak_concepts: ["Tabulation"]
  },
  {
    id: "s005",
    name: "Dev",
    skill_level: 48,
    avg_quiz_score: 55,
    embedding: [0.31, 0.78, 0.25, 0.81, 0.19],
    weak_concepts: ["Arrays", "Linked Lists"]
  },
  {
    id: "s006",
    name: "Meera",
    skill_level: 82,
    avg_quiz_score: 88,
    embedding: [0.88, 0.29, 0.75, 0.18, 0.65],
    weak_concepts: ["Memoization"]
  },
  {
    id: "s007",
    name: "Karan",
    skill_level: 40,
    avg_quiz_score: 45,
    embedding: [0.22, 0.85, 0.19, 0.88, 0.11],
    weak_concepts: ["Arrays", "Linked Lists", "Recursion"]
  },
  {
    id: "s008",
    name: "Ananya",
    skill_level: 69,
    avg_quiz_score: 73,
    embedding: [0.71, 0.45, 0.68, 0.38, 0.52],
    weak_concepts: ["Graph Traversal", "Trees"]
  },
  {
    id: "s009",
    name: "Rohan",
    skill_level: 61,
    avg_quiz_score: 67,
    embedding: [0.58, 0.52, 0.55, 0.49, 0.43],
    weak_concepts: ["Tabulation", "Memoization"]
  },
  {
    id: "s010",
    name: "Ishaan",
    skill_level: 35,
    avg_quiz_score: 92,
    embedding: [0.9, 0.21, 0.85, 0.14, 0.78],
    weak_concepts: ["Recursion", "Linked Lists"]
  }
];

const DEMO_CONCEPTS = [
  { id: "arrays", name: "Arrays", prerequisites: [] },
  { id: "linked-lists", name: "Linked Lists", prerequisites: ["Arrays"] },
  { id: "recursion", name: "Recursion", prerequisites: ["Arrays"] },
  { id: "binary-search", name: "Binary Search", prerequisites: ["Arrays"] },
  { id: "trees", name: "Trees", prerequisites: ["Recursion"] },
  { id: "graph-traversal", name: "Graph Traversal", prerequisites: ["Trees"] },
  { id: "memoization", name: "Memoization", prerequisites: ["Recursion"] },
  { id: "tabulation", name: "Tabulation", prerequisites: ["Arrays"] }
];

function findStudent(studentId) {
  return DEMO_STUDENTS.find((student) => student.id === studentId) || DEMO_STUDENTS[0];
}

function toConceptId(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getHintStyle(skillLevel) {
  if (skillLevel < 50) return "beginner";
  if (skillLevel < 75) return "intermediate";
  return "advanced";
}

function getConcept(name) {
  return DEMO_CONCEPTS.find((concept) => concept.name === name) || {
    id: toConceptId(name),
    name,
    prerequisites: []
  };
}

function buildWeaknessScore(student, index) {
  const base = 100 - Number(student.skill_level || 50);
  return Math.max(25, Math.min(95, base + 18 - index * 9));
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.name || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fallbackSkillIntelligence(studentId) {
  const student = findStudent(studentId);

  const weak_concepts = student.weak_concepts.map((name, index) => ({
    id: toConceptId(name),
    name,
    weakness_score: buildWeaknessScore(student, index)
  }));

  const prerequisites = uniqueByName(
    weak_concepts.flatMap((concept, index) => {
      const sourceConcept = getConcept(concept.name);
      return sourceConcept.prerequisites.map((name) => ({
        id: toConceptId(name),
        name,
        weakness_score: Math.max(20, concept.weakness_score - 15 - index * 5)
      }));
    })
  );

  const recommended_topics = uniqueByName(
    [...prerequisites, ...weak_concepts]
      .slice(0, 3)
      .map((concept) => ({
        id: concept.id,
        name: concept.name
      }))
  );

  return {
    weak_concepts,
    prerequisites,
    recommended_topics,
    root_cause: weak_concepts[0]?.name || "Problem Solving",
    hint_style: getHintStyle(student.skill_level),
    source: "demo-mode"
  };
}

function fallbackArenaMatch(studentId) {
  const student = findStudent(studentId);
  let bestCandidate = null;

  for (const candidate of DEMO_STUDENTS) {
    if (candidate.id === student.id) continue;

    const sharedWeakConcepts = candidate.weak_concepts.filter((concept) => student.weak_concepts.includes(concept));
    const skillGap = Math.abs(Number(candidate.skill_level || 0) - Number(student.skill_level || 0));
    const score = sharedWeakConcepts.length * 10 - skillGap;

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        score,
        student: candidate,
        sharedWeakConcepts
      };
    }
  }

  const matchedStudent = bestCandidate?.student || DEMO_STUDENTS.find((candidate) => candidate.id !== student.id) || student;

  return {
    matched_student: {
      id: matchedStudent.id,
      name: matchedStudent.name,
      skill_level: matchedStudent.skill_level
    },
    shared_weak_concepts: bestCandidate?.sharedWeakConcepts || [],
    final_score: 0.75,
    source: "demo-mode"
  };
}

module.exports = {
  DEMO_STUDENTS,
  DEMO_CONCEPTS,
  fallbackSkillIntelligence,
  fallbackArenaMatch
};
