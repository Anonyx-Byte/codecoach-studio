/**
 * Run this script AFTER starting the TigerGraph workspace:
 *   node backend/scripts/install-knowledge-debt-query.js
 *
 * It will:
 *  1. Fetch an auth token
 *  2. Create the knowledgeDebt GSQL query
 *  3. Install (compile) it
 *  4. Run a test call against student s001
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), override: true });

const TG_HOST  = process.env.TG_HOST;
const TG_SECRET = process.env.TG_SECRET;
const TG_GRAPH  = process.env.TG_GRAPH || "LearningGraph";

if (!TG_HOST || !TG_SECRET) {
  console.error("❌ TG_HOST and TG_SECRET must be set in backend/.env");
  process.exit(1);
}

const GSQL_QUERY = `
CREATE QUERY knowledgeDebt(VERTEX<Student> s) FOR GRAPH ${TG_GRAPH} {
  SumAccum<FLOAT> @debt_score;
  SumAccum<INT>   @blocks_count;
  OrAccum         @is_weak;

  Start = {s};

  WeakConcepts = SELECT c
    FROM Start:s -(weak_in:e)-> Concept:c
    ACCUM
      c.@is_weak    += TRUE,
      c.@debt_score += e.error_frequency;

  BlockedConcepts = SELECT c
    FROM WeakConcepts:c -(reverse_prerequisite:e)-> Concept:blocked
    ACCUM c.@blocks_count += 1;

  DebtList = SELECT c
    FROM WeakConcepts:c
    POST-ACCUM
      c.@debt_score = c.@debt_score * (1 + c.@blocks_count)
    ORDER BY c.@debt_score DESC;

  PRINT DebtList;
}
INSTALL QUERY knowledgeDebt
`;

async function run() {
  console.log("🔑 Fetching TigerGraph token...");
  const tokenResp = await fetch(`${TG_HOST}/gsql/v1/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: TG_SECRET })
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    console.error("❌ Token fetch failed:", tokenResp.status, text.slice(0, 300));
    process.exit(1);
  }

  const tokenData = await tokenResp.json();
  const token = tokenData.token;
  if (!token) {
    console.error("❌ No token in response:", JSON.stringify(tokenData));
    process.exit(1);
  }
  console.log("✅ Token obtained");

  // ── Create + Install query via GSQL endpoint ──
  console.log("📝 Creating and installing knowledgeDebt query...");
  const gsqlResp = await fetch(`${TG_HOST}/gsqlserver/gsql/file`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "text/plain"
    },
    body: GSQL_QUERY
  });

  const gsqlText = await gsqlResp.text();
  console.log("GSQL response:", gsqlText.slice(0, 800));

  if (!gsqlResp.ok && !gsqlText.includes("Successfully created")) {
    console.warn("⚠️  GSQL returned non-200. Check output above. Trying test anyway...");
  } else {
    console.log("✅ Query created and installed");
  }

  // ── Test call ──
  console.log("\n🧪 Testing knowledgeDebt with student s001...");
  const testResp = await fetch(
    `${TG_HOST}/restpp/query/${TG_GRAPH}/knowledgeDebt?s=s001`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  const testData = await testResp.json();
  console.log("\n📊 Raw TigerGraph output:");
  console.log(JSON.stringify(testData, null, 2));

  // ── Interpret result ──
  const results = testData?.results?.[0]?.DebtList || [];
  if (results.length === 0) {
    console.log("\nℹ️  No debt found for s001 (student may have no weak_in edges yet)");
  } else {
    console.log(`\n✅ Found ${results.length} concept(s) in debt:`);
    for (const item of results.slice(0, 5)) {
      const name  = item.attributes?.name || item.v_id;
      const debt  = item.attributes?.["@debt_score"]?.toFixed(1) ?? "?";
      const block = item.attributes?.["@blocks_count"] ?? 0;
      console.log(`  - ${name}: debt=${debt}, blocks=${block}`);
    }
  }
}

run().catch((err) => {
  console.error("❌ Fatal:", err.message || err);
  process.exit(1);
});
