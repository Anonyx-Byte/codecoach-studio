/**
 * Seeds TigerGraph with rich demo data for student s001 (Alex Chen).
 * Run: node backend/scripts/seed-demo-student.js
 *
 * What it does:
 *  1. Updates s001 vertex: name="Alex Chen", skill_level=45, avg_quiz_score=68
 *  2. Sets strong weak_in edges to 5 concepts with high error_frequency
 *  3. Confirms knowledgeDebt + skillIntelligence queries return real data
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../codecoach/.env") });
require("dotenv").config({ path: path.join(__dirname, "../.env"), override: true });

const axios = require("axios");

const TG_HOST  = process.env.TG_HOST;
const TG_SECRET = process.env.TG_SECRET;
const TG_GRAPH = process.env.TG_GRAPH || "LearningGraph";

if (!TG_HOST || !TG_SECRET) {
  console.error("❌  TG_HOST or TG_SECRET missing from .env");
  process.exit(1);
}

async function getToken() {
  const resp = await axios.post(
    `${TG_HOST}/gsql/v1/tokens`,
    { secret: TG_SECRET },
    { headers: { "Content-Type": "application/json" }, timeout: 10000 }
  );
  const token = resp.data?.token;
  if (!token) throw new Error("No token in response: " + JSON.stringify(resp.data));
  console.log("✅  Got TigerGraph token");
  return token;
}

async function upsertGraph(token, body) {
  const resp = await axios.post(
    `${TG_HOST}/restpp/graph/${TG_GRAPH}`,
    body,
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: 15000
    }
  );
  return resp.data;
}

async function runGSQL(token, gsql) {
  const resp = await axios.post(
    `${TG_HOST}/gsql/v1/statements`,
    `USE GRAPH ${TG_GRAPH}\n${gsql}`,
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      timeout: 30000
    }
  );
  return resp.data;
}

async function main() {
  const token = await getToken();

  // ── 1. Update s001 vertex attributes ────────────────────────────────────────
  console.log("\n[1] Updating s001 vertex (Alex Chen)...");
  const vertexBody = {
    vertices: {
      Student: {
        s001: {
          name:           { value: "Alex Chen" },
          avg_quiz_score: { value: 68.0 },
          skill_level:    { value: 45.0 }
        }
      }
    },
    edges: {}
  };
  const vResult = await upsertGraph(token, vertexBody);
  console.log("   →", JSON.stringify(vResult));

  // ── 2. Set weak_in edges with high error_frequency ───────────────────────────
  // These concept IDs must exist in your graph. Common ones: c001–c010
  // Adjust IDs to match your actual Concept vertices.
  const weakEdges = [
    { conceptId: "c001", errorFreq: 85 },  // Recursion
    { conceptId: "c002", errorFreq: 78 },  // Dynamic Programming
    { conceptId: "c003", errorFreq: 72 },  // Trees
    { conceptId: "c004", errorFreq: 65 },  // Graphs
    { conceptId: "c005", errorFreq: 60 },  // Sorting
  ];

  console.log("\n[2] Setting weak_in edges for s001...");
  const edgeBody = { vertices: {}, edges: { Student: { s001: { weak_in: { Concept: {} } } } } };
  for (const { conceptId, errorFreq } of weakEdges) {
    edgeBody.edges.Student.s001.weak_in.Concept[conceptId] = {
      error_frequency: { value: errorFreq, op: "max" }
    };
  }
  const eResult = await upsertGraph(token, edgeBody);
  console.log("   →", JSON.stringify(eResult));

  // ── 3. Smoke-test skillIntelligence query ────────────────────────────────────
  console.log("\n[3] Running skillIntelligence query for s001...");
  try {
    const qResp = await axios.get(
      `${TG_HOST}/restpp/query/${TG_GRAPH}/skillIntelligence?s=s001`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    const data = qResp.data?.results?.[0];
    const weakNames = (data?.WeakConcepts || []).map(c => c?.attributes?.name).filter(Boolean);
    console.log("   Weak concepts:", weakNames.length ? weakNames.join(", ") : "(none — concepts may have different IDs)");
  } catch (err) {
    console.warn("   ⚠  skillIntelligence query failed:", err.response?.data || err.message);
  }

  // ── 4. Smoke-test knowledgeDebt query ───────────────────────────────────────
  console.log("\n[4] Running knowledgeDebt query for s001...");
  try {
    const qResp = await axios.get(
      `${TG_HOST}/restpp/query/${TG_GRAPH}/knowledgeDebt?s=s001`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    const debtList = qResp.data?.results?.[0]?.DebtList || [];
    console.log("   Debt items:", debtList.length);
    if (debtList.length) {
      const total = debtList.reduce((sum, d) => sum + (d?.attributes?.["@debt_score"] || 0), 0);
      console.log("   Total debt score:", total);
    } else {
      console.log("   ⚠  No debt data. Check concept IDs match your graph schema.");
    }
  } catch (err) {
    console.warn("   ⚠  knowledgeDebt query failed:", err.response?.data || err.message);
  }

  console.log("\n✅  Demo seed complete! Alex Chen (s001) is ready.\n");
  console.log("📋  Demo account: codecoach.demo@gmail.com → studentId: s001");
  console.log("    Sign in with Google using that Gmail to see graph-powered features.\n");
}

main().catch(err => {
  console.error("❌  Seed script failed:", err.message || err);
  process.exit(1);
});
