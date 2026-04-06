import { useEffect, useRef, useState } from "react";

interface Props {
  onComplete: () => void;
  matchData?: {
    matched_student: { name: string; skill_level: number; is_ai?: boolean; avatar?: string };
    shared_weak_concepts: string[];
    source: string;
  };
}

export default function MatchCountdown({ onComplete, matchData }: Props) {
  const [count, setCount] = useState(3);
  const [phase, setPhase] = useState<"analyzing" | "waiting" | "found" | "countdown">("analyzing");
  const [analysisStep, setAnalysisStep] = useState(0);
  const completedRef = useRef(false);

  const analysisMessages = [
    "Scanning skill graph...",
    "Traversing 4-hop network...",
    "Calculating weakness overlap...",
    "Generating problem...",
    "Opponent found!"
  ];

  // Phase 1: run through analysis messages
  useEffect(() => {
    let step = 0;
    const iv = setInterval(() => {
      step += 1;
      setAnalysisStep(step);
      if (step >= analysisMessages.length - 1) {
        clearInterval(iv);
        // If match data already here, go to found. Otherwise wait.
        if (matchData) {
          setPhase("found");
          setTimeout(() => setPhase("countdown"), 1200);
        } else {
          setPhase("waiting");
        }
      }
    }, 500);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 2: once matchData arrives while waiting, advance to found
  useEffect(() => {
    if (phase === "waiting" && matchData) {
      setPhase("found");
      setTimeout(() => setPhase("countdown"), 1200);
    }
  }, [matchData, phase]);

  // Phase 3: countdown → fire onComplete once
  useEffect(() => {
    if (phase !== "countdown") return;
    if (count === 0) {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count, onComplete]);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(10,10,15,0.92)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      zIndex: 1000, gap: "24px", backdropFilter: "blur(14px)"
    }}>

      {(phase === "analyzing" || phase === "waiting") && (
        <div style={{ textAlign: "center", maxWidth: "400px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "20px", color: "#c7d2fe" }}>◈</div>
          <div style={{ color: "#c7d2fe", fontSize: "1.25rem", fontWeight: 700, marginBottom: "28px" }}>
            {phase === "waiting" ? "Generating your problem..." : "Finding your perfect match..."}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {analysisMessages.map((msg, i) => (
              <div key={i} style={{
                color: i < analysisStep ? "#86efac" : i === analysisStep ? "#c7d2fe" : "#334155",
                fontSize: "0.95rem", transition: "color 0.3s",
                display: "flex", alignItems: "center", gap: "10px", justifyContent: "center"
              }}>
                <span style={{ width: "16px", textAlign: "center" }}>
                  {i < analysisStep ? "✓" : i === analysisStep ? "›" : "·"}
                </span>
                {msg}
              </div>
            ))}
          </div>

          {phase === "waiting" && (
            <div style={{ marginTop: "24px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              <div style={{
                width: "20px", height: "20px",
                border: "2px solid rgba(99,102,241,0.2)", borderTopColor: "#6366f1",
                borderRadius: "50%", animation: "mc-spin 0.8s linear infinite"
              }} />
              <span style={{ color: "#475569", fontSize: "0.85rem" }}>
                AI is crafting a problem tailored to your weak spots...
              </span>
            </div>
          )}

          <div style={{ marginTop: "20px", color: "#475569", fontSize: "0.8rem" }}>
            Powered by TigerGraph ⚡
          </div>
        </div>
      )}

      {phase === "found" && matchData && (
        <div style={{ textAlign: "center", animation: "mc-fadeIn 0.5s" }}>
          <div style={{ fontSize: "3rem", marginBottom: "14px" }}>
            {matchData.matched_student.avatar || "◉"}
          </div>
          <div style={{ color: "#86efac", fontSize: "1.4rem", fontWeight: 700, marginBottom: "6px" }}>
            {matchData.matched_student.is_ai ? "Challenge Accepted!" : "Match Found!"}
          </div>
          <div style={{ color: "#f1f5f9", fontSize: "2rem", fontWeight: 900, marginBottom: "8px" }}>
            {matchData.matched_student.name}
          </div>
          <div style={{ color: "#94a3b8", fontSize: "0.95rem", marginBottom: "16px" }}>
            {matchData.matched_student.is_ai
              ? `Difficulty: Skill Level ${matchData.matched_student.skill_level}`
              : `Skill Level: ${matchData.matched_student.skill_level}`}
          </div>
          {matchData.shared_weak_concepts.length > 0 && (
            <div style={{
              background: "#111118", borderRadius: "12px", padding: "10px 20px",
              color: "#c7d2fe", border: "1px solid rgba(99,102,241,0.22)", fontSize: "0.9rem"
            }}>
              Focus: {matchData.shared_weak_concepts.slice(0, 3).join(", ")}
            </div>
          )}
          <div style={{ marginTop: "10px", fontSize: "0.75rem", color: matchData.source === "graph-matched" ? "#86efac" : "#94a3b8" }}>
            {matchData.source === "graph-matched" ? "● Graph Matched" : "● Demo Mode"}
          </div>
        </div>
      )}

      {phase === "countdown" && (
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: "8rem", fontWeight: 900, lineHeight: 1,
            color: count === 1 ? "#ef4444" : count === 2 ? "#f59e0b" : "#22c55e",
            animation: "mc-pulse 0.9s infinite"
          }}>
            {count}
          </div>
          <div style={{ color: "#f1f5f9", fontSize: "1.4rem", marginTop: "12px", fontWeight: 700 }}>
            Get Ready!
          </div>
        </div>
      )}

      <style>{`
        @keyframes mc-fadeIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
        @keyframes mc-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes mc-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
