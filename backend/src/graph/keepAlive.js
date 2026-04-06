const { ping, runQuery } = require("./tigergraphClient");

const TG_WAKE_COOLDOWN_MS = Number(process.env.TG_WAKE_COOLDOWN_MS || 120000);
let wakePromise = null;
let lastWakeAttemptAt = 0;
let lastWakeResult = false;

function canWakeTigerGraph() {
  return process.env.DEMO_MODE !== "true" && Boolean(process.env.TG_HOST) && Boolean(process.env.TG_SECRET);
}

// Only ping when a request comes in, not on a timer
async function wakeOnDemand() {
  if (!canWakeTigerGraph()) {
    return false;
  }

  let alive = await ping();
  if (!alive) {
    console.warn("[TigerGraph] Sleeping, attempting wake...");
    // Retry once after 35 seconds
    await new Promise((r) => setTimeout(r, 35000));
    alive = await ping();
  }

  if (alive) {
    runQuery("skillIntelligence", { s: "s001" }).catch(() => {});
  }

  return alive;
}

function triggerWakeOnDemand() {
  if (!canWakeTigerGraph()) {
    return Promise.resolve(false);
  }

  if (wakePromise) {
    return wakePromise;
  }

  const now = Date.now();
  if (lastWakeAttemptAt && now - lastWakeAttemptAt < TG_WAKE_COOLDOWN_MS) {
    return Promise.resolve(lastWakeResult);
  }

  lastWakeAttemptAt = now;
  wakePromise = wakeOnDemand()
    .then((alive) => {
      lastWakeResult = alive;
      return alive;
    })
    .catch((err) => {
      console.warn("[TigerGraph] Wake trigger failed:", err?.message || err);
      lastWakeResult = false;
      return false;
    })
    .finally(() => {
      wakePromise = null;
    });

  return wakePromise;
}

function startKeepAlive() {
  // Don't start any interval
  // TigerGraph wakes automatically via Auto-Resume
  // when REST calls hit it
  console.log("[KeepAlive] On-demand mode active");
}

module.exports = { startKeepAlive, wakeOnDemand, triggerWakeOnDemand };
