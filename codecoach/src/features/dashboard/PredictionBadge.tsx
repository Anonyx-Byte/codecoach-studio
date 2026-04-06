import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type PredictionRow = {
  concept?: string;
  predicted_score?: number;
  reason?: string;
  will_struggle?: boolean;
};

type PredictionResponse = {
  predictions?: PredictionRow[];
  source?: string;
};

const BASE = getApiBase(import.meta.env.VITE_API_BASE_URL);

function scoreColor(score: number) {
  if (score < 40) return "#ef4444";
  if (score < 60) return "#f59e0b";
  return "#22c55e";
}

function barGradient(score: number) {
  const color = scoreColor(score);
  return `linear-gradient(90deg, ${color}, rgba(255,255,255,0.12))`;
}

export default function PredictionBadge() {
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPredictions() {
      try {
        const response = await fetch(`${BASE}/api/graph/predict/s001`);
        if (!response.ok) {
          throw new Error(`Prediction fetch failed: ${response.status}`);
        }

        const data = (await response.json()) as PredictionResponse;
        if (active) {
          setPredictions(Array.isArray(data.predictions) ? data.predictions.slice(0, 3) : []);
          setError("");
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || "Could not load predictions");
          setPredictions([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPredictions();

    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "16px",
        borderRadius: "18px",
        background: "#0a0a0f",
        border: "1px solid rgba(129, 140, 248, 0.16)",
        boxShadow: "0 18px 40px rgba(0, 0, 0, 0.28)",
        color: "#e2e8f0"
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, color: "#f8fafc" }}>{"\uD83D\uDD2E"} Predicted Struggles</div>
        <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Graph message passing prediction</div>
      </div>

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>Loading graph predictions...</div>
      ) : error ? (
        <div style={{ color: "#fca5a5", fontSize: "0.88rem" }}>{error}</div>
      ) : predictions.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {predictions.map((item, index) => {
            const score = Math.max(0, Math.min(100, Number(item.predicted_score || 0)));
            const color = scoreColor(score);

            return (
              <div key={`${item.concept || "concept"}-${index}`} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ fontSize: "0.92rem", fontWeight: 700, color: "#f8fafc" }}>{item.concept || "Unknown concept"}</span>
                  <span style={{ fontSize: "0.82rem", color }}>{score}/100</span>
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    borderRadius: "999px",
                    overflow: "hidden",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.04)"
                  }}
                >
                  <div
                    style={{
                      width: `${score}%`,
                      height: "100%",
                      borderRadius: "999px",
                      background: barGradient(score),
                      boxShadow: `0 0 18px ${color}33`
                    }}
                  />
                </div>
                {item.reason ? (
                  <div style={{ fontSize: "0.8rem", lineHeight: 1.4, color: "#94a3b8" }}>{item.reason}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>No predictions available yet.</div>
      )}

      <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "#64748b" }}>Powered by TigerGraph {"\u26A1"}</div>
    </section>
  );
}
