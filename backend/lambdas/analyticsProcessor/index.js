const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  UpdateCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const doc = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  console.log("Received events:", JSON.stringify(event.Records?.length));
  for (const rec of event.Records || []) {
    try {
      if (rec.eventName !== "INSERT") continue;
      const newImg = rec.dynamodb.NewImage;
      const userId = newImg.userId.S || newImg.userId;
      await doc.send(new UpdateCommand({
        TableName: "Users",
        Key: { userId },
        UpdateExpression: "SET analyticsSummary.questionsAsked = if_not_exists(analyticsSummary.questionsAsked, :zero) + :inc",
        ExpressionAttributeValues: { ":inc": 1, ":zero": 0 }
      }));
    } catch (err) {
      console.error("Lambda processing failed:", err);
    }
  }
  return { ok: true };
};
