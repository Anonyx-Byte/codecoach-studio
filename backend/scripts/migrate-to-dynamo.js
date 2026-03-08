const fs = require("fs/promises");
const path = require("path");
const { BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");
const { initDynamo, ddbDocClient } = require("../libs/dynamo");

(async () => {
  try {
    initDynamo({ region: process.env.AWS_REGION });
    const doc = ddbDocClient();
    const dataPath = path.join(__dirname, "..", "data", "app-db.json");
    const raw = await fs.readFile(dataPath, "utf8");
    const db = JSON.parse(raw);
    const users = db.users || [];

    await fs.writeFile(`${dataPath}.backup.${Date.now()}.json`, raw, "utf8");

    async function sendBatches(tableName, items) {
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25);
        const RequestItems = {};
        RequestItems[tableName] = chunk.map((it) => ({ PutRequest: { Item: it } }));
        const resp = await doc.send(new BatchWriteCommand({ RequestItems }));
        if (resp?.UnprocessedItems && Object.keys(resp.UnprocessedItems).length) {
          console.warn("Some items unprocessed - you should retry those", resp.UnprocessedItems);
        }
      }
    }

    const userItems = users.map((u) => ({
      userId: u.id || u.userId || u.email,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt || new Date().toISOString(),
      profile: u.profile || {},
      analyticsSummary: {
        questionsAsked: (u.analytics && u.analytics.questionsAsked) || 0,
        badges: (u.analytics && u.analytics.badges) || []
      },
      passwordHash: u.passwordHash || undefined,
      passwordSalt: u.passwordSalt || undefined
    }));

    await sendBatches("Users", userItems);

    const analyticsItems = [];
    for (const u of users) {
      const attempts = (u.analytics && u.analytics.attempts) || [];
      for (const a of attempts) {
        analyticsItems.push({
          userId: u.id || u.userId || u.email,
          createdAt: a.createdAt || new Date().toISOString(),
          type: "quiz_attempt",
          data: a
        });
      }
    }
    if (analyticsItems.length) {
      await sendBatches("Analytics", analyticsItems);
    }

    console.log("Migration finished. Users:", userItems.length, "Analytics records:", analyticsItems.length);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
})();
