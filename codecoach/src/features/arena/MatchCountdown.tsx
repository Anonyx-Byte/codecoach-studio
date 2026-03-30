import { useEffect, useState } from "react";

interface Props {
  onComplete: () => void;
  matchData?: {
    matched_student: { name: string; skill_level: number };
    shared_weak_concepts: string[];
    source: string;
  };
}

export default function MatchCountdown({ onComplete, matchData }: Props) {
  const [count, setCount] = useState(3);
  const [phase, setPhase] = useState<"analyzing"|"found"|"countdown">("analyzing");
  const [analysisStep, setAnalysisStep] = useState(0);

  const analysisMessages = [
    "🔍 Scanning skill graph...",
    "🕸️ Traversing 4-hop network...",
    "📊 Calculating weakness overlap...",
    "⚡ Ranking by vector similarity...",
    "✅ Opponent found!"
  ];

  useEffect(() => {
    // Phase 1: Show graph analysis messages
    let step = 0;
    const analysisInterval = setInterval(() => {
      step++;
      setAnalysisStep(step);
      if (step >= analysisMessages.length - 1) {
        clearInterval(analysisInterval);
        setPhase("found");
        // Phase 2: Show match result briefly
        setTimeout(() => setPhase("countdown"), 1500);
      }
    }, 400);
    return () => clearInterval(analysisInterval);
  }, []);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count === 0) {
      onComplete();
      return;
    }
    const timer = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, count]);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.85)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      zIndex: 1000, gap: "24px"
    }}>
      {phase === "analyzing" && (
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: "48px", marginBottom: "24px"
          }}>🧠</div>
          <div style={{
            color: "#f97316", fontSize: "20px",
            fontWeight: "600", marginBottom: "32px"
          }}>
            Finding your perfect match...
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {analysisMessages.map((msg, i) => (
              <div key={i} style={{
                color: i <= analysisStep ? "#22c55e" : "#374151",
                fontSize: "16px",
                transition: "color 0.3s",
                display: "flex", alignItems: "center", gap: "8px"
              }}>
                <span>{i < analysisStep ? "✓" : i === analysisStep ? "▶" : "○"}</span>
                {msg}
              </div>
            ))}
          </div>
          <div style={{
            marginTop: "24px",
            color: "#6b7280", fontSize: "13px"
          }}>
            Powered by TigerGraph ⚡
          </div>
        </div>
      )}

      {phase === "found" && matchData && (
        <div style={{ textAlign: "center", animation: "fadeIn 0.5s" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🎯</div>
          <div style={{
            color: "#22c55e", fontSize: "24px",
            fontWeight: "700", marginBottom: "8px"
          }}>
            Match Found!
          </div>
          <div style={{
            color: "white", fontSize: "32px",
            fontWeight: "800", marginBottom: "8px"
          }}>
            {matchData.matched_student.name}
          </div>
          <div style={{ color: "#9ca3af", fontSize: "16px", marginBottom: "16px" }}>
            Skill Level: {matchData.matched_student.skill_level}
          </div>
          <div style={{
            background: "#1f2937", borderRadius: "8px",
            padding: "12px 24px", color: "#f97316"
          }}>
            Shared weakness: {matchData.shared_weak_concepts.join(", ")}
          </div>
          <div style={{
            marginTop: "12px", fontSize: "12px",
            color: matchData.source === "graph-matched"
              ? "#22c55e" : "#6b7280"
          }}>
            {matchData.source === "graph-matched"
              ? "⚡ Graph Matched" : "🎲 Demo Mode"}
          </div>
        </div>
      )}

      {phase === "countdown" && (
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: "120px", fontWeight: "900",
            color: count === 1 ? "#ef4444"
              : count === 2 ? "#f97316" : "#22c55e",
            lineHeight: 1,
            animation: "pulse 0.9s infinite"
          }}>
            {count}
          </div>
          <div style={{
            color: "white", fontSize: "24px",
            marginTop: "16px", fontWeight: "600"
          }}>
            Get Ready!
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}