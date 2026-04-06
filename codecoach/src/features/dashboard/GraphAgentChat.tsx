import { useEffect, useRef, useState } from "react";

type GraphAgentResponse = {
  answer?: string | null;
  tools_used?: string[];
  graph_powered?: boolean;
  source?: string;
};

type ChatEntry = {
  role: "user" | "assistant";
  content: string;
  meta?: {
    source?: string;
    graphPowered?: boolean;
    toolsUsed?: string[];
  };
};

const BASE = (((import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } })?.env?.VITE_API_BASE_URL) || "").replace(/\/$/, "");

async function requestAgent(studentId: string, question: string): Promise<GraphAgentResponse> {
  const payload = JSON.stringify({ studentId, question });
  const graphRoute = `${BASE}/api/graph/agent-ask`;
  const fallbackRoute = `${BASE}/api/ask`;

  const graphResponse = await fetch(graphRoute, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  });

  if (graphResponse.ok) {
    return graphResponse.json() as Promise<GraphAgentResponse>;
  }

  if (graphResponse.status !== 404) {
    throw new Error(`Server error (${graphResponse.status})`);
  }

  const fallbackResponse = await fetch(fallbackRoute, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  });

  if (!fallbackResponse.ok) {
    throw new Error(`Server error (${fallbackResponse.status})`);
  }

  const fallbackData = await fallbackResponse.json() as GraphAgentResponse;
  return {
    answer: fallbackData.answer || "No answer returned.",
    tools_used: Array.isArray(fallbackData.tools_used) ? fallbackData.tools_used : [],
    graph_powered: Boolean(fallbackData.graph_powered),
    source: fallbackData.source || (fallbackData.graph_powered ? "langchain-graph-agent" : "general-ai-fallback")
  };
}

function getStoredStudentId() {
  try {
    const rawUser = localStorage.getItem("user");
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      const id = String(parsed?.studentId || parsed?.id || parsed?.userId || "").trim();
      if (id) return id;
    }
  } catch {}

  return localStorage.getItem("userId") || "s001";
}

export default function GraphAgentChat() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const studentId = getStoredStudentId();

  useEffect(() => {
    if (!open) return;

    const onClickOutside = (event: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function sendQuestion() {
    const prompt = question.trim();
    if (!prompt || loading) return;

    setLoading(true);
    setQuestion("");
    setMessages((prev) => [...prev.slice(-4), { role: "user", content: prompt }]);

    try {
      const data = await requestAgent(studentId, prompt);

      const content = data.answer
        ? String(data.answer)
        : data.graph_powered === false
          ? "Graph agent unavailable right now."
          : "No answer returned.";
      const toolsUsed = Array.isArray(data.tools_used) ? data.tools_used : [];

      setMessages((prev) => [
        ...prev.slice(-4),
        {
          role: "assistant",
          content,
          meta: {
            source: data.source,
            graphPowered: Boolean(data.graph_powered),
            toolsUsed
          }
        }
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev.slice(-4),
        {
          role: "assistant",
          content: err?.message || "Could not reach the graph agent right now.",
          meta: {
            source: "error",
            graphPowered: false,
            toolsUsed: []
          }
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          position: "fixed",
          right: "20px",
          bottom: "20px",
          zIndex: 70,
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 16px",
          borderRadius: "999px",
          border: "1px solid rgba(99, 102, 241, 0.28)",
          background: "linear-gradient(135deg, rgba(17,17,24,0.96), rgba(10,10,15,0.98))",
          color: "#e2e8f0",
          boxShadow: "0 18px 35px rgba(0,0,0,0.3)",
          cursor: "pointer",
          fontWeight: 700
        }}
      >
        <span>{"\uD83E\uDDE0"} Ask Graph AI</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            right: "20px",
            bottom: "74px",
            zIndex: 70,
            width: "300px",
            maxWidth: "calc(100vw - 40px)",
            borderRadius: "18px",
            background: "#0a0a0f",
            border: "1px solid rgba(129, 140, 248, 0.16)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            overflow: "hidden",
            color: "#e2e8f0"
          }}
        >
          <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f8fafc" }}>Graph AI</div>
            <div style={{ fontSize: "0.76rem", color: "#94a3b8", marginTop: "4px" }}>Student: {studentId}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px", maxHeight: "300px", overflowY: "auto" }}>
            {messages.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: "0.84rem", lineHeight: 1.5 }}>
                Ask for graph-backed help, prerequisite paths, or peer matches.
              </div>
            ) : null}

            {messages.map((msg, index) => (
              <div
                key={`${msg.role}-${index}-${msg.content.slice(0, 12)}`}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  padding: "10px 11px",
                  borderRadius: "14px",
                  background: msg.role === "user"
                    ? "rgba(99, 102, 241, 0.18)"
                    : "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)"
                }}
              >
                <div style={{ fontSize: "0.86rem", lineHeight: 1.5, color: "#f8fafc", whiteSpace: "pre-wrap" }}>
                  {msg.content}
                </div>

                {msg.role === "assistant" && msg.meta ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "9px" }}>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "999px",
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        background: msg.meta.graphPowered ? "rgba(34, 197, 94, 0.16)" : "rgba(148, 163, 184, 0.14)",
                        color: msg.meta.graphPowered ? "#86efac" : "#cbd5e1"
                      }}
                    >
                      {msg.meta.graphPowered ? "\u26A1 Graph-Powered" : "\uD83D\uDCAC General AI"}
                    </span>
                    {msg.meta.source ? (
                      <span style={{ padding: "3px 8px", borderRadius: "999px", fontSize: "0.68rem", fontWeight: 700, background: "rgba(255,255,255,0.06)", color: "#cbd5e1" }}>
                        {msg.meta.source}
                      </span>
                    ) : null}
                    {Array.isArray(msg.meta.toolsUsed) && msg.meta.toolsUsed.length > 0 ? (
                      <span style={{ padding: "3px 8px", borderRadius: "999px", fontSize: "0.68rem", fontWeight: 700, background: "rgba(245, 158, 11, 0.16)", color: "#fcd34d" }}>
                        Tools used: {msg.meta.toolsUsed.join(", ")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "8px", padding: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendQuestion();
                }
              }}
              placeholder="Ask about weak spots..."
              style={{
                flex: 1,
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                color: "#f8fafc",
                padding: "10px 12px",
                fontSize: "0.86rem",
                outline: "none"
              }}
            />
            <button
              type="button"
              onClick={() => void sendQuestion()}
              disabled={loading}
              style={{
                borderRadius: "12px",
                border: "1px solid rgba(99, 102, 241, 0.24)",
                background: loading ? "rgba(99, 102, 241, 0.34)" : "linear-gradient(135deg, rgba(99, 102, 241, 0.92), rgba(34, 197, 94, 0.72))",
                color: "#ffffff",
                padding: "10px 12px",
                fontWeight: 700,
                cursor: loading ? "wait" : "pointer",
                fontSize: "0.86rem"
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
