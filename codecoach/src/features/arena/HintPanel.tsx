import { useEffect, useMemo, useState } from "react";

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

const BASE = import.meta.env.VITE_API_BASE_URL || "";

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
        background: "#f8fafc",
        border: "1px solid rgba(148, 163, 184, 0.3)"
      }}
    >
      <button
        type="button"
        onClick={handleGetHint}
        disabled={loading}
        style={{
          border: 0,
          borderRadius: "12px",
          padding: "12px 16px",
          background: "#2563eb",
          color: "#eff6ff",
          cursor: "pointer",
          fontWeight: 700
        }}
      >
        {loading ? "Loading Hint..." : "Get Hint"}
      </button>

      {error && (
        <p style={{ color: "#b91c1c", marginTop: "12px" }}>{error}</p>
      )}

      {hint && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                background: "#e2e8f0",
                color: "#0f172a",
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
                  background: "#dcfce7",
                  color: "#166534",
                  fontWeight: 700,
                  fontSize: "0.9rem"
                }}
              >
                Graph-Powered
              </span>
            )}
          </div>
          <h3 style={{ marginBottom: "8px", color: "#0f172a" }}>Hint</h3>
          <p style={{ margin: 0, color: "#334155", lineHeight: 1.6 }}>{displayedHint}</p>
        </div>
      )}

      <div style={{ marginTop: "20px" }}>
        <h3 style={{ marginBottom: "8px", color: "#0f172a" }}>Why Am I Stuck?</h3>
        <p style={{ margin: 0, color: "#475569" }}>{prerequisiteReason}</p>
      </div>
    </aside>
  );
}
