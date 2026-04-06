const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "../../.env"),
  override: true
});
console.log("[TigerGraph] Config loaded:", {
  host: process.env.TG_HOST ? "present" : "MISSING",
  secret: process.env.TG_SECRET ? "present" : "MISSING",
  demo: process.env.DEMO_MODE
});

const axios = require("axios");

const TG_HOST = process.env.TG_HOST;
const TG_SECRET = process.env.TG_SECRET;
const TG_GRAPH = process.env.TG_GRAPH || "LearningGraph";
const DEMO_MODE = process.env.DEMO_MODE === "true";
const TG_REQUEST_TIMEOUT_MS = Number(process.env.TG_REQUEST_TIMEOUT_MS || 15000);

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry &&
      Date.now() < tokenExpiry) {
    return cachedToken;
  }
  try {
    const response = await axios.post(
      `${TG_HOST}/gsql/v1/tokens`,
      { secret: TG_SECRET },
      {
        headers: { "Content-Type": "application/json" },
        timeout: TG_REQUEST_TIMEOUT_MS
      }
    );
    const token = response.data?.token;
    if (!token) throw new Error("No token in response");
    cachedToken = token;
    // Token expires in 7 days, cache for 6 days
    tokenExpiry = Date.now() + (6 * 24 * 60 * 60 * 1000);
    console.log("[TigerGraph] Token refreshed ✓");
    return cachedToken;
  } catch (err) {
    console.error("[TigerGraph] Token fetch failed:",
      err.response?.data || err.message);
    return null;
  }
}

async function runQuery(queryName, params = {}) {
  if (DEMO_MODE) return null;
  try {
    const token = await getToken();
    if (!token) {
      console.warn("[TigerGraph] No token, using demo mode");
      return null;
    }
    const queryString = Object.entries(params)
      .map(([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const url = `${TG_HOST}/restpp/query/${TG_GRAPH}/${queryName}${queryString ? "?" + queryString : ""}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: TG_REQUEST_TIMEOUT_MS
    });
    return response.data;
  } catch (err) {
    console.error(
      `[TigerGraph] Query ${queryName} failed:`,
      err.response?.data || err.message
    );
    return null;
  }
}

async function ping() {
  try {
    const response = await axios.get(
      `${TG_HOST}/restpp/echo`,
      { timeout: TG_REQUEST_TIMEOUT_MS }
    );
    return response.data?.error === false;
  } catch {
    return false;
  }
}

module.exports = { runQuery, ping, getToken };
