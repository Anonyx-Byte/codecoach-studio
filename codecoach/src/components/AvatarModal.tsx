// codecoach/src/components/AvatarModal.tsx
import React, { useEffect, useState } from "react";

type AvatarModalProps = {
  open: boolean;
  onClose?: () => void;
  onPlay?: () => void;
  onSkip?: () => void;
  lang?: string;
  transcript: string;
  voice?: string;
  showTranscript?: boolean;
  autoPlay?: boolean;
};

export default function AvatarModal({
  open,
  onClose,
  onPlay,
  onSkip,
  lang = "en",
  transcript,
  voice,
  showTranscript = true,
  autoPlay = false
}: AvatarModalProps) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!open) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      setPaused(false);
      return;
    }

    if (autoPlay) {
      const timer = window.setTimeout(() => {
        handlePlay();
      }, 250);
      return () => window.clearTimeout(timer);
    }
  }, [open, autoPlay]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  function chunkTextForTTS(text: string, maxChars = 160) {
    if (!text) return [""];
    const sentences = text.split(/(?<=[.?!])\s+/);
    const out: string[] = [];
    let cur = "";
    for (const s of sentences) {
      if ((cur + " " + s).length > maxChars) {
        if (cur) out.push(cur.trim());
        cur = s;
      } else {
        cur = cur ? cur + " " + s : s;
      }
    }
    if (cur) out.push(cur.trim());
    return out;
  }

  function waitForUnpause() {
    return new Promise<void>((resolve) => {
      const check = () => {
        if (!window.speechSynthesis?.paused) resolve();
        else setTimeout(check, 200);
      };
      check();
    });
  }

  function speakSegment(segment: string, language = "en", voiceName?: string) {
    return new Promise<void>((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(segment);
        u.lang = mapLangToBCP47(language);
        if (voiceName) {
          const v = (window.speechSynthesis?.getVoices() || []).find((vv: any) => vv.name === voiceName);
          if (v) u.voice = v;
        }
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis?.speak(u);
      } catch {
        resolve();
      }
    });
  }

  async function handlePlay() {
    if (!("speechSynthesis" in window)) {
      onPlay?.();
      return;
    }

    const text = transcript || "No narration available.";
    const segs = chunkTextForTTS(text, 160);
    setSpeaking(true);
    onPlay?.();

    for (let i = 0; i < segs.length; i++) {
      if (!open) break;
      if (paused) await waitForUnpause();
      await speakSegment(segs[i], lang, voice);
      if (!open) break;
    }

    setSpeaking(false);
  }

  function handlePause() {
    if (!("speechSynthesis" in window) || !speaking) return;
    if (!paused) {
      window.speechSynthesis.pause();
      setPaused(true);
    } else {
      window.speechSynthesis.resume();
      setPaused(false);
    }
  }

  function handleStop() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setPaused(false);
  }

  if (!open) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={styles.avatarWrap}>
              <div style={styles.fallbackAvatar}>AI</div>
            </div>

            <div>
              <div style={{ fontWeight: 700 }}>Would you like the avatar to read the explanation aloud?</div>
              <div style={{ fontSize: 13, color: "#94a3b8" }}>Audio will be played locally via your browser.</div>
            </div>
          </div>

          <button
            onClick={() => {
              handleStop();
              onClose?.();
            }}
            style={styles.closeBtn}
            aria-label="close"
          >
            X
          </button>
        </div>

        <div style={{ padding: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <button onClick={handlePlay} style={styles.primaryBtn} disabled={speaking}>
              Play
            </button>
            <button onClick={handlePause} style={styles.secondaryBtn} disabled={!speaking}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => {
                handleStop();
                onSkip?.();
                onClose?.();
              }}
              style={styles.ghostBtn}
            >
              Skip
            </button>
          </div>

          {showTranscript && (
            <div style={{ maxHeight: 220, overflow: "auto", background: "#111118", padding: 10, borderRadius: 10, border: "1px solid #1e1e2e" }}>
              <div style={{ fontSize: 13, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>{transcript}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function mapLangToBCP47(lang: string) {
  if (!lang) return "en-US";
  if (lang.startsWith("hi")) return "hi-IN";
  if (lang.startsWith("ta")) return "ta-IN";
  if (lang.startsWith("bn")) return "bn-IN";
  return "en-US";
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10, 10, 15, 0.78)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    backdropFilter: "blur(10px)"
  },
  modal: {
    width: 720,
    maxWidth: "96%",
    background: "#111118",
    borderRadius: 16,
    border: "1px solid #1e1e2e",
    boxShadow: "0 28px 72px rgba(0, 0, 0, 0.56)",
    overflow: "hidden"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottom: "1px solid #1e1e2e",
    color: "#f1f5f9"
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 16,
    overflow: "hidden",
    background: "rgba(99, 102, 241, 0.14)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  fallbackAvatar: {
    width: 64,
    height: 64,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 18,
    color: "#e2e8f0",
    background: "linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(139, 92, 246, 0.16))"
  },
  closeBtn: {
    background: "rgba(99, 102, 241, 0.08)",
    border: "1px solid #1e1e2e",
    color: "#cbd5e1",
    borderRadius: 10,
    width: 32,
    height: 32,
    fontSize: 16,
    cursor: "pointer"
  },
  primaryBtn: {
    marginRight: 8,
    background: "linear-gradient(135deg, #6366f1, #7c3aed)",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(99, 102, 241, 0.24)",
    cursor: "pointer"
  },
  secondaryBtn: {
    marginRight: 8,
    background: "#161622",
    color: "#e2e8f0",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #1e1e2e",
    cursor: "pointer"
  },
  ghostBtn: {
    background: "transparent",
    color: "#94a3b8",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #1e1e2e",
    cursor: "pointer"
  }
};
