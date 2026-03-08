const {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  waitUntilTableExists,
  UpdateTimeToLiveCommand
} = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand
} = require("@aws-sdk/lib-dynamodb");

let ddb;
let docClient;

function initDynamo({ region } = {}) {
  const resolvedRegion = region || process.env.AWS_REGION || "us-east-1";
  if (docClient) {
    return { ddb, docClient };
  }
  console.log(`[dynamo] init region=${resolvedRegion}`);
  ddb = new DynamoDBClient({ region: resolvedRegion });
  docClient = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true }
  });
  return { ddb, docClient };
}

function ddbDocClient() {
  if (!docClient) {
    initDynamo({ region: process.env.AWS_REGION });
  }
  return docClient;
}

function isMissingTableError(err) {
  const code = String(err?.name || err?.Code || err?.code || "");
  const msg = String(err?.message || "");
  return code.includes("ResourceNotFound") || msg.includes("Cannot do operations on a non-existent table");
}

async function ensureTable(tableName, createParams) {
  if (!ddb) initDynamo({ region: process.env.AWS_REGION });
  try {
    await ddb.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`[dynamo] table exists: ${tableName}`);
    return;
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.error(`[dynamo] describe failed for ${tableName}:`, err?.message || err);
      throw err;
    }
  }

  console.log(`[dynamo] creating table: ${tableName}`);
  await ddb.send(new CreateTableCommand(createParams));
  await waitUntilTableExists(
    { client: ddb, maxWaitTime: 120 },
    { TableName: tableName }
  );
  console.log(`[dynamo] table ready: ${tableName}`);
}

async function ensureTablesIfNeeded() {
  if (!ddb) initDynamo({ region: process.env.AWS_REGION });

  await ensureTable("Users", {
    TableName: "Users",
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "email", AttributeType: "S" }
    ],
    KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "email-index",
        KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" }
      }
    ]
  });

  await ensureTable("Analytics", {
    TableName: "Analytics",
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "S" }
    ],
    KeySchema: [
      { AttributeName: "userId", KeyType: "HASH" },
      { AttributeName: "createdAt", KeyType: "RANGE" }
    ]
  });

  await ensureTable("Sessions", {
    TableName: "Sessions",
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "sessionId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "sessionId", KeyType: "HASH" }]
  });

  try {
    await ddb.send(new UpdateTimeToLiveCommand({
      TableName: "Sessions",
      TimeToLiveSpecification: {
        Enabled: true,
        AttributeName: "ttl"
      }
    }));
    console.log("[dynamo] TTL ensured on Sessions.ttl");
  } catch (err) {
    console.warn("[dynamo] TTL setup warning:", err?.message || err);
  }
}

async function putUser(user) {
  try {
    return await ddbDocClient().send(new PutCommand({ TableName: "Users", Item: user }));
  } catch (err) {
    console.error("[dynamo] putUser failed:", err?.message || err);
    throw err;
  }
}

async function updateUser(key, updateExpression, values, names) {
  try {
    return await ddbDocClient().send(new UpdateCommand({
      TableName: "Users",
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: values,
      ...(names ? { ExpressionAttributeNames: names } : {})
    }));
  } catch (err) {
    console.error("[dynamo] updateUser failed:", err?.message || err);
    throw err;
  }
}

async function putAnalyticsAttempt(record) {
  try {
    return await ddbDocClient().send(new PutCommand({
      TableName: "Analytics",
      Item: record
    }));
  } catch (err) {
    console.error("[dynamo] putAnalyticsAttempt failed:", err?.message || err);
    throw err;
  }
}

module.exports = {
  initDynamo,
  ensureTablesIfNeeded,
  ddbDocClient,
  putUser,
  updateUser,
  putAnalyticsAttempt
};
