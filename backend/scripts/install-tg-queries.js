/**
 * Installs required GSQL queries on TigerGraph for CodeCoach.
 * Run: node backend/scripts/install-tg-queries.js
 *
 * Queries installed:
 *  1. skillIntelligence  — returns weak concepts, prerequisites, recommended topics
 *  2. knowledgeDebt      — returns concepts sorted by debt score
 *  3. arenaMatchmaking   — finds students with similar weaknesses
 *  4. findImpostors      — finds students with suspiciously high scores but weak fundamentals
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../codecoach/.env") });
require("dotenv").config({ path: path.join(__dirname, "../.env"), override: true });

const axios = require("axios");

const TG_HOST  = process.env.TG_HOST;
const TG_SECRET = process.env.TG_SECRET;
const TG_GRAPH = process.env.TG_GRAPH || "LearningGraph";

if (!TG_HOST || !TG_SECRET) {
  console.error("TG_HOST or TG_SECRET missing from .env");
  process.exit(1);
}

async function getToken() {
  const resp = await axios.post(
    `${TG_HOST}/gsql/v1/tokens`,
    { secret: TG_SECRET },
    { headers: { "Content-Type": "application/json" }, timeout: 10000 }
  );
  const token = resp.data?.token;
  if (!token) throw new Error("No token in response");
  console.log("Got TigerGraph token");
  return token;
}

async function runGSQL(token, gsql) {
  const fullGSQL = `USE GRAPH ${TG_GRAPH}\n${gsql}`;
  console.log("\n--- Sending GSQL ---");
  console.log(gsql.slice(0, 200) + (gsql.length > 200 ? "..." : ""));

  const resp = await axios.post(
    `${TG_HOST}/gsql/v1/statements`,
    fullGSQL,
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      timeout: 60000
    }
  );
  return resp.data;
}

// ─── Query Definitions ──────────────────────────────────────────────────────

const SKILL_INTELLIGENCE = `
CREATE OR REPLACE QUERY skillIntelligence(VERTEX<Student> s) FOR GRAPH ${TG_GRAPH} {
  SetAccum<VERTEX<Concept>> @@weakSet;
  MaxAccum<INT> @err_freq;

  Start = {s};

  WeakConcepts = SELECT c
                 FROM Start:st -(weak_in:e)-> Concept:c
                 ACCUM @@weakSet += c, c.@err_freq += e.error_frequency
                 ORDER BY c.@err_freq DESC
                 LIMIT 10;

  Prerequisites = SELECT p
                  FROM WeakConcepts:c -(reverse_prerequisite:e)-> Concept:p
                  WHERE NOT @@weakSet.contains(p);

  RecommendedTopics = Prerequisites UNION WeakConcepts;

  PRINT WeakConcepts;
  PRINT Prerequisites;
  PRINT RecommendedTopics;
}
`;

const KNOWLEDGE_DEBT = `
CREATE OR REPLACE QUERY knowledgeDebt(VERTEX<Student> s) FOR GRAPH ${TG_GRAPH} {
  SumAccum<INT> @debt_score;

  Start = {s};

  DebtList = SELECT c
             FROM Start:st -(weak_in:e)-> Concept:c
             ACCUM c.@debt_score += e.error_frequency
             ORDER BY c.@debt_score DESC
             LIMIT 20;

  PRINT DebtList;
}
`;

const ARENA_MATCHMAKING = `
CREATE OR REPLACE QUERY arenaMatchmaking(VERTEX<Student> target_student) FOR GRAPH ${TG_GRAPH} {
  SetAccum<VERTEX<Concept>> @@targetWeakSet;
  SumAccum<INT> @shared_count;

  Start = {target_student};

  TargetWeak = SELECT c
               FROM Start:st -(weak_in)-> Concept:c
               ACCUM @@targetWeakSet += c;

  AllStudents = {Student.*};

  Result = SELECT other
           FROM AllStudents:other -(weak_in)-> Concept:c
           WHERE @@targetWeakSet.contains(c)
             AND other != target_student
           ACCUM other.@shared_count += 1
           ORDER BY other.@shared_count DESC
           LIMIT 5;

  PRINT Result;
}
`;

const FIND_IMPOSTORS = `
CREATE OR REPLACE QUERY findImpostors(INT threshold = 70, INT min_weak = 3) FOR GRAPH ${TG_GRAPH} {
  /*
   * Finds students whose avg_quiz_score >= threshold but have >= min_weak weak concepts.
   * These are "impostors" — high scorers with shaky fundamentals.
   */

  SumAccum<INT> @weak_count;

  Suspects = SELECT s
             FROM Student:s -(weak_in)-> Concept:c
             WHERE s.avg_quiz_score >= threshold
             ACCUM s.@weak_count += 1
             HAVING s.@weak_count >= min_weak
             ORDER BY s.@weak_count DESC
             LIMIT 10;

  PRINT Suspects;
}
`;

async function main() {
  const token = await getToken();

  const queries = [
    { name: "skillIntelligence", gsql: SKILL_INTELLIGENCE },
    { name: "knowledgeDebt",     gsql: KNOWLEDGE_DEBT },
    { name: "arenaMatchmaking",  gsql: ARENA_MATCHMAKING },
    { name: "findImpostors",     gsql: FIND_IMPOSTORS },
  ];

  for (const { name, gsql } of queries) {
    console.log(`\n=== Installing ${name} ===`);
    try {
      const result = await runGSQL(token, gsql);
      console.log("Result:", JSON.stringify(result).slice(0, 300));
    } catch (err) {
      console.error(`Failed to install ${name}:`, err.response?.data || err.message);
    }
  }

  // Install all queries
  console.log("\n=== Installing all queries ===");
  try {
    const installResult = await runGSQL(token, "INSTALL QUERY ALL");
    console.log("Install result:", JSON.stringify(installResult).slice(0, 300));
  } catch (err) {
    console.error("INSTALL QUERY ALL failed:", err.response?.data || err.message);
    console.log("\nTrying individual installs...");
    for (const { name } of queries) {
      try {
        const r = await runGSQL(token, `INSTALL QUERY ${name}`);
        console.log(`  ${name}:`, JSON.stringify(r).slice(0, 200));
      } catch (e2) {
        console.error(`  ${name} failed:`, e2.response?.data || e2.message);
      }
    }
  }

  // Test skillIntelligence
  console.log("\n=== Testing skillIntelligence for s001 ===");
  try {
    const qResp = await axios.get(
      `${TG_HOST}/restpp/query/${TG_GRAPH}/skillIntelligence?s=s001`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    const data = qResp.data?.results || [];
    console.log("Results:", JSON.stringify(data).slice(0, 500));
  } catch (err) {
    console.error("Test failed:", err.response?.data || err.message);
  }

  console.log("\nDone! All queries installed.");
}

main().catch(err => {
  console.error("Script failed:", err.message || err);
  process.exit(1);
});
