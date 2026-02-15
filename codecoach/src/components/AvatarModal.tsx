// codecoach/src/components/AvatarModal.tsx
import React, { useEffect, useState, useRef } from "react";
import Lottie from "lottie-react";

type AvatarModalProps = {
  open: boolean;
  onClose?: () => void;
  onPlay?: () => void;
  onSkip?: () => void;
  lang?: string; // "en" | "hi" ...
  transcript: string; // full narration text to speak
  voice?: string; // optional preferred voice name
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
  const [animationData, setAnimationData] = useState<any>(null);
  const mountedRef = useRef(false);
  const autoPlayedRef = useRef(false);

  // load Lottie JSON from public/lotties/monito.json
  useEffect(() => {
    fetch("/lotties/monito.json")
      .then((r) => r.json())
      .then((j) => setAnimationData(j))
      .catch(() => setAnimationData(null));
  }, []);

  // stop speech when modal closes
  useEffect(() => {
    if (!open) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      setPaused(false);
    } else {
      // if open and autoPlay requested (and not yet auto-played), trigger play
      if (autoPlay && !autoPlayedRef.current) {
        autoPlayedRef.current = true;
        setTimeout(() => {
          handlePlay();
        }, 250);
      }
    }
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // helpers
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

  function speakSegment(segment: string, lang = "en", voiceName?: string) {
    return new Promise<void>((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(segment);
        u.lang = mapLangToBCP47(lang);
        if (voiceName) {
          const v = (window.speechSynthesis?.getVoices() || []).find((vv: any) => vv.name === voiceName);
          if (v) u.voice = v;
        }
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis?.speak(u);
      } catch (e) {
        console.warn("TTS error", e);
        resolve();
      }
    });
  }

  async function handlePlay() {
    if (!("speechSynthesis" in window)) {
      alert("Speech synthesis not supported in this browser.");
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
    if (!("speechSynthesis" in window)) return;
    if (!speaking) return;
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

  // Render nothing if not open
  if (!open) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={styles.avatarWrap}>
              {animationData ? (
                <Lottie animationData={animationData} loop style={{ width: 92, height: 92 }} />
              ) : (
                // fallback small static avatar
                <div style={styles.fallbackAvatar}>🙂</div>
              )}
            </div>

            <div>
              <div style={{ fontWeight: 700 }}>Would you like the avatar to read the explanation aloud?</div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>High-quality audio will be played locally via your browser.</div>
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
            ✕
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
            <div style={{ maxHeight: 220, overflow: "auto", background: "#f8fafc", padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: 13, color: "#374151", whiteSpace: "pre-wrap" }}>{transcript}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* helpers */
function mapLangToBCP47(lang: string) {
  if (!lang) return "en-US";
  if (lang.startsWith("hi")) return "hi-IN";
  if (lang.startsWith("ta")) return "ta-IN";
  if (lang.startsWith("bn")) return "bn-IN";
  return "en-US";
}

/* styles */
const styles: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  modal: { width: 720, maxWidth: "96%", background: "#fff", borderRadius: 12, boxShadow: "0 8px 30px rgba(2,6,23,0.2)", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid #eef2ff" },
  avatarWrap: { width: 96, height: 96, borderRadius: 16, overflow: "hidden", background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center" },
  fallbackAvatar: { width: 64, height: 64, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" },
  closeBtn: { background: "transparent", border: "none", fontSize: 18, cursor: "pointer" },
  primaryBtn: { marginRight: 8, background: "#2563eb", color: "#fff", padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer" },
  secondaryBtn: { marginRight: 8, background: "#e2e8f0", color: "#111827", padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer" },
  ghostBtn: { background: "transparent", color: "#6b7280", padding: "8px 12px", borderRadius: 6, border: "1px solid transparent", cursor: "pointer" }
};
