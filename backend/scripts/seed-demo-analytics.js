/**
 * Seeds DynamoDB with rich analytics data for the demo account.
 * Run: node backend/scripts/seed-demo-analytics.js
 *
 * This inserts quiz attempts spanning 7 days with realistic scores,
 * weak areas, and progression — so the analytics dashboard looks
 * populated for a demo.
 */

const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../../codecoach/.env") });
require("dotenv").config({ path: path.join(__dirname, "../.env"), override: true });

const { initDynamo, ensureTablesIfNeeded, ddbDocClient, putUser, putAnalyticsAttempt, putUserBadge } = require("../libs/dynamo");
const { PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

// The demo user's DynamoDB userId — we need to find this from the Users table
// or create a mapping. Since the demo account signs in via Google and gets a
// random UUID, we'll look it up by email or create a known one.

const DEMO_EMAIL = (process.env.DEMO_STUDENT_EMAIL || "codecoach.demo@gmail.com").trim().toLowerCase();
const DEMO_STUDENT_ID = process.env.DEMO_STUDENT_ID || "s001";

// Quiz attempt templates — realistic progression over 7 days
const QUIZ_ATTEMPTS = [
  // Day 1 — struggling
  { day: -6, quizTitle: "Arrays Fundamentals",      score: 42, totalQ: 10, weak: ["mcq-easy", "Arrays"],              dur: 320 },
  { day: -6, quizTitle: "Basic Recursion",           score: 35, totalQ: 8,  weak: ["mcq-medium", "Recursion"],         dur: 480 },
  // Day 2 — slight improvement
  { day: -5, quizTitle: "Linked Lists Basics",       score: 48, totalQ: 10, weak: ["text-medium", "Linked Lists"],     dur: 360 },
  { day: -5, quizTitle: "Arrays Practice",           score: 55, totalQ: 10, weak: ["code-easy", "Arrays"],             dur: 300 },
  // Day 3 — getting better
  { day: -4, quizTitle: "Recursion Deep Dive",       score: 52, totalQ: 8,  weak: ["mcq-hard", "Recursion"],           dur: 420 },
  { day: -4, quizTitle: "Tree Traversal Intro",      score: 40, totalQ: 6,  weak: ["code-medium", "Trees"],            dur: 550 },
  // Day 4 — breakthrough on arrays
  { day: -3, quizTitle: "Arrays Advanced",           score: 72, totalQ: 12, weak: ["mcq-hard"],                        dur: 380 },
  { day: -3, quizTitle: "Graph Basics",              score: 38, totalQ: 8,  weak: ["text-hard", "Graph Traversal"],    dur: 600 },
  // Day 5 — consistent
  { day: -2, quizTitle: "Recursion + Memoization",   score: 65, totalQ: 10, weak: ["code-hard", "Memoization"],        dur: 450 },
  { day: -2, quizTitle: "Linked Lists Operations",   score: 70, totalQ: 8,  weak: ["text-medium"],                     dur: 340 },
  // Day 6 — strong day
  { day: -1, quizTitle: "Dynamic Programming Intro", score: 58, totalQ: 10, weak: ["mcq-hard", "Memoization"],         dur: 520 },
  { day: -1, quizTitle: "Tree & Graph Mixed",        score: 62, totalQ: 8,  weak: ["code-hard", "Trees"],              dur: 470 },
  // Day 7 (today) — latest scores
  { day: 0,  quizTitle: "Arrays Mastery Check",      score: 85, totalQ: 10, weak: [],                                  dur: 260 },
  { day: 0,  quizTitle: "Full Concept Review",       score: 78, totalQ: 15, weak: ["mcq-hard"],                        dur: 620 },
];

function dateForDay(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  // Randomize hour
  d.setHours(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
  return d.toISOString();
}

async function findDemoUserId() {
  const client = ddbDocClient();
  if (!client) return null;

  // Scan Users table for the demo email
  const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
  try {
    const out = await client.send(new ScanCommand({
      TableName: "Users",
      FilterExpression: "email = :email",
      ExpressionAttributeValues: { ":email": DEMO_EMAIL },
      Limit: 10
    }));
    const user = out?.Items?.[0];
    if (user) return user.userId;
  } catch (err) {
    console.warn("  Could not scan Users table:", err?.message);
  }
  return null;
}

async function main() {
  console.log("Initializing DynamoDB...");
  await initDynamo();
  await ensureTablesIfNeeded();

  let userId = await findDemoUserId();

  if (!userId) {
    // Create a demo user record if it doesn't exist (will be overwritten on first Google login)
    userId = "demo-" + crypto.randomUUID().slice(0, 8);
    console.log(`  Demo user not found in DB. Creating placeholder with userId=${userId}`);
    console.log(`  (This will be replaced when the user signs in with Google)`);

    await putUser({
      userId,
      name: "Alex Chen",
      email: DEMO_EMAIL,
      authProvider: "google",
      studentId: DEMO_STUDENT_ID,
      createdAt: new Date().toISOString(),
      profile: { preferredLanguage: "English", goals: ["Master DSA", "Graph algorithms"] },
      analyticsSummary: { questionsAsked: 12, badges: [], attemptsCount: 0 }
    });
  } else {
    console.log(`  Found demo user: ${userId}`);
    // Update to ensure studentId is set
    const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");
    try {
      await ddbDocClient().send(new UpdateCommand({
        TableName: "Users",
        Key: { userId },
        UpdateExpression: "SET studentId = :sid",
        ExpressionAttributeValues: { ":sid": DEMO_STUDENT_ID }
      }));
    } catch (_) { /* non-fatal */ }
  }

  // Insert quiz attempts
  console.log(`\nSeeding ${QUIZ_ATTEMPTS.length} quiz attempts for userId=${userId}...`);
  for (const qa of QUIZ_ATTEMPTS) {
    const createdAt = dateForDay(qa.day);
    await putAnalyticsAttempt({
      userId,
      createdAt,
      type: "quiz_attempt",
      data: {
        id: crypto.randomUUID(),
        createdAt,
        quizTitle: qa.quizTitle,
        score: qa.score,
        totalQuestions: qa.totalQ,
        durationSec: qa.dur,
        weakAreas: qa.weak,
        proctorSummary: null
      }
    });
    console.log(`  ✓ ${qa.quizTitle} — ${qa.score}%`);
  }

  // Update user analytics summary
  const { UpdateCommand: UC } = require("@aws-sdk/lib-dynamodb");
  const badges = [
    "start-your-journey",
    "first-quiz",
    "improvement-streak",
    "graph-explorer"
  ];

  try {
    await ddbDocClient().send(new UC({
      TableName: "Users",
      Key: { userId },
      UpdateExpression: "SET analyticsSummary = :summary",
      ExpressionAttributeValues: {
        ":summary": {
          attemptsCount: QUIZ_ATTEMPTS.length,
          questionsAsked: 12,
          badges
        }
      }
    }));
    console.log("\n  ✓ Updated analyticsSummary");
  } catch (err) {
    console.warn("  Could not update analyticsSummary:", err?.message);
  }

  // Insert badges
  for (const badge of badges) {
    try {
      await putUserBadge({ userId, badgeId: badge, earnedAt: new Date().toISOString() });
    } catch (_) { /* non-fatal */ }
  }
  console.log(`  ✓ Inserted ${badges.length} badges`);

  console.log("\n✅ Demo analytics seeded!");
  console.log(`   userId: ${userId}`);
  console.log(`   studentId: ${DEMO_STUDENT_ID}`);
  console.log(`   email: ${DEMO_EMAIL}`);
  console.log(`   ${QUIZ_ATTEMPTS.length} quiz attempts across 7 days`);
  console.log(`   Score trend: 42% → 85% (improvement arc)`);
  console.log(`   Weak topics: Arrays, Recursion, Linked Lists, Trees, Graph Traversal, Memoization`);
}

main().catch(err => {
  console.error("❌ Seed script failed:", err.message || err);
  process.exit(1);
});
