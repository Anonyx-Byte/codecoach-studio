const { ping, runQuery } = require("./tigergraphClient");

// Only ping when a request comes in, not on a timer
async function wakeOnDemand() {
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

function startKeepAlive() {
  // Don't start any interval
  // TigerGraph wakes automatically via Auto-Resume
  // when REST calls hit it
  console.log("[KeepAlive] On-demand mode active");
}

module.exports = { startKeepAlive, wakeOnDemand };
