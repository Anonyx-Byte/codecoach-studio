export function getApiBase(rawBase?: string) {
  const normalized = String(rawBase || "").trim().replace(/\/$/, "");
  return normalized.endsWith("/api") ? normalized.slice(0, -4) : normalized;
}

