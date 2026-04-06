import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type HintPanelProps = {
  studentId: string;
  currentCode: string;
  problemId: string;
};

type SkillMapNode = {
  id: string;
  label: string;
  size: number;
};

type SkillMapEdge = {
  from: string;
  to: string;
};

type SkillMapResponse = {
  nodes?: SkillMapNode[];
  edges?: SkillMapEdge[];
};

type HintResponse = {
  hint?: string;
  hint_style?: string;
  adaptive?: boolean;
};

const BASE = getApiBase(import.meta.env.VITE_API_BASE_URL);

function getHintStyleLabel(hintStyle: string) {
  if (hintStyle === "advanced") return "\ud83d\udfe2 Advanced Mode";
  if (hintStyle === "beginner") return "\ud83d\udd35 Step-by-Step";
  return "\ud83d\udfe1 Guided Mode";
}

export function HintPanel({ studentId, currentCode, problemId }: HintPanelProps) {
  const [hint, setHint] = useState("");
  const [displayedHint, setDisplayedHint] = useState("");
  const [hintStyle, setHintStyle] = useState("intermediate");
  const [adaptive, setAdaptive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [graph, setGraph] = useState<SkillMapResponse>({});

  useEffect(() => {
    let active = true;

    async function loadSkillMap() {
      try {
        const response = await fetch(`${BASE}/api/graph/skill-map/${studentId}`);
        if (!response.ok) return;

        const data = (await response.json()) as SkillMapResponse;
        if (active) {
          setGraph({
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : []
          });
        }
      } catch {}
    }

    loadSkillMap();

    return () => {
      active = false;
    };
  }, [studentId]);

  useEffect(() => {
    if (!hint) {
      setDisplayedHint("");
      return;
    }

    const words = hint.split(/\s+/).filter(Boolean);
    let index = 0;
    setDisplayedHint("");

    const timer = window.setInterval(() => {
      index += 1;
      setDisplayedHint(words.slice(0, index).join(" "));
      if (index >= words.length) {
        window.clearInterval(timer);
      }
    }, 55);

    return () => window.clearInterval(timer);
  }, [hint]);

  const prerequisiteReason = useMemo(() => {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    if (!nodes.length || !edges.length) {
      return "No prerequisite chain available yet.";
    }

    const edge = edges[0];
    const targetNode = nodes.find((node) => node.id === edge.to);
    const sourceNode = nodes.find((node) => node.id === edge.from);

    if (!targetNode || !sourceNode) {
      return "No prerequisite chain available yet.";
    }

    const derivedScore = Math.max(0, Math.round((Number(sourceNode.size || 20) - 20) * 5));
    return `${targetNode.label} \u2192 requires \u2192 ${sourceNode.label} \u2192 you scored ${derivedScore}%`;
  }, [graph]);

  async function handleGetHint() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${BASE}/api/llm/hint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          studentId,
          code: currentCode,
          problemId
        })
      });

      if (!response.ok) {
        throw new Error(`Hint request failed (${response.status})`);
      }

      const data = (await response.json()) as HintResponse;
      setHint(String(data.hint || ""));
      setHintStyle(String(data.hint_style || "intermediate"));
      setAdaptive(Boolean(data.adaptive));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch hint");
      setHint("");
      setAdaptive(false);
      setHintStyle("intermediate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside
      style={{
        padding: "20px",
        borderRadius: "20px",
        background: "#111118",
        border: "1px solid #1e1e2e",
        color: "#e2e8f0",
        boxShadow: "0 20px 48px rgba(0, 0, 0, 0.24)"
      }}
    >
      <button
        type="button"
        onClick={handleGetHint}
        disabled={loading}
        style={{
          border: "1px solid rgba(99, 102, 241, 0.24)",
          borderRadius: "12px",
          padding: "12px 16px",
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          color: "#eff6ff",
          cursor: "pointer",
          fontWeight: 700
        }}
      >
        {loading ? "Loading Hint..." : "Get Hint"}
      </button>

      {error && (
        <p style={{ color: "#fca5a5", marginTop: "12px" }}>{error}</p>
      )}

      {hint && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                background: "rgba(99, 102, 241, 0.14)",
                color: "#c7d2fe",
                fontWeight: 700,
                fontSize: "0.9rem"
              }}
            >
              {getHintStyleLabel(hintStyle)}
            </span>
            {adaptive && (
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: "999px",
                  background: "rgba(34, 197, 94, 0.12)",
                  color: "#86efac",
                  fontWeight: 700,
                  fontSize: "0.9rem"
                }}
              >
                Graph-Powered
              </span>
            )}
          </div>
          <h3 style={{ marginBottom: "8px", color: "#f1f5f9" }}>Hint</h3>
          <p style={{ margin: 0, color: "#cbd5e1", lineHeight: 1.6 }}>{displayedHint}</p>
        </div>
      )}

      <div style={{ marginTop: "20px" }}>
        <h3 style={{ marginBottom: "8px", color: "#f1f5f9" }}>Why Am I Stuck?</h3>
        <p style={{ margin: 0, color: "#94a3b8" }}>{prerequisiteReason}</p>
      </div>
    </aside>
  );
}
