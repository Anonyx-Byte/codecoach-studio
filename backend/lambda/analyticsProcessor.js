const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1"
});

const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

exports.handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  console.log(`[analyticsProcessor] received records=${records.length}`);

  for (const rec of records) {
    try {
      if (rec?.eventName !== "INSERT") continue;

      const image = rec?.dynamodb?.NewImage;
      if (!image) {
        console.warn("[analyticsProcessor] missing NewImage on INSERT event");
        continue;
      }

      const item = unmarshall(image);
      const userId = String(item?.userId || "").trim();
      const type = String(item?.type || "").trim();
      const data = item?.data || {};
      const createdAt = String(item?.createdAt || data?.createdAt || new Date().toISOString());

      if (!userId) {
        console.warn("[analyticsProcessor] skipping record with missing userId");
        continue;
      }

      console.log(`[analyticsProcessor] userId=${userId} type=${type || "unknown"}`);

      if (type === "quiz_attempt") {
        await doc.send(new UpdateCommand({
          TableName: "Users",
          Key: { userId },
          UpdateExpression: "SET analyticsSummary.attemptsCount = if_not_exists(analyticsSummary.attemptsCount, :zero) + :inc, analyticsSummary.lastAttemptAt = :createdAt",
          ExpressionAttributeValues: {
            ":inc": 1,
            ":zero": 0,
            ":createdAt": createdAt
          }
        }));
        console.log(`[analyticsProcessor] attemptsCount incremented for userId=${userId}`);
      }
    } catch (err) {
      console.error("[analyticsProcessor] record processing failed:", err?.message || err);
    }
  }

  return { ok: true };
};
