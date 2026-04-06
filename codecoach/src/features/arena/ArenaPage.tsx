import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CollabEditor } from "./CollabEditor";
import MatchCountdown from "./MatchCountdown";

// ─── Types ────────────────────────────────────────────────────────────────────

type ArenaProblem = {
  title: string;
  description: string;
  examples: string;
  constraints: string;
  difficulty: string;
  timeLimit: number;
  hints: string[];
  conceptsTested: string[];
};

type ArenaOpponent = {
  id: string;
  name: string;
  skill_level: number;
  is_ai?: boolean;
  avatar?: string;
};

type ArenaMatch = {
  matched_student: ArenaOpponent;
  shared_weak_concepts: string[];
  final_score: number;
  source: string;
  problem: ArenaProblem;
  roomId: string;
  ai_solve_time_seconds?: number;
};

type SubmitResult = {
  score: number;
  passed_tests: number;
  total_tests: number;
  winner: string | null;
};

type AiResult = {
  user_score: number;
  ai_score: number;
  winner: "user" | "ai" | "tie";
  ai_solution: string;
  ai_time: number;
  user_time: number;
  passed_tests: number;
  total_tests: number;
  message: string;
};

type Phase = "idle" | "searching" | "contest" | "results" | "analysis";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const DIFF_STYLE: Record<string, { bg: string; color: string }> = {
  Easy:   { bg: "rgba(34,197,94,0.12)",  color: "#4ade80" },
  Medium: { bg: "rgba(245,158,11,0.14)", color: "#fbbf24" },
  Hard:   { bg: "rgba(239,68,68,0.12)",  color: "#f87171" },
};

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function tryParseAIJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* continue */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) { try { return JSON.parse(fence[1]); } catch { /* continue */ } }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* continue */ } }
  return null;
}

function renderAnalysisContent(raw: string) {
  const parsed = tryParseAIJson(raw);
  if (!parsed) {
    // Plain text — render directly
    return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{raw}</div>;
  }

  // Flatten nested structure (e.g., { coachingAnalysis: { ... } })
  const data: Record<string, unknown> = (parsed.coachingAnalysis ?? parsed.coaching_analysis ?? parsed) as Record<string, unknown>;

  const sections: { label: string; content: unknown }[] = [];
  const labelMap: Record<string, string> = {
    whatTheyDidWell: "What You Did Well",
    mainAreaForImprovement: "Areas for Improvement",
    optimalApproach: "Optimal Approach",
    specificTip: "Pro Tip",
    encouragementMessage: "Keep Going!",
    strengths: "Strengths",
    weaknesses: "Weaknesses",
    suggestions: "Suggestions",
    feedback: "Feedback",
    score: "Score",
  };

  for (const [key, val] of Object.entries(data)) {
    if (!val) continue;
    sections.push({ label: labelMap[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), content: val });
  }

  if (sections.length === 0) return <div>{raw}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {sections.map((sec) => (
        <div key={sec.label}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            {sec.label}
          </div>
          {Array.isArray(sec.content) ? (
            <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {(sec.content as string[]).map((item, i) => <li key={i} style={{ color: "#e2e8f0", lineHeight: 1.6 }}>{String(item)}</li>)}
            </ul>
          ) : (
            <div style={{ color: "#e2e8f0", lineHeight: 1.7 }}>{String(sec.content)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ArenaPage() {
  const navigate   = useNavigate();
  const rawUser    = JSON.parse(localStorage.getItem("user") || "{}");
  const studentId  = String(rawUser.studentId || rawUser.id || localStorage.getItem("userId") || "s001");

  // Phase & data
  const [phase, setPhase]                     = useState<Phase>("idle");
  const [match, setMatch]                     = useState<ArenaMatch | null>(null);
  const [result, setResult]                   = useState<SubmitResult | null>(null);
  const [aiResultData, setAiResultData]       = useState<AiResult | null>(null);
  const [analysis, setAnalysis]               = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [isAiMatch, setIsAiMatch]             = useState(false);

  // Contest UI state
  const [error, setError]                 = useState("");
  const [language, setLanguage]           = useState("javascript");
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [timeLeft, setTimeLeft]           = useState(0);
  const [submitting, setSubmitting]       = useState(false);
  const [aiProgress, setAiProgress]       = useState(0);
  const [aiDone, setAiDone]               = useState(false);

  // Stable refs
  const matchRef       = useRef<ArenaMatch | null>(null);
  const codeRef        = useRef("// Write your solution here\n");
  const languageRef    = useRef("javascript");
  const timerRef       = useRef<number | null>(null);
  const aiTimerRef     = useRef<number | null>(null);
  const timeLeftRef    = useRef(0);
  const submittingRef  = useRef(false);
  const isAiMatchRef   = useRef(false);
  const doSubmitRef    = useRef<() => void>(() => {});

  languageRef.current = language;

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current)   clearInterval(timerRef.current);
    if (aiTimerRef.current) clearInterval(aiTimerRef.current);
  }, []);

  // ── Timer helpers ────────────────────────────────────────────────────────────

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function stopAiTimer() {
    if (aiTimerRef.current) { clearInterval(aiTimerRef.current); aiTimerRef.current = null; }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function doSubmit() {
    if (submittingRef.current) return;
    const m = matchRef.current;
    if (!m) return;

    submittingRef.current = true;
    setSubmitting(true);
    stopTimer();
    stopAiTimer();

    const totalTime = (m.problem?.timeLimit ?? 20) * 60;
    const timeTaken = Math.max(0, totalTime - timeLeftRef.current);

    try {
      if (isAiMatchRef.current) {
        const resp = await fetch(`${BASE}/api/arena/ai-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId: m.roomId, studentId,
            code: codeRef.current,
            language: languageRef.current,
            timeTaken,
          }),
        });
        if (!resp.ok) throw new Error(`Submit failed (${resp.status})`);
        const data = (await resp.json()) as AiResult;
        setAiResultData(data);
        setResult({
          score:        data.user_score,
          passed_tests: data.passed_tests,
          total_tests:  data.total_tests,
          winner:       data.winner === "user" ? studentId : null,
        });
      } else {
        const resp = await fetch(`${BASE}/api/arena/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId: m.roomId, studentId,
            code: codeRef.current,
            language: languageRef.current,
            timeTaken,
          }),
        });
        if (!resp.ok) throw new Error(`Submit failed (${resp.status})`);
        const data = (await resp.json()) as SubmitResult;
        setResult(data);
      }
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  doSubmitRef.current = doSubmit;

  // ── Countdown complete — called when searching → contest ─────────────────────

  const onCountdownComplete = useCallback(() => {
    // If match already loaded, start immediately
    if (matchRef.current) {
      startContest(matchRef.current);
      return;
    }
    // Otherwise poll until match arrives (AI match can take 30-50s)
    let waited = 0;
    const POLL_MS = 400;
    const MAX_WAIT_MS = 90000;
    const poll = window.setInterval(() => {
      waited += POLL_MS;
      if (matchRef.current) {
        window.clearInterval(poll);
        startContest(matchRef.current);
      } else if (waited >= MAX_WAIT_MS) {
        window.clearInterval(poll);
        setError("Match timed out. Please try again.");
        setPhase("idle");
      }
    }, POLL_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startContest(m: ArenaMatch) {
    const totalSeconds = (m.problem?.timeLimit ?? 20) * 60;
    setPhase("contest");

    // Contest countdown
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(totalSeconds);
    timeLeftRef.current = totalSeconds;
    timerRef.current = window.setInterval(() => {
      timeLeftRef.current -= 1;
      const remaining = timeLeftRef.current;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
        doSubmitRef.current();
      }
    }, 1000);

    // AI progress bar
    if (isAiMatchRef.current) {
      const aiTime = m.ai_solve_time_seconds || Math.round(totalSeconds * 0.6);
      setAiProgress(0);
      setAiDone(false);
      let elapsed = 0;
      const TICK = 100; // ms
      if (aiTimerRef.current) clearInterval(aiTimerRef.current);
      aiTimerRef.current = window.setInterval(() => {
        elapsed += TICK / 1000;
        const pct = Math.min(100, (elapsed / aiTime) * 100);
        setAiProgress(pct);
        if (pct >= 100) {
          clearInterval(aiTimerRef.current!);
          aiTimerRef.current = null;
          setAiDone(true);
        }
      }, TICK);
    }
  }

  // ── Match actions ─────────────────────────────────────────────────────────────

  function resetState() {
    stopTimer();
    stopAiTimer();
    matchRef.current      = null;
    isAiMatchRef.current  = false;
    submittingRef.current = false;
    codeRef.current       = "// Write your solution here\n";
    setMatch(null);
    setPhase("idle");
    setResult(null);
    setAiResultData(null);
    setAnalysis("");
    setError("");
    setHintsRevealed(0);
    setIsAiMatch(false);
    setAiProgress(0);
    setAiDone(false);
  }

  async function handleFindHumanMatch() {
    resetState();
    setPhase("searching");

    try {
      const resp = await fetch(`${BASE}/api/arena/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, embedding: [] }),
      });
      if (!resp.ok) throw new Error(`Match failed (${resp.status})`);
      const data = (await resp.json()) as ArenaMatch;
      matchRef.current = data;
      setMatch(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find match");
      setPhase("idle");
    }
  }

  async function handleFindAiMatch() {
    resetState();
    setIsAiMatch(true);
    isAiMatchRef.current = true;
    setPhase("searching");

    try {
      const resp = await fetch(`${BASE}/api/arena/ai-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      if (!resp.ok) throw new Error(`AI match failed (${resp.status})`);
      const data = await resp.json() as {
        opponent: ArenaOpponent;
        problem: ArenaProblem;
        roomId: string;
        ai_solve_time_seconds: number;
        shared_weak_concepts: string[];
        source: string;
      };

      // Normalize into ArenaMatch shape
      const normalized: ArenaMatch = {
        matched_student:      data.opponent,
        shared_weak_concepts: data.shared_weak_concepts || [],
        final_score:          0,
        source:               data.source || "graph-matched",
        problem:              data.problem,
        roomId:               data.roomId,
        ai_solve_time_seconds: data.ai_solve_time_seconds,
      };
      matchRef.current = normalized;
      setMatch(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start AI match");
      setPhase("idle");
      setIsAiMatch(false);
      isAiMatchRef.current = false;
    }
  }

  async function handleAnalyze() {
    if (!result) return;
    const m = matchRef.current;
    setPhase("analysis");
    setAnalysisLoading(true);
    try {
      const resp = await fetch(`${BASE}/api/arena/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          code:         codeRef.current,
          problemTitle: m?.problem?.title || "",
          score:        result.score,
          weak_concepts: m?.shared_weak_concepts || [],
          language:     languageRef.current,
        }),
      });
      if (!resp.ok) throw new Error();
      const data = (await resp.json()) as { analysis: string };
      setAnalysis(data.analysis || "");
    } catch {
      setAnalysis("Could not load analysis. Keep practicing!");
    } finally {
      setAnalysisLoading(false);
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────

  // STATE 2: searching
  if (phase === "searching") {
    return (
      <MatchCountdown
        onComplete={onCountdownComplete}
        matchData={match ?? undefined}
      />
    );
  }

  // STATE 1: idle — two buttons
  if (phase === "idle") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "62vh", padding: "28px", textAlign: "center",
      }}>
        <div style={{
          width: "72px", height: "72px", margin: "0 auto 28px", borderRadius: "22px",
          display: "grid", placeItems: "center", fontSize: "2rem",
          background: "linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.14))",
          border: "1px solid rgba(99,102,241,0.3)",
          boxShadow: "0 0 0 8px rgba(99,102,241,0.06)",
        }}>⚔</div>

        <h1 style={{
          margin: "0 0 12px", fontWeight: 900, color: "#f1f5f9",
          fontSize: "clamp(2rem,4vw,2.8rem)", letterSpacing: "-0.04em",
        }}>
          Live Coding Arena
        </h1>
        <p style={{ margin: "0 auto 36px", color: "#94a3b8", fontSize: "1.05rem", maxWidth: "460px" }}>
          Battle a peer or challenge the AI — both opponents are matched to your exact weak spots
        </p>

        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", justifyContent: "center", marginBottom: "24px" }}>
          <button
            type="button"
            onClick={handleFindHumanMatch}
            style={{
              padding: "18px 44px", fontSize: "1.08rem", fontWeight: 800,
              borderRadius: "16px", border: "1px solid rgba(99,102,241,0.28)",
              background: "linear-gradient(135deg, #6366f1, #7c3aed)", color: "#fff",
              cursor: "pointer", boxShadow: "0 18px 36px rgba(99,102,241,0.28)",
              letterSpacing: "-0.01em",
            }}
          >
            ⚔️ Find Human Match
          </button>

          <button
            type="button"
            onClick={handleFindAiMatch}
            style={{
              padding: "18px 44px", fontSize: "1.08rem", fontWeight: 800,
              borderRadius: "16px", border: "1px solid rgba(245,158,11,0.3)",
              background: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(239,68,68,0.12))",
              color: "#fbbf24",
              cursor: "pointer", boxShadow: "0 18px 36px rgba(245,158,11,0.12)",
              letterSpacing: "-0.01em",
            }}
          >
            🤖 Compete vs AI
          </button>
        </div>

        {error && (
          <div style={{
            marginTop: "4px", padding: "12px 20px", borderRadius: "14px", maxWidth: "400px",
            background: "rgba(239,68,68,0.12)", color: "#fca5a5",
            border: "1px solid rgba(239,68,68,0.24)", fontSize: "0.92rem",
          }}>
            {error}
          </div>
        )}

        <div style={{
          display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "20px",
          padding: "10px 18px", borderRadius: "999px",
          border: "1px solid rgba(99,102,241,0.2)",
          background: "rgba(99,102,241,0.07)",
          color: "#a5b4fc", fontSize: "0.88rem", fontWeight: 700,
        }}>
          <span style={{ color: "#f59e0b" }}>⚡</span>
          Powered by TigerGraph
        </div>
      </div>
    );
  }

  // STATE 3: contest active
  if (phase === "contest" && match) {
    const problem  = match.problem;
    const diff     = problem?.difficulty || "Medium";
    const diffSty  = DIFF_STYLE[diff] ?? DIFF_STYLE.Medium;
    const isUrgent = timeLeft > 0 && timeLeft < 300;
    const opponent = match.matched_student;

    return (
      <div style={{ padding: "18px 24px" }}>
        {/* ── Header bar ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: "18px", gap: "12px", flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h2 style={{ margin: 0, color: "#f1f5f9", fontSize: "1.1rem" }}>
              {isAiMatch ? "🤖 vs AI Contest" : "Arena Contest"}
            </h2>
            <span style={{
              padding: "4px 10px", borderRadius: "999px", fontSize: "0.72rem", fontWeight: 700,
              background: match.source === "graph-matched" ? "rgba(34,197,94,0.12)" : "rgba(99,102,241,0.12)",
              color:      match.source === "graph-matched" ? "#4ade80"              : "#c7d2fe",
              border: `1px solid ${match.source === "graph-matched" ? "rgba(34,197,94,0.22)" : "rgba(99,102,241,0.22)"}`,
            }}>
              {match.source === "graph-matched" ? "Graph Matched" : "Demo Mode"}
            </span>
          </div>

          {/* Timer */}
          <div style={{
            fontWeight: 900, fontSize: "1.65rem", fontVariantNumeric: "tabular-nums",
            letterSpacing: "0.04em", padding: "8px 18px", borderRadius: "14px",
            color: isUrgent ? "#ef4444" : "#f1f5f9",
            background: isUrgent ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${isUrgent ? "rgba(239,68,68,0.28)" : "rgba(255,255,255,0.07)"}`,
          }}>
            {formatTime(timeLeft)}
          </div>
        </div>

        {/* ── Two-column layout ── */}
        <div className="arena-contest-grid">

          {/* LEFT: problem + opponent */}
          <div style={{ display: "grid", gap: "14px", alignContent: "start" }}>

            {/* Problem card */}
            <div style={{
              padding: "22px", borderRadius: "18px",
              background: "#111118", border: "1px solid #1e1e2e",
              boxShadow: "0 16px 40px rgba(0,0,0,0.28)",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
                <h3 style={{ margin: 0, color: "#f1f5f9", fontSize: "1.08rem", lineHeight: 1.35 }}>
                  {problem?.title}
                </h3>
                <span style={{
                  flexShrink: 0, padding: "4px 10px", borderRadius: "999px",
                  fontSize: "0.72rem", fontWeight: 700,
                  background: diffSty.bg, color: diffSty.color,
                }}>
                  {diff}
                </span>
              </div>

              <p style={{ margin: "0 0 14px", color: "#cbd5e1", lineHeight: 1.65, fontSize: "0.92rem" }}>
                {problem?.description}
              </p>

              {problem?.examples && (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
                    Examples
                  </div>
                  <pre style={{
                    margin: 0, padding: "10px 12px", borderRadius: "10px",
                    background: "#0b0d14", border: "1px solid #1e1e2e",
                    color: "#a5b4fc", fontSize: "0.82rem",
                    whiteSpace: "pre-wrap", overflowWrap: "break-word",
                  }}>
                    {problem.examples}
                  </pre>
                </div>
              )}

              {problem?.constraints && (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
                    Constraints
                  </div>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>
                    {problem.constraints}
                  </p>
                </div>
              )}

              {/* Hints */}
              {(problem?.hints?.length ?? 0) > 0 && (
                <div>
                  {hintsRevealed > 0 && (
                    <div style={{ marginBottom: "8px", display: "grid", gap: "6px" }}>
                      {problem.hints.slice(0, hintsRevealed).map((h, i) => (
                        <div key={i} style={{
                          padding: "9px 12px", borderRadius: "10px", fontSize: "0.88rem",
                          background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
                          color: "#c7d2fe",
                        }}>
                          <strong style={{ color: "#a5b4fc", marginRight: "6px" }}>Hint {i + 1}:</strong>
                          {h}
                        </div>
                      ))}
                    </div>
                  )}
                  {hintsRevealed < (problem?.hints?.length ?? 0) && (
                    <button
                      type="button"
                      onClick={() => setHintsRevealed((n) => n + 1)}
                      style={{
                        padding: "8px 14px", borderRadius: "10px", fontSize: "0.85rem",
                        border: "1px solid rgba(99,102,241,0.24)",
                        background: "rgba(99,102,241,0.08)", color: "#c7d2fe",
                        cursor: "pointer", fontWeight: 600,
                      }}
                    >
                      💡 Get Hint ({(problem?.hints?.length ?? 0) - hintsRevealed} left)
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Opponent card */}
            <div style={{
              padding: "16px 20px", borderRadius: "16px",
              background: "#111118",
              border: `1px solid ${isAiMatch ? "rgba(245,158,11,0.25)" : "rgba(99,102,241,0.2)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "10px" }}>
                <div>
                  <div style={{ fontSize: "0.7rem", color: "#334155", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    vs
                  </div>
                  <div style={{ fontWeight: 800, color: "#f1f5f9", fontSize: "1.05rem" }}>
                    {opponent.avatar ? `${opponent.avatar} ` : ""}{opponent.name}
                  </div>
                </div>
                <span style={{
                  padding: "5px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 700,
                  background: isAiMatch ? "rgba(245,158,11,0.12)" : "rgba(56,189,248,0.1)",
                  color:      isAiMatch ? "#fbbf24"               : "#7dd3fc",
                  border:     `1px solid ${isAiMatch ? "rgba(245,158,11,0.22)" : "rgba(56,189,248,0.2)"}`,
                }}>
                  {isAiMatch ? "AI" : `Lv. ${opponent.skill_level}`}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {(match.shared_weak_concepts || []).map((c) => (
                  <span key={c} style={{
                    padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem",
                    background: "rgba(99,102,241,0.14)", color: "#c7d2fe",
                    border: "1px solid rgba(99,102,241,0.22)",
                  }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* AI progress bar */}
            {isAiMatch && (
              <div style={{
                padding: "14px 18px", borderRadius: "14px",
                background: "#111118",
                border: `1px solid ${aiDone ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.2)"}`,
                transition: "border-color 0.4s",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{
                    fontSize: "0.88rem", fontWeight: 600,
                    color: aiDone ? "#f87171" : "#fbbf24",
                    transition: "color 0.3s",
                  }}>
                    {aiDone ? "🤖 AI has submitted!" : "🤖 CodeCoach AI is coding..."}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    {Math.round(aiProgress)}%
                  </span>
                </div>
                <div style={{ height: "6px", borderRadius: "999px", background: "#1e1e2e", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: "999px",
                    width: `${aiProgress}%`,
                    background: aiDone
                      ? "#ef4444"
                      : "linear-gradient(90deg, #f59e0b, #ef4444)",
                    transition: "width 0.1s linear, background 0.4s",
                  }} />
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: editor + controls */}
          <div style={{ display: "grid", gap: "12px", alignContent: "start" }}>
            <CollabEditor
              roomId={match.roomId}
              initialCode={"// Write your solution here\n"}
              language={language}
              onCodeChange={(code) => { codeRef.current = code; }}
            />

            <div style={{
              display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center",
              padding: "14px 16px", borderRadius: "14px",
              background: "#111118", border: "1px solid #1e1e2e",
            }}>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{
                  flex: 1, minWidth: "130px", padding: "10px 12px",
                  border: "1px solid #2a2a3d", background: "#161622",
                  color: "#cbd5e1", borderRadius: "10px",
                }}
              >
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
              </select>

              <button
                type="button"
                onClick={() => doSubmit()}
                disabled={submitting}
                style={{
                  flex: 2, minWidth: "160px", padding: "11px 20px",
                  borderRadius: "12px", fontWeight: 700,
                  border: "1px solid rgba(34,197,94,0.26)",
                  background: submitting
                    ? "rgba(34,197,94,0.08)"
                    : "linear-gradient(135deg, #16a34a, #15803d)",
                  color: "#fff",
                  cursor: submitting ? "not-allowed" : "pointer",
                  opacity: submitting ? 0.72 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                }}
              >
                {submitting && (
                  <span style={{
                    width: "14px", height: "14px", display: "inline-block",
                    border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff",
                    borderRadius: "50%", animation: "arena-spin 0.7s linear infinite",
                  }} />
                )}
                {submitting ? "Submitting..." : "Submit Solution"}
              </button>
            </div>

            {error && (
              <div style={{
                padding: "10px 14px", borderRadius: "12px", fontSize: "0.9rem",
                background: "rgba(239,68,68,0.12)", color: "#fca5a5",
                border: "1px solid rgba(239,68,68,0.24)",
              }}>
                {error}
              </div>
            )}
          </div>
        </div>

        <style>{`
          .arena-contest-grid {
            display: grid;
            grid-template-columns: 1fr 1.15fr;
            gap: 18px;
            align-items: start;
          }
          @media (max-width: 920px) {
            .arena-contest-grid { grid-template-columns: 1fr; }
          }
          @keyframes arena-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // STATE 4: results
  if (phase === "results" && (result || aiResultData)) {

    // AI match results — side-by-side comparison
    if (isAiMatch && aiResultData) {
      const { user_score, winner, ai_solution, ai_time, user_time, passed_tests, total_tests, message } = aiResultData;

      const winnerBanner = {
        user: { text: "🏆 You beat the AI!", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.24)", color: "#4ade80" },
        tie:  { text: "🤝 Tied! AI was faster though.",  bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.24)", color: "#fbbf24" },
        ai:   { text: "🤖 AI wins this round. Study up!", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.24)", color: "#f87171" },
      }[winner];

      return (
        <div style={{ padding: "28px", maxWidth: "860px", margin: "32px auto" }}>
          {/* Winner banner */}
          <div style={{
            padding: "20px 24px", borderRadius: "18px", marginBottom: "20px", textAlign: "center",
            fontWeight: 800, fontSize: "1.2rem",
            background: winnerBanner.bg,
            border: `1px solid ${winnerBanner.border}`,
            color: winnerBanner.color,
            boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
          }}>
            {winnerBanner.text}
            <div style={{ fontWeight: 400, fontSize: "0.92rem", marginTop: "6px", opacity: 0.85 }}>
              {message}
            </div>
          </div>

          {/* Side-by-side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>

            {/* Your solution */}
            <div style={{
              padding: "20px", borderRadius: "16px",
              background: "#111118", border: "1px solid #1e1e2e",
            }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", marginBottom: "10px" }}>
                Your Solution
              </div>
              <div style={{
                fontSize: "3rem", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.04em",
                color: user_score > 70 ? "#4ade80" : user_score > 40 ? "#fbbf24" : "#f87171",
                marginBottom: "4px",
              }}>
                {user_score}
                <span style={{ fontSize: "1.4rem", color: "#334155", fontWeight: 700 }}>/100</span>
              </div>
              <div style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "10px" }}>
                {passed_tests}/{total_tests} tests · {Math.floor(user_time / 60)}m {user_time % 60}s
              </div>
              <pre style={{
                margin: 0, padding: "12px", borderRadius: "10px", fontSize: "0.8rem",
                background: "#0a0a0f", border: "1px solid #1e1e2e",
                color: "#94a3b8", maxHeight: "200px", overflow: "auto",
                whiteSpace: "pre-wrap", overflowWrap: "break-word",
              }}>
                {codeRef.current}
              </pre>
            </div>

            {/* AI solution */}
            <div style={{
              padding: "20px", borderRadius: "16px",
              background: "#111118", border: "1px solid rgba(245,158,11,0.2)",
            }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#fbbf24", marginBottom: "10px" }}>
                🤖 AI Solution
              </div>
              <div style={{
                fontSize: "3rem", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.04em",
                color: "#4ade80", marginBottom: "4px",
              }}>
                100
                <span style={{ fontSize: "1.4rem", color: "#334155", fontWeight: 700 }}>/100</span>
              </div>
              <div style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "10px" }}>
                {total_tests}/{total_tests} tests · {Math.floor(ai_time / 60)}m {ai_time % 60}s
              </div>
              <pre style={{
                margin: 0, padding: "12px", borderRadius: "10px", fontSize: "0.8rem",
                background: "#0a0a0f", border: "1px solid rgba(245,158,11,0.15)",
                color: "#fcd34d", maxHeight: "200px", overflow: "auto",
                whiteSpace: "pre-wrap", overflowWrap: "break-word",
              }}>
                {ai_solution}
              </pre>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              onClick={handleAnalyze}
              style={{
                padding: "13px 26px", borderRadius: "14px", fontWeight: 700,
                border: "1px solid rgba(99,102,241,0.28)",
                background: "linear-gradient(135deg, #6366f1, #7c3aed)",
                color: "#fff", cursor: "pointer", fontSize: "0.95rem",
              }}
            >
              View AI Analysis
            </button>
            <button
              type="button"
              onClick={resetState}
              style={{
                padding: "13px 26px", borderRadius: "14px", fontWeight: 600,
                border: "1px solid #2a2a3d", background: "#161622",
                color: "#94a3b8", cursor: "pointer", fontSize: "0.95rem",
              }}
            >
              Play Again
            </button>
          </div>

          <style>{`
            @media (max-width: 640px) {
              .ai-results-grid { grid-template-columns: 1fr !important; }
            }
          `}</style>
        </div>
      );
    }

    // Human match results
    const won       = (result?.score ?? 0) > 70;
    const struggling = (result?.score ?? 0) < 40;

    return (
      <div style={{ padding: "28px", maxWidth: "540px", margin: "40px auto", textAlign: "center" }}>
        <div style={{
          padding: "40px 28px", borderRadius: "24px", marginBottom: "18px",
          background: "#111118", border: "1px solid #1e1e2e",
          boxShadow: "0 24px 64px rgba(0,0,0,0.42)",
        }}>
          <div style={{
            fontSize: "5.5rem", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.05em",
            color: won ? "#4ade80" : struggling ? "#f87171" : "#fbbf24",
          }}>
            {result?.score}
            <span style={{ fontSize: "2rem", color: "#334155", fontWeight: 700 }}>/100</span>
          </div>

          <div style={{ margin: "10px 0 22px", color: "#94a3b8", fontSize: "0.98rem", fontWeight: 600 }}>
            {result?.passed_tests} / {result?.total_tests} test cases passed
          </div>

          {won && (
            <div style={{
              padding: "14px 18px", borderRadius: "14px", fontWeight: 700, fontSize: "1.05rem",
              background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.24)", color: "#4ade80",
            }}>
              🏆 You solved it!
            </div>
          )}
          {!won && struggling && (
            <div style={{
              padding: "14px 18px", borderRadius: "14px", fontWeight: 600,
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#c7d2fe",
            }}>
              Keep practicing! You'll get it next time 💪
            </div>
          )}
          {!won && !struggling && (
            <div style={{
              padding: "14px 18px", borderRadius: "14px", fontWeight: 600,
              background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24",
            }}>
              Good effort — almost there! 🔥
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            onClick={handleAnalyze}
            style={{
              padding: "13px 26px", borderRadius: "14px", fontWeight: 700,
              border: "1px solid rgba(99,102,241,0.28)",
              background: "linear-gradient(135deg, #6366f1, #7c3aed)",
              color: "#fff", cursor: "pointer", fontSize: "0.95rem",
              boxShadow: "0 12px 28px rgba(99,102,241,0.22)",
            }}
          >
            View AI Analysis
          </button>
          <button
            type="button"
            onClick={resetState}
            style={{
              padding: "13px 26px", borderRadius: "14px", fontWeight: 600,
              border: "1px solid #2a2a3d", background: "#161622",
              color: "#94a3b8", cursor: "pointer", fontSize: "0.95rem",
            }}
          >
            Find New Match
          </button>
        </div>
      </div>
    );
  }

  // STATE 5: analysis
  if (phase === "analysis") {
    return (
      <div style={{ padding: "28px", maxWidth: "680px", margin: "36px auto" }}>
        <div style={{
          padding: "28px 30px", borderRadius: "22px", marginBottom: "16px",
          background: "#111118", border: "1px solid #1e1e2e",
          boxShadow: "0 24px 64px rgba(0,0,0,0.42)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
              display: "grid", placeItems: "center", fontSize: "1.15rem",
              background: "linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.14))",
              border: "1px solid rgba(99,102,241,0.28)",
            }}>
              🤖
            </div>
            <div>
              <h2 style={{ margin: 0, color: "#f1f5f9", fontSize: "1.2rem" }}>AI Coach Analysis</h2>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.83rem" }}>
                Personalized feedback on your solution
              </p>
            </div>
          </div>

          {analysisLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{
                width: "40px", height: "40px", margin: "0 auto 14px",
                border: "3px solid rgba(99,102,241,0.18)", borderTopColor: "#6366f1",
                borderRadius: "50%", animation: "arena-spin 0.8s linear infinite",
              }} />
              <p style={{ margin: 0, color: "#475569", fontSize: "0.92rem" }}>
                Analyzing your solution...
              </p>
            </div>
          ) : (
            <div style={{
              padding: "18px 20px", borderRadius: "14px",
              background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.14)",
              color: "#cbd5e1", fontSize: "0.94rem",
            }}>
              {analysis ? renderAnalysisContent(analysis) : "Analysis not available."}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => navigate("/skill-map")}
            style={{
              padding: "12px 22px", borderRadius: "14px", fontWeight: 700,
              border: "1px solid rgba(56,189,248,0.22)",
              background: "rgba(56,189,248,0.08)", color: "#7dd3fc",
              cursor: "pointer", fontSize: "0.94rem",
            }}
          >
            Update My Skill Map
          </button>
          <button
            type="button"
            onClick={resetState}
            style={{
              padding: "12px 22px", borderRadius: "14px", fontWeight: 700,
              border: "1px solid rgba(99,102,241,0.28)",
              background: "linear-gradient(135deg, #6366f1, #7c3aed)",
              color: "#fff", cursor: "pointer", fontSize: "0.94rem",
            }}
          >
            {isAiMatch ? "Rematch AI" : "Find New Match"}
          </button>
        </div>

        <style>{`@keyframes arena-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return null;
}
