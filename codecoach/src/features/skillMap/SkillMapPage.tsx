import { useEffect, useMemo, useRef, useState } from "react";
import { Network } from "vis-network/standalone";
import { useSkillGraph } from "./useSkillGraph";
import { getApiBase } from "../../lib/apiBase";

// ─── Types ────────────────────────────────────────────────────────────────────

type SkillIntelligenceResponse = {
  root_cause?: string;
  recommended_topics?: { id: string; name: string }[];
  prerequisites?: { id: string; name: string; weakness_score?: number }[];
  weak_concepts?: { id: string; name: string; weakness_score?: number }[];
};

type PageRankResponse = {
  top_concepts?: { id: string; name: string; score?: number }[];
};

type SelectedNode = {
  id: string;
  label: string;
  weakness_score: number;
  color: string;
};

type KnowledgeDebtResponse = {
  knowledge_debt?: { concept_id: string; name: string; debt_score: number; blocks_count: number }[];
  total_debt?: number;
  debt_level?: string;
  optimal_path?: string[];
  source?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE = getApiBase(import.meta.env.VITE_API_BASE_URL);

/** If the AI returned JSON instead of plain text, extract readable content from it */
function cleanAIResponse(text: string): string {
  if (!text) return text;
  // Check if it looks like JSON (with or without markdown fences)
  const trimmed = text.trim();
  let jsonStr = trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) jsonStr = fenceMatch[1];
  else if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) return text;

  try {
    const parsed = JSON.parse(jsonStr);
    // Handle { learning_plan: [...] } or { steps: [...] } etc.
    const arr = parsed.learning_plan || parsed.steps || parsed.plan || (Array.isArray(parsed) ? parsed : null);
    if (Array.isArray(arr)) {
      return arr.map((item: unknown, i: number) => {
        if (typeof item === "string") return `${i + 1}. ${item}`;
        if (typeof item === "object" && item !== null) {
          const o = item as Record<string, unknown>;
          const step = o.step || o.title || o.topic || "";
          const desc = o.description || o.detail || o.task || o.tasks || "";
          return `${i + 1}. ${step}${desc ? " — " + (Array.isArray(desc) ? (desc as string[]).join(", ") : desc) : ""}`;
        }
        return `${i + 1}. ${String(item)}`;
      }).join("\n\n");
    }
    // Single object with string values
    if (typeof parsed === "object") {
      return Object.entries(parsed)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: ${Array.isArray(v) ? (v as string[]).join(", ") : String(v)}`)
        .join("\n\n");
    }
  } catch { /* not JSON, return as-is */ }
  return text;
}

function toneFromColor(color: string) {
  const v = String(color || "").toLowerCase();
  if (/ef4444|f87171|dc2626|red/.test(v))   return { bg: "#ef4444", border: "#f87171", shadow: "rgba(239,68,68,0.72)",   highlight: "#fecaca", tier: "critical" as const };
  if (/22c55e|4ade80|16a34a|green/.test(v)) return { bg: "#22c55e", border: "#86efac", shadow: "rgba(34,197,94,0.38)",   highlight: "#dcfce7", tier: "strong"   as const };
  if (/f59e0b|fbbf24|d97706|orange/.test(v))return { bg: "#f59e0b", border: "#fcd34d", shadow: "rgba(245,158,11,0.42)", highlight: "#fef3c7", tier: "needs"    as const };
  return                                           { bg: "#6366f1", border: "#a5b4fc", shadow: "rgba(99,102,241,0.48)", highlight: "#e0e7ff", tier: "prereq"   as const };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SkillMapPage() {
  const user      = JSON.parse(localStorage.getItem("user") || "{}");
  const studentId = String(user.studentId || user.id || localStorage.getItem("userId") || "s001");
  const containerRef   = useRef<HTMLDivElement | null>(null);
  const networkRef     = useRef<Network | null>(null);
  const { nodes, edges, loading, error, refetch, source } = useSkillGraph(studentId);

  const [insights, setInsights]       = useState<SkillIntelligenceResponse>({});
  const [topConcepts, setTopConcepts] = useState<Array<{ id: string; name: string; score?: number }>>([]);
  const [panelLoading, setPanelLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [analyzeOpen, setAnalyzeOpen]   = useState(false);
  const [analyzeText, setAnalyzeText]   = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainText, setExplainText]   = useState("");
  const [debtData, setDebtData]         = useState<KnowledgeDebtResponse>({});
  const [flowchartOpen, setFlowchartOpen] = useState(false);
  const [flowchartLoading, setFlowchartLoading] = useState(false);
  const [flowchartData, setFlowchartData] = useState<{
    nodes: { id: string; label: string; type: string; x: number; y: number }[];
    edges: { from: string; to: string }[];
    recommendations: Record<string, string>;
    root_cause: string;
  } | null>(null);

  // ── Styled nodes ──────────────────────────────────────────────────────────
  const styledNodes = useMemo(() =>
    nodes.map((node) => {
      const tone = toneFromColor(node.color);
      return {
        ...node,
        size: Math.max(20, node.size),
        color: {
          background: tone.bg,
          border: tone.border,
          highlight: { background: tone.bg, border: tone.highlight },
          hover:     { background: tone.bg, border: tone.highlight }
        },
        borderWidth: tone.tier === "critical" ? 3 : 2,
        shadow: { enabled: true, color: tone.shadow, size: tone.tier === "critical" ? 22 : 10, x: 0, y: 0 },
        font:  { color: "#f1f5f9", size: 14, face: "monospace" }
      };
    }),
  [nodes]);

  // ── Load insights + pagerank ──────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    async function load() {
      setPanelLoading(true);
      try {
        const [sr, pr, dr] = await Promise.all([
          fetch(`${BASE}/api/graph/skill-intelligence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId })
          }),
          fetch(`${BASE}/api/graph/pagerank`),
          fetch(`${BASE}/api/graph/knowledge-debt/${studentId}`)
        ]);
        const skillData    = sr.ok ? ((await sr.json()) as SkillIntelligenceResponse) : {};
        const pagerankData = pr.ok ? ((await pr.json()) as PageRankResponse) : {};
        const debt         = dr.ok ? ((await dr.json()) as KnowledgeDebtResponse) : {};
        if (active) {
          setInsights(skillData || {});
          setTopConcepts(Array.isArray(pagerankData.top_concepts) ? pagerankData.top_concepts.slice(0, 5) : []);
          setDebtData(debt || {});
        }
      } catch {
        if (active) { setInsights({}); setTopConcepts([]); }
      } finally {
        if (active) setPanelLoading(false);
      }
    }
    load();
    const timer = window.setInterval(() => { refetch(); load(); }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [studentId, refetch]);

  // ── Build vis.js network ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !styledNodes.length) return;

    if (networkRef.current) { networkRef.current.destroy(); networkRef.current = null; }

    const network = new Network(
      containerRef.current,
      { nodes: styledNodes, edges },
      {
        nodes: {
          shape: "dot",
          font: { color: "#f1f5f9", size: 14, face: "monospace" },
          borderWidth: 2,
          shadow: { enabled: true, color: "rgba(99,102,241,0.3)", size: 10 }
        },
        edges: {
          arrows: { to: { enabled: true, scaleFactor: 0.8 } },
          color:  { color: "#334155", highlight: "#6366f1" },
          smooth: { enabled: true, type: "cubicBezier", roundness: 0.4 },
          font:   { color: "#64748b", size: 11, align: "middle" },
          width: 2
        },
        physics: {
          enabled: true,
          solver: "forceAtlas2Based",
          forceAtlas2Based: {
            gravitationalConstant: -50,
            springLength: 150,
            springConstant: 0.08
          },
          stabilization: { iterations: 150 }
        },
        layout: { improvedLayout: true },
        interaction: { hover: true, tooltipDelay: 200, zoomView: true, dragNodes: true },
        background: { color: "#0a0a0f" }
      } as ConstructorParameters<typeof Network>[2]
    );

    networkRef.current = network;

    network.on("click", (params) => {
      if (params.nodes.length === 0) { setSelectedNode(null); return; }
      const nodeId = String(params.nodes[0]);
      const raw = styledNodes.find((n) => String(n.id) === nodeId);
      if (!raw) return;
      const rawOriginal = nodes.find((n) => String(n.id) === nodeId);
      setExplainText("");
      setSelectedNode({
        id: nodeId,
        label: String(raw.label || nodeId),
        weakness_score: Math.round((Number(rawOriginal?.size || 20) - 20) * 5 / 5),
        color: rawOriginal?.color || "#6366f1"
      });
    });

    return () => {
      if (networkRef.current) { networkRef.current.destroy(); networkRef.current = null; }
    };
  }, [styledNodes, edges, nodes]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleAnalyzeGraph() {
    setAnalyzeOpen(true);
    setAnalyzeLoading(true);
    setAnalyzeText("");
    try {
      const resp = await fetch(`${BASE}/api/graph/skill-intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId })
      });
      const data = resp.ok ? await resp.json() : {};
      const summary = `Weak concepts: ${(data.weak_concepts || []).map((c: { name: string }) => c.name).join(", ") || "none"}.
Prerequisites: ${(data.prerequisites || []).map((c: { name: string }) => c.name).join(", ") || "none"}.
Root cause: ${data.root_cause || "unknown"}.`;

      const authToken = localStorage.getItem("codecoach-auth-token");
      const askHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) askHeaders.Authorization = `Bearer ${authToken}`;

      const askResp = await fetch(`${BASE}/api/ask`, {
        method: "POST",
        headers: askHeaders,
        body: JSON.stringify({
          question: `Based on this skill graph: ${summary}\nGive me a 3-step personalized learning plan. For each step, write one clear sentence about what to study and why. Do NOT return JSON — just plain numbered text.`,
          code: "",
          outputLanguage: "English",
          history: [],
          studentId
        })
      });
      const askData = askResp.ok ? await askResp.json() : {};
      setAnalyzeText(cleanAIResponse(String(askData.answer || "Could not generate plan.")));
    } catch {
      setAnalyzeText("Could not generate analysis. Make sure the backend is running.");
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function handleExplainConcept(conceptName: string) {
    setExplainLoading(true);
    setExplainText("");
    try {
      const resp = await fetch(`${BASE}/api/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: `// Concept: ${conceptName}`, codeLanguage: "javascript", outputLanguage: "English" })
      });
      const data = resp.ok ? await resp.json() : {};
      setExplainText(String(data.summary || data.explanation || data.answer || "No explanation available."));
    } catch {
      setExplainText("Could not load explanation.");
    } finally {
      setExplainLoading(false);
    }
  }

  async function handleFlowchart() {
    setFlowchartOpen(true);
    if (flowchartData) return; // already loaded
    setFlowchartLoading(true);
    try {
      const resp = await fetch(`${BASE}/api/graph/learning-flowchart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId })
      });
      if (!resp.ok) throw new Error();
      const data = await resp.json();
      setFlowchartData(data);
    } catch {
      setFlowchartData(null);
    } finally {
      setFlowchartLoading(false);
    }
  }

  const weaknessBarColor = (score: number) =>
    score > 60 ? "#ef4444" : score > 30 ? "#f59e0b" : "#22c55e";

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <section style={{
      position: "relative", minHeight: "calc(100vh - 72px)",
      padding: "24px 28px", background: "#0a0a0f",
      color: "#f1f5f9",
    }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "14px", marginBottom: "22px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "clamp(1.6rem,2.5vw,2.2rem)", color: "#f1f5f9", letterSpacing: "-0.03em" }}>
            Skill Intelligence Map
          </h2>
          <p style={{ margin: "6px 0 0", color: "#475569", fontSize: "0.9rem" }}>
            Graph traversal powered by TigerGraph
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleAnalyzeGraph}
            style={{
              padding: "10px 18px", borderRadius: "12px", fontWeight: 700,
              border: "1px solid rgba(99,102,241,0.28)",
              background: "linear-gradient(135deg, #6366f1, #7c3aed)",
              color: "#fff", cursor: "pointer", fontSize: "0.88rem",
            }}
          >
            AI Analyze My Graph
          </button>
          <button
            type="button"
            onClick={handleFlowchart}
            style={{
              padding: "10px 18px", borderRadius: "12px", fontWeight: 700,
              border: "1px solid rgba(34,197,94,0.28)",
              background: "linear-gradient(135deg, #059669, #22c55e)",
              color: "#fff", cursor: "pointer", fontSize: "0.88rem",
            }}
          >
            Learning Flowchart
          </button>
          <button type="button" onClick={refetch} style={{
            padding: "9px 14px", borderRadius: "10px", fontSize: "0.82rem",
            border: "1px solid #2a2a3d", background: "#161622",
            color: "#94a3b8", cursor: "pointer"
          }}>
            Refresh
          </button>
          <span style={{
            padding: "8px 14px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 700,
            background: source === "tigergraph" ? "rgba(34,197,94,0.12)" : "rgba(99,102,241,0.12)",
            color:      source === "tigergraph" ? "#4ade80"              : "#c7d2fe",
            border: `1px solid ${source === "tigergraph" ? "rgba(34,197,94,0.22)" : "rgba(99,102,241,0.22)"}`,
          }}>
            {"\u25CF"} {source === "tigergraph" ? "Live Graph" : "Demo Mode"}
          </span>
        </div>
      </div>

      {/* ── Knowledge Debt Banner ── */}
      {(debtData.total_debt ?? 0) > 0 && (() => {
        const level = String(debtData.debt_level || "moderate");
        const levelColor = level === "critical" ? "#ef4444" : level === "high" ? "#f59e0b" : "#6366f1";
        const levelBg    = level === "critical" ? "rgba(239,68,68,0.1)" : level === "high" ? "rgba(245,158,11,0.1)" : "rgba(99,102,241,0.1)";
        const levelBorder= level === "critical" ? "rgba(239,68,68,0.22)" : level === "high" ? "rgba(245,158,11,0.22)" : "rgba(99,102,241,0.22)";
        return (
          <div style={{
            marginBottom: "20px", padding: "16px 20px", borderRadius: "16px",
            background: levelBg, border: `1px solid ${levelBorder}`,
            display: "flex", alignItems: "flex-start", gap: "16px", flexWrap: "wrap"
          }}>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: levelColor, marginBottom: "4px" }}>
                Knowledge Debt · <span style={{ textTransform: "capitalize" }}>{level}</span>
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: levelColor }}>
                {debtData.total_debt ?? 0} pts
              </div>
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              {Array.isArray(debtData.knowledge_debt) && debtData.knowledge_debt.length > 0 && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                  {debtData.knowledge_debt.slice(0, 4).map((d) => (
                    <span key={d.concept_id} style={{
                      padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600,
                      background: "rgba(0,0,0,0.2)", color: levelColor,
                      border: `1px solid ${levelBorder}`
                    }}>
                      {d.name} <span style={{ opacity: 0.7 }}>×{d.debt_score}</span>
                    </span>
                  ))}
                </div>
              )}
              {Array.isArray(debtData.optimal_path) && debtData.optimal_path.length > 0 && (
                <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                  <span style={{ color: "#64748b" }}>Optimal path: </span>
                  {debtData.optimal_path.join(" → ")}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Main grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "20px", alignItems: "start" }}>

        {/* LEFT: graph + legend + insights */}
        <div style={{ display: "grid", gap: "16px" }}>

          {/* Graph container */}
          {loading ? (
            <div style={{
              height: "60vh", borderRadius: "20px", border: "1px solid #1e1e2e",
              background: "#111118", display: "grid", placeItems: "center",
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "36px", height: "36px", margin: "0 auto 14px",
                  border: "3px solid rgba(99,102,241,0.2)", borderTopColor: "#6366f1",
                  borderRadius: "50%", animation: "sm-spin 0.8s linear infinite"
                }} />
                <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>Loading graph...</p>
              </div>
            </div>
          ) : error ? (
            <div style={{
              padding: "20px", borderRadius: "16px",
              background: "rgba(239,68,68,0.1)", color: "#fca5a5",
              border: "1px solid rgba(239,68,68,0.22)"
            }}>
              {error}
            </div>
          ) : (
            <div
              ref={containerRef}
              style={{
                height: "60vh", borderRadius: "20px",
                background: "#0a0a0f",
                backgroundImage: "linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px)",
                backgroundSize: "28px 28px",
                border: "1px solid #1e1e2e",
                boxShadow: "inset 0 0 60px rgba(0,0,0,0.4)",
              }}
            />
          )}

          {/* Legend */}
          <div style={{
            display: "flex", gap: "10px", flexWrap: "wrap", padding: "12px 16px",
            borderRadius: "14px", background: "#111118", border: "1px solid #1e1e2e",
          }}>
            {[
              { color: "#ef4444", label: "Critical weakness (>60)" },
              { color: "#f59e0b", label: "Needs work (30–60)" },
              { color: "#22c55e", label: "Strong (0–30)" },
              { color: "#6366f1", label: "Prerequisite" },
            ].map(({ color, label }) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "0.8rem", color: "#94a3b8" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, flexShrink: 0 }} />
                {label}
              </span>
            ))}
          </div>

          {/* Insight cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            {[
              { label: "Root Cause",       color: "#fbbf24", value: insights.root_cause               || "Pending" },
              { label: "Study Next",       color: "#a5b4fc", value: insights.recommended_topics?.[0]?.name || "Pending" },
              { label: "Prerequisite Gap", color: "#f87171", value: insights.prerequisites?.[0]?.name || "None detected" },
            ].map(({ label, color, value }) => (
              <article key={label} style={{
                padding: "14px 16px", borderRadius: "14px",
                background: "#111118", border: "1px solid #1e1e2e",
              }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "6px" }}>
                  {label}
                </div>
                <div style={{ color: "#f1f5f9", fontWeight: 600 }}>{panelLoading ? "..." : value}</div>
              </article>
            ))}
          </div>
        </div>

        {/* RIGHT: PageRank panel + selected node panel */}
        <div style={{ display: "grid", gap: "14px" }}>

          {/* PageRank */}
          <aside style={{
            padding: "18px", borderRadius: "18px",
            background: "#111118", border: "1px solid #1e1e2e",
          }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "5px 10px", borderRadius: "999px", marginBottom: "12px",
              background: "rgba(99,102,241,0.1)", color: "#c7d2fe",
              fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em"
            }}>
              TigerGraph Ranking
            </div>
            <h3 style={{ margin: "0 0 14px", color: "#f1f5f9", fontSize: "1rem" }}>
              Most Critical Prerequisites
            </h3>
            {panelLoading ? (
              <div style={{ display: "grid", gap: "10px" }}>
                {[1,2,3,4,5].map((i) => (
                  <div key={i} style={{ height: "14px", borderRadius: "999px", background: "rgba(99,102,241,0.12)" }} />
                ))}
              </div>
            ) : (
              <ol style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "10px" }}>
                {topConcepts.map((c) => (
                  <li key={c.id}>
                    <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: "0.92rem" }}>{c.name}</div>
                    <div style={{ color: "#475569", fontSize: "0.8rem" }}>Score: {Number(c.score || 0).toFixed(2)}</div>
                  </li>
                ))}
              </ol>
            )}
          </aside>

          {/* Selected node panel */}
          {selectedNode && (
            <aside style={{
              padding: "18px", borderRadius: "18px",
              background: "#111118", border: "1px solid rgba(99,102,241,0.22)",
              boxShadow: "0 0 0 1px rgba(99,102,241,0.06), 0 16px 40px rgba(0,0,0,0.3)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                <h3 style={{ margin: 0, color: "#f1f5f9", fontSize: "1.05rem" }}>{selectedNode.label}</h3>
                <button type="button" onClick={() => setSelectedNode(null)} style={{
                  background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "1.1rem", padding: "0 4px"
                }}>×</button>
              </div>

              {/* Weakness bar */}
              <div style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "0.78rem", color: "#64748b" }}>Weakness score</span>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: weaknessBarColor(selectedNode.weakness_score) }}>
                    {selectedNode.weakness_score}%
                  </span>
                </div>
                <div style={{ height: "8px", borderRadius: "999px", background: "#1e1e2e", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: "999px",
                    width: `${Math.min(100, selectedNode.weakness_score)}%`,
                    background: weaknessBarColor(selectedNode.weakness_score),
                    transition: "width 0.4s ease"
                  }} />
                </div>
              </div>

              {/* Connections summary */}
              <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: "14px" }}>
                {edges.filter((e) => e.from === selectedNode.id).length > 0 && (
                  <p style={{ margin: "0 0 4px" }}>
                    Blocks <strong style={{ color: "#f1f5f9" }}>{edges.filter((e) => e.from === selectedNode.id).length}</strong> concept(s)
                  </p>
                )}
                {edges.filter((e) => e.to === selectedNode.id).length > 0 && (
                  <p style={{ margin: 0 }}>
                    Requires <strong style={{ color: "#f1f5f9" }}>
                      {edges.filter((e) => e.to === selectedNode.id).map((e) => {
                        const n = nodes.find((nd) => nd.id === e.from);
                        return n?.label || e.from;
                      }).join(", ")}
                    </strong>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleExplainConcept(selectedNode.label)}
                disabled={explainLoading}
                style={{
                  width: "100%", padding: "10px", borderRadius: "10px", fontWeight: 600,
                  border: "1px solid rgba(99,102,241,0.24)",
                  background: "rgba(99,102,241,0.1)", color: "#c7d2fe",
                  cursor: "pointer", fontSize: "0.85rem",
                  opacity: explainLoading ? 0.7 : 1,
                }}
              >
                {explainLoading ? "Loading..." : "Get AI Explanation"}
              </button>

              {explainText && (
                <div style={{
                  marginTop: "12px", padding: "12px", borderRadius: "10px",
                  background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.14)",
                  color: "#cbd5e1", fontSize: "0.84rem", lineHeight: 1.7, whiteSpace: "pre-wrap"
                }}>
                  {explainText}
                </div>
              )}
            </aside>
          )}

          {!selectedNode && (
            <div style={{
              padding: "16px", borderRadius: "14px",
              background: "#111118", border: "1px dashed #2a2a3d",
              color: "#334155", fontSize: "0.85rem", textAlign: "center"
            }}>
              Click a node to inspect it
            </div>
          )}
        </div>
      </div>

      {/* ── AI Analyze Modal ── */}
      {analyzeOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60,
          background: "rgba(5,5,10,0.88)", backdropFilter: "blur(10px)",
          display: "grid", placeItems: "center", padding: "24px"
        }}>
          <div style={{
            width: "min(620px, 100%)", padding: "28px 30px", borderRadius: "22px",
            background: "#111118", border: "1px solid rgba(99,102,241,0.24)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ margin: 0, color: "#f1f5f9", fontSize: "1.2rem" }}>AI Learning Plan</h2>
              <button type="button" onClick={() => setAnalyzeOpen(false)} style={{
                background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "1.4rem"
              }}>×</button>
            </div>

            {analyzeLoading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{
                  width: "36px", height: "36px", margin: "0 auto 12px",
                  border: "3px solid rgba(99,102,241,0.2)", borderTopColor: "#6366f1",
                  borderRadius: "50%", animation: "sm-spin 0.8s linear infinite"
                }} />
                <p style={{ margin: 0, color: "#475569" }}>Analyzing your skill graph...</p>
              </div>
            ) : (
              <div style={{
                padding: "18px", borderRadius: "14px",
                background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.14)",
                color: "#cbd5e1", lineHeight: 1.78, whiteSpace: "pre-wrap", fontSize: "0.93rem"
              }}>
                {analyzeText}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Learning Flowchart Modal ── */}
      {flowchartOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60,
          background: "rgba(5,5,10,0.88)", backdropFilter: "blur(10px)",
          display: "grid", placeItems: "center", padding: "24px",
          overflow: "auto",
        }}>
          <div style={{
            width: "min(820px, 100%)", padding: "28px 30px", borderRadius: "22px",
            background: "#111118", border: "1px solid rgba(34,197,94,0.24)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div>
                <h2 style={{ margin: 0, color: "#f1f5f9", fontSize: "1.2rem" }}>AI Learning Flowchart</h2>
                <p style={{ margin: "4px 0 0", color: "#475569", fontSize: "0.82rem" }}>
                  Personalized study path from TigerGraph traversal
                </p>
              </div>
              <button type="button" onClick={() => setFlowchartOpen(false)} style={{
                background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "1.4rem"
              }}>×</button>
            </div>

            {flowchartLoading ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{
                  width: "36px", height: "36px", margin: "0 auto 12px",
                  border: "3px solid rgba(34,197,94,0.2)", borderTopColor: "#22c55e",
                  borderRadius: "50%", animation: "sm-spin 0.8s linear infinite"
                }} />
                <p style={{ margin: 0, color: "#475569" }}>Generating learning path from your graph...</p>
              </div>
            ) : !flowchartData || !flowchartData.nodes?.length ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                Could not generate flowchart. Make sure TigerGraph is active.
              </div>
            ) : (() => {
              // Render SVG flowchart
              const fc = flowchartData;
              const COL_W = 160;
              const ROW_H = 90;
              const NODE_W = 140;
              const NODE_H = 44;

              // Calculate positions
              const maxY = Math.max(...fc.nodes.map(n => n.y));
              const svgW = Math.max(600, (Math.max(...fc.nodes.map(n => Math.abs(n.x))) * 2 + 1) * COL_W + 40);
              const svgH = (maxY + 1) * ROW_H + 40;
              const cx = svgW / 2;

              const nodePos = new Map<string, { px: number; py: number }>();
              fc.nodes.forEach(n => {
                const px = cx + n.x * COL_W;
                const py = 20 + n.y * ROW_H;
                nodePos.set(n.id, { px, py });
              });

              const typeColors: Record<string, { fill: string; stroke: string; text: string }> = {
                start:      { fill: "#1e3a2f", stroke: "#22c55e", text: "#4ade80" },
                prereq:     { fill: "#1e1e38", stroke: "#6366f1", text: "#a5b4fc" },
                checkpoint: { fill: "#1a2332", stroke: "#38bdf8", text: "#7dd3fc" },
                weak:       { fill: "#2e1f0f", stroke: "#f59e0b", text: "#fcd34d" },
                critical:   { fill: "#2e0f0f", stroke: "#ef4444", text: "#fca5a5" },
                goal:       { fill: "#0f2e1a", stroke: "#22c55e", text: "#86efac" },
              };

              return (
                <div style={{ overflow: "auto", borderRadius: "14px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", padding: "16px" }}>
                  <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", margin: "0 auto" }}>
                    <defs>
                      <marker id="fc-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
                      </marker>
                    </defs>

                    {/* Edges */}
                    {fc.edges.map((e, i) => {
                      const from = nodePos.get(e.from);
                      const to = nodePos.get(e.to);
                      if (!from || !to) return null;
                      return (
                        <line key={`e-${i}`}
                          x1={from.px} y1={from.py + NODE_H}
                          x2={to.px} y2={to.py}
                          stroke="#334155" strokeWidth={2}
                          markerEnd="url(#fc-arrow)"
                          opacity={0.7}
                        />
                      );
                    })}

                    {/* Nodes */}
                    {fc.nodes.map(n => {
                      const pos = nodePos.get(n.id)!;
                      const colors = typeColors[n.type] || typeColors.prereq;
                      const rec = fc.recommendations[n.label];
                      return (
                        <g key={n.id}>
                          <rect
                            x={pos.px - NODE_W / 2} y={pos.py}
                            width={NODE_W} height={NODE_H}
                            rx={n.type === "start" || n.type === "goal" ? 22 : n.type === "checkpoint" ? 8 : 12}
                            fill={colors.fill} stroke={colors.stroke} strokeWidth={2}
                          />
                          <text
                            x={pos.px} y={pos.py + (rec ? 17 : 24)}
                            textAnchor="middle" fill={colors.text}
                            fontSize={n.type === "start" || n.type === "goal" ? 13 : 12}
                            fontWeight={700} fontFamily="system-ui, sans-serif"
                          >
                            {n.label}
                          </text>
                          {rec && (
                            <text
                              x={pos.px} y={pos.py + 34}
                              textAnchor="middle" fill="#64748b"
                              fontSize={9} fontFamily="system-ui, sans-serif"
                            >
                              {rec.length > 28 ? rec.slice(0, 28) + "..." : rec}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>

                  {/* Legend */}
                  <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "14px", flexWrap: "wrap" }}>
                    {[
                      { color: "#22c55e", label: "Start / Goal" },
                      { color: "#6366f1", label: "Prerequisites" },
                      { color: "#38bdf8", label: "Checkpoints" },
                      { color: "#f59e0b", label: "Weak areas" },
                      { color: "#ef4444", label: "Critical gaps" },
                    ].map(l => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem", color: "#94a3b8" }}>
                        <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: l.color }} />
                        {l.label}
                      </div>
                    ))}
                  </div>

                  {/* Root cause callout */}
                  {fc.root_cause && (
                    <div style={{
                      marginTop: "14px", textAlign: "center",
                      padding: "10px 16px", borderRadius: "10px",
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)",
                      fontSize: "0.82rem", color: "#fca5a5"
                    }}>
                      Root cause: <strong>{fc.root_cause}</strong> — Start here for maximum impact
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* TigerGraph badge */}
      <div style={{
        position: "fixed", right: "20px", bottom: "20px", zIndex: 30,
        padding: "9px 14px", borderRadius: "999px",
        background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(17,17,24,0.96))",
        color: "#e2e8f0", border: "1px solid rgba(99,102,241,0.22)",
        boxShadow: "0 12px 32px rgba(99,102,241,0.14)", fontSize: "0.82rem", fontWeight: 600,
      }}>
        Powered by TigerGraph {"\u26A1"}
      </div>

      <style>{`
        @keyframes sm-spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .sm-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
