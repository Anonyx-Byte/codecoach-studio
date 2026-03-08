const url = process.env.HEALTH_URL || "http://127.0.0.1:4000/api/health";

(async () => {
  try {
    const res = await fetch(url);
    const body = await res.text();
    console.log(`[health-check] status=${res.status}`);
    console.log(body);
    if (!res.ok) process.exit(1);
  } catch (err) {
    console.error("[health-check] request failed:", err?.message || err);
    process.exit(1);
  }
})();
