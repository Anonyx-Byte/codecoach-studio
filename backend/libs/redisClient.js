const Redis = require("ioredis");

let redisClient;

function initRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }
  redisClient = new Redis(url, { maxRetriesPerRequest: 2 });
  redisClient.on("connect", () => console.log("Redis connected"));
  redisClient.on("error", (err) => console.error("Redis error:", err && err.message));
  return redisClient;
}

function redis() {
  return redisClient;
}

async function incrementWithExpiry(key, ttlSeconds) {
  const client = initRedis();
  if (!client) return null;
  if (!key) throw new Error("key is required");
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");

  const value = await client.incr(key);
  if (value === 1) {
    await client.expire(key, ttl);
  }
  return value;
}

async function closeRedis() {
  if (!redisClient) return;
  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  } finally {
    redisClient = null;
  }
}

module.exports = {
  initRedis,
  redis,
  incrementWithExpiry,
  closeRedis
};
