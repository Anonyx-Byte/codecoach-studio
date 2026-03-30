import { useEffect, useRef, useState } from "react";
import { Network } from "vis-network/standalone";
import { useSkillGraph } from "./useSkillGraph";

type SkillIntelligenceResponse = {
  root_cause?: string;
  recommended_topics?: { id: string; name: string }[];
  prerequisites?: { id: string; name: string }[];
};

type PageRankResponse = {
  top_concepts?: { id: string; name: string; score?: number }[];
};

const BASE = import.meta.env.VITE_API_BASE_URL || "";

const badgeStyle = {
  position: "absolute" as const,
  padding: "8px 12px",
  borderRadius: "999px",
  fontSize: "0.85rem",
  fontWeight: 700
};

export default function SkillMapPage() {
  const studentId = localStorage.getItem("userId") || "s001";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { nodes, edges, loading, error, refetch, source } = useSkillGraph(studentId);
  const [insights, setInsights] = useState<SkillIntelligenceResponse>({});
  const [topConcepts, setTopConcepts] = useState<Array<{ id: string; name: string; score?: number }>>([]);
  const [panelLoading, setPanelLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadInsights() {
      setPanelLoading(true);

      try {
        const [skillResponse, pagerankResponse] = await Promise.all([
          fetch(`${BASE}/api/graph/skill-intelligence`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ studentId })
          }),
          fetch(`${BASE}/api/graph/pagerank`)
        ]);

        const skillData = skillResponse.ok ? (await skillResponse.json()) as SkillIntelligenceResponse : {};
        const pagerankData = pagerankResponse.ok ? (await pagerankResponse.json()) as PageRankResponse : {};

        if (active) {
          setInsights(skillData || {});
          setTopConcepts(Array.isArray(pagerankData.top_concepts) ? pagerankData.top_concepts.slice(0, 5) : []);
        }
      } catch {
        if (active) {
          setInsights({});
          setTopConcepts([]);
        }
      } finally {
        if (active) {
          setPanelLoading(false);
        }
      }
    }

    loadInsights();
    const timer = window.setInterval(() => {
      refetch();
      loadInsights();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [studentId, refetch]);

  useEffect(() => {
    if (!containerRef.current || !nodes.length) return;

    const network = new Network(
      containerRef.current,
      {
        nodes,
        edges
      },
      {
        layout: {
          hierarchical: {
            enabled: true,
            direction: "UD",
            levelSeparation: 130,
            nodeSpacing: 150
          }
        },
        edges: {
          arrows: {
            to: {
              enabled: true
            }
          },
          smooth: {
            enabled: true,
            type: "cubicBezier",
            roundness: 0.45
          },
          color: "#94a3b8",
          font: {
            align: "middle",
            color: "#cbd5e1"
          }
        },
        nodes: {
          shape: "dot",
          font: {
            color: "#f8fafc",
            face: "Inter, sans-serif",
            size: 16
          }
        },
        interaction: {
          dragNodes: true,
          zoomView: true
        },
        physics: false
      }
    );

    return () => network.destroy();
  }, [nodes, edges]);

  return (
    <section
      style={{
        position: "relative",
        minHeight: "70vh",
        padding: "24px",
        borderRadius: "24px",
        background: "#0f172a",
        color: "#f8fafc",
        border: "1px solid rgba(148, 163, 184, 0.18)"
      }}
    >
      <div style={{ marginBottom: "20px" }}>
        <h2 style={{ margin: 0, color: "#f8fafc" }}>Your Skill Intelligence Map</h2>
        <p style={{ margin: "8px 0 0", color: "#cbd5e1" }}>
          Graph Intelligence powered by TigerGraph {"\u26A1"}
        </p>
      </div>

      <div
        style={{
          ...badgeStyle,
          top: "20px",
          right: "20px",
          background: source === "tigergraph" ? "#166534" : "#f97316",
          color: "#f8fafc"
        }}
      >
        {source === "tigergraph" ? "\u25CF Live Graph" : "\u25CF Demo Mode"}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 0.9fr)",
          gap: "20px",
          alignItems: "start"
        }}
      >
        <div>
          {loading ? (
            <div
              style={{
                minHeight: "58vh",
                borderRadius: "20px",
                background: "linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(51, 65, 85, 0.75))",
                padding: "24px",
                display: "grid",
                gap: "14px"
              }}
            >
              {[70, 92, 84, 62, 78].map((width, index) => (
                <div
                  key={`${width}-${index}`}
                  style={{
                    height: "18px",
                    width: `${width}%`,
                    borderRadius: "999px",
                    background: "rgba(148, 163, 184, 0.24)"
                  }}
                />
              ))}
            </div>
          ) : error ? (
            <div
              style={{
                padding: "16px",
                borderRadius: "16px",
                background: "rgba(127, 29, 29, 0.55)",
                color: "#fecaca"
              }}
            >
              {error}
            </div>
          ) : (
            <div
              ref={containerRef}
              style={{
                minHeight: "58vh",
                borderRadius: "20px",
                background: "rgba(15, 23, 42, 0.8)",
                border: "1px solid rgba(148, 163, 184, 0.2)"
              }}
            />
          )}

          <div
            style={{
              marginTop: "16px",
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "12px"
            }}
          >
            <article
              style={{
                padding: "16px",
                borderRadius: "16px",
                background: "rgba(30, 41, 59, 0.78)"
              }}
            >
              <strong style={{ color: "#fdba74" }}>{"\ud83c\udfaf Root Cause:"}</strong>
              <p style={{ margin: "8px 0 0", color: "#e2e8f0" }}>
                {insights.root_cause || "Not available yet"}
              </p>
            </article>
            <article
              style={{
                padding: "16px",
                borderRadius: "16px",
                background: "rgba(30, 41, 59, 0.78)"
              }}
            >
              <strong style={{ color: "#93c5fd" }}>{"\ud83d\udcda Study Next:"}</strong>
              <p style={{ margin: "8px 0 0", color: "#e2e8f0" }}>
                {insights.recommended_topics?.[0]?.name || "Recommended topic pending"}
              </p>
            </article>
            <article
              style={{
                padding: "16px",
                borderRadius: "16px",
                background: "rgba(30, 41, 59, 0.78)"
              }}
            >
              <strong style={{ color: "#fca5a5" }}>{"\u26A0\uFE0F Prerequisite Gap:"}</strong>
              <p style={{ margin: "8px 0 0", color: "#e2e8f0" }}>
                {insights.prerequisites?.[0]?.name || "No gap detected yet"}
              </p>
            </article>
          </div>
        </div>

        <aside
          style={{
            padding: "18px",
            borderRadius: "20px",
            background: "rgba(15, 23, 42, 0.75)",
            border: "1px solid rgba(148, 163, 184, 0.18)"
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: "12px" }}>Most Critical Prerequisites:</h3>
          {panelLoading ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {[1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  style={{
                    height: "16px",
                    borderRadius: "999px",
                    background: "rgba(148, 163, 184, 0.24)"
                  }}
                />
              ))}
            </div>
          ) : (
            <ol style={{ margin: 0, paddingLeft: "20px", color: "#e2e8f0" }}>
              {topConcepts.map((concept) => (
                <li key={concept.id} style={{ marginBottom: "12px" }}>
                  <div style={{ fontWeight: 700 }}>{concept.name}</div>
                  <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
                    Score: {Number(concept.score || 0).toFixed(2)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      <div
        style={{
          ...badgeStyle,
          right: "20px",
          bottom: "20px",
          background: "#f97316",
          color: "#fff7ed"
        }}
      >
        Powered by TigerGraph {"\u26A1"}
      </div>
    </section>
  );
}
