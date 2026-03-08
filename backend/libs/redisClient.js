const Redis = require("ioredis");

let redisClient;
const inMemoryCache = new Map();

function pruneExpiredMemoryEntries() {
  const now = Date.now();
  for (const [key, entry] of inMemoryCache.entries()) {
    if (entry.expiresAt && entry.expiresAt <= now) {
      inMemoryCache.delete(key);
    }
  }
}

function setMemory(key, value, ttlSeconds) {
  const ttl = Number(ttlSeconds || 0);
  const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
  inMemoryCache.set(String(key), { value: String(value), expiresAt });
}

function getMemory(key) {
  pruneExpiredMemoryEntries();
  const entry = inMemoryCache.get(String(key));
  return entry ? entry.value : null;
}

function createRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL || process.env.REDIS;
  if (!url) {
    console.warn("REDIS_URL not configured. Falling back to in-memory cache.");
    return null;
  }

  redisClient = new Redis(url, {
    connectTimeout: 10000,
    commandTimeout: 2500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 5,
    retryStrategy(times) {
      return Math.min(times * 100, 2000);
    }
  });

  redisClient.on("connect", () => console.log("Redis connected"));
  redisClient.on("ready", () => console.log("Redis ready"));
  redisClient.on("reconnecting", (delay) => console.warn("Redis reconnecting in", delay, "ms"));
  redisClient.on("end", () => console.warn("Redis connection ended"));
  redisClient.on("error", (err) => console.error("Redis error:", err && err.message));

  return redisClient;
}

function initRedis() {
  return createRedisClient();
}

function getRedis() {
  return redisClient;
}

function redis() {
  return getRedis();
}

async function safeSet(key, value, ttlSeconds = 60) {
  if (!key) return false;
  const client = getRedis() || createRedisClient();

  if (!client) {
    setMemory(key, value, ttlSeconds);
    return true;
  }

  try {
    const ttl = Number(ttlSeconds || 0);
    if (ttl > 0) {
      await client.set(String(key), String(value), "EX", ttl);
    } else {
      await client.set(String(key), String(value));
    }
    return true;
  } catch (err) {
    console.error("Redis safeSet failed, using memory fallback:", err?.message || err);
    setMemory(key, value, ttlSeconds);
    return false;
  }
}

async function safeGet(key) {
  if (!key) return null;
  const client = getRedis();

  if (!client) {
    return getMemory(key);
  }

  try {
    const value = await client.get(String(key));
    return value == null ? getMemory(key) : value;
  } catch (err) {
    console.error("Redis safeGet failed, using memory fallback:", err?.message || err);
    return getMemory(key);
  }
}

async function incrementWithExpiry(key, ttlSeconds) {
  const client = initRedis();
  if (!key) throw new Error("key is required");
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");
  if (!client) {
    const current = Number(getMemory(key) || 0) + 1;
    setMemory(key, String(current), ttl);
    return current;
  }

  try {
    const value = await client.incr(key);
    if (value === 1) {
      await client.expire(key, ttl);
    }
    return value;
  } catch (err) {
    console.error("Redis incrementWithExpiry failed, using memory fallback:", err?.message || err);
    const current = Number(getMemory(key) || 0) + 1;
    setMemory(key, String(current), ttl);
    return current;
  }
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
  createRedisClient,
  getRedis,
  initRedis,
  redis,
  safeSet,
  safeGet,
  incrementWithExpiry,
  closeRedis
};
