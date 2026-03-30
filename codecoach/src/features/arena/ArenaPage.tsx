import { useState } from "react";
import { CollabEditor } from "./CollabEditor";

type ArenaMatch = {
  matched_student: {
    id: string;
    name: string;
    skill_level: number;
  };
  shared_weak_concepts: string[];
  final_score: number;
  source: string;
};

const BASE = import.meta.env.VITE_API_BASE_URL || "";

const scanMessages = [
  "\ud83d\udd0d Scanning skill graph...",
  "\ud83d\udd78\uFE0F Traversing 4-hop network...",
  "\ud83d\udcca Calculating weakness overlap...",
  "\u26A1 Ranking candidates...",
  "\u2705 Opponent found!"
];

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function ArenaPage() {
  const studentId = localStorage.getItem("userId") || "s001";
  const [loading, setLoading] = useState(false);
  const [match, setMatch] = useState<ArenaMatch | null>(null);
  const [error, setError] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayMessage, setOverlayMessage] = useState(scanMessages[0]);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  async function handleFindMatch() {
    setLoading(true);
    setError("");
    setMatch(null);
    setShowEditor(false);
    setOverlayOpen(true);
    setCountdownValue(null);

    try {
      const request = fetch(`${BASE}/api/arena/match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          studentId,
          embedding: []
        })
      });

      for (const message of scanMessages.slice(0, 4)) {
        setOverlayMessage(message);
        await delay(400);
      }

      const response = await request;
      if (!response.ok) {
        throw new Error(`Failed to find match (${response.status})`);
      }

      const data = (await response.json()) as ArenaMatch;
      setMatch(data);
      setOverlayMessage(`${scanMessages[4]} ${data.matched_student.name}`);
      await delay(1500);

      for (const count of [3, 2, 1]) {
        setCountdownValue(count);
        setOverlayMessage("Match starts in");
        await delay(1000);
      }

      setCountdownValue(null);
      setOverlayOpen(false);
      setShowEditor(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find match");
      setOverlayOpen(false);
      setCountdownValue(null);
      setMatch(null);
      setShowEditor(false);
    } finally {
      setLoading(false);
    }
  }

  const sharedWeaknessText = match?.shared_weak_concepts?.length
    ? match.shared_weak_concepts.join(", ")
    : "problem-solving foundations";

  return (
    <>
      {overlayOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            background: "rgba(2, 6, 23, 0.92)",
            backdropFilter: "blur(8px)"
          }}
        >
          <div
            style={{
              width: "min(540px, calc(100vw - 32px))",
              padding: "32px",
              borderRadius: "24px",
              background: "linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.92))",
              border: "1px solid rgba(249, 115, 22, 0.35)",
              textAlign: "center",
              color: "#fff7ed"
            }}
          >
            <div style={{ fontSize: countdownValue ? "5rem" : "1.5rem", fontWeight: 800, lineHeight: 1.1 }}>
              {countdownValue ?? overlayMessage}
            </div>
            {!countdownValue && (
              <p style={{ margin: "16px 0 0", color: "#fdba74" }}>
                TigerGraph arena matching in progress
              </p>
            )}
          </div>
        </div>
      )}

      <section
        style={{
          padding: "24px",
          borderRadius: "24px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "#f8fafc"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <h2 style={{ margin: 0 }}>Arena Matchmaking</h2>
            <p style={{ margin: "8px 0 0", color: "#cbd5e1" }}>
              Find a peer with overlapping weak areas and jump into a live coding room.
            </p>
          </div>
          <button
            type="button"
            onClick={handleFindMatch}
            disabled={loading}
            className={loading ? "pulse" : ""}
            style={{
              border: 0,
              borderRadius: "16px",
              padding: "18px 26px",
              background: "#f97316",
              color: "#fff7ed",
              cursor: "pointer",
              fontWeight: 800,
              fontSize: "1rem",
              boxShadow: "0 14px 30px rgba(249, 115, 22, 0.28)"
            }}
          >
            {loading ? "Finding Match..." : "Find Arena Match"}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: "16px",
              padding: "14px 16px",
              borderRadius: "14px",
              background: "rgba(127, 29, 29, 0.55)",
              color: "#fecaca"
            }}
          >
            {error}
          </div>
        )}

        {match && (
          <>
            <article
              style={{
                marginTop: "20px",
                padding: "20px",
                borderRadius: "20px",
                background: "rgba(15, 23, 42, 0.45)",
                border: "1px solid rgba(148, 163, 184, 0.22)"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                <div>
                  <h3 style={{ margin: 0 }}>{match.matched_student.name}</h3>
                  <p style={{ margin: "8px 0 0", color: "#cbd5e1" }}>
                    Skill level: {match.matched_student.skill_level}
                  </p>
                </div>
                <span
                  style={{
                    padding: "8px 12px",
                    borderRadius: "999px",
                    background: match.source === "graph-matched" ? "#dcfce7" : "#e5e7eb",
                    color: match.source === "graph-matched" ? "#166534" : "#374151",
                    fontWeight: 700
                  }}
                >
                  {match.source === "graph-matched" ? "Graph Matched \ud83d\udd25" : "Demo Mode"}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
                {(match.shared_weak_concepts || []).map((concept) => (
                  <span
                    key={concept}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "999px",
                      background: "rgba(59, 130, 246, 0.2)",
                      color: "#bfdbfe",
                      border: "1px solid rgba(96, 165, 250, 0.35)"
                    }}
                  >
                    {concept}
                  </span>
                ))}
              </div>
            </article>

            {showEditor && (
              <>
                <div
                  style={{
                    marginTop: "18px",
                    padding: "16px 18px",
                    borderRadius: "18px",
                    background: "#f97316",
                    color: "#fff7ed",
                    fontWeight: 700
                  }}
                >
                  {`You and ${match.matched_student.name} both struggle with ${sharedWeaknessText} — tackle it together! \ud83d\udd25`}
                </div>

                <CollabEditor
                  roomId={match.matched_student.id}
                  initialCode={"// Solve together in this arena room\n"}
                  language="javascript"
                />
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
