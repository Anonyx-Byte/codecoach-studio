import { useEffect, useRef, useState } from "react";
import Lottie from "lottie-react";
import "./chatbot-sync.css";

type Props = {
  transcript: string;
  lang?: string;
  lottiePublicPath?: string | null;
  startOpen?: boolean;
  autoPlay?: boolean;
};

export default function ChatbotAvatarSync({
  transcript,
  lang = "en",
  lottiePublicPath = null,
  startOpen = false,
  autoPlay = false
}: Props) {
  const [open, setOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [displayText, setDisplayText] = useState("");

  const synthRef = useRef<SpeechSynthesis | null>(window.speechSynthesis || null);
  const shouldStopRef = useRef(false);
  const charTimerRef = useRef<number | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[] | null>(null);
  const finishedSegmentsRef = useRef<string[]>([]);

  useEffect(() => {
    const loadVoices = () => {
      voicesRef.current = synthRef.current?.getVoices() || null;
    };
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  useEffect(() => {
    if (startOpen) setOpen(true);
    if (autoPlay && transcript && !speaking) {
      setTimeout(() => {
        playAll().catch(() => {
          setSpeaking(false);
        });
      }, 120);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOpen, autoPlay, transcript]);

  function chunkTextForTTS(text: string, maxChars = 120): string[] {
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

  function estimateCharsPerSecond(rate = 1.0) {
    const base = 12.5;
    return base * rate;
  }

  function getPrefixForSegment() {
    return finishedSegmentsRef.current.join(" ");
  }

  function pickPleasingVoice(voices: SpeechSynthesisVoice[], languageTag: string) {
    if (!voices.length) return null;

    const sameLanguage = voices.filter((voice) => voice.lang?.toLowerCase().startsWith(languageTag.slice(0, 2).toLowerCase()));
    const pool = sameLanguage.length ? sameLanguage : voices;

    const preferredTokens = [
      "neural",
      "natural",
      "premium",
      "wavenet",
      "google",
      "microsoft",
      "aria",
      "jenny",
      "samantha",
      "female"
    ];
    const avoidTokens = ["espeak", "robot", "compact"];

    let winner: SpeechSynthesisVoice | null = null;
    let bestScore = -999;

    for (const voice of pool) {
      const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
      let score = 0;

      preferredTokens.forEach((token) => {
        if (name.includes(token)) score += 3;
      });
      avoidTokens.forEach((token) => {
        if (name.includes(token)) score -= 4;
      });
      if (voice.default) score += 2;
      if (voice.localService) score += 1;

      if (score > bestScore) {
        winner = voice;
        bestScore = score;
      }
    }

    return winner;
  }

  function getProsody(languageCode: string) {
    const code = languageCode.slice(0, 2).toLowerCase();
    if (code === "hi" || code === "ta" || code === "te") {
      return { rate: 0.94, pitch: 1.01 };
    }
    if (code === "es" || code === "fr" || code === "de") {
      return { rate: 0.95, pitch: 1.0 };
    }
    return { rate: 0.96, pitch: 1.02 };
  }

  async function playChime() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 784;
      g.gain.value = 0.0008;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      o.start(now);
      g.gain.exponentialRampToValueAtTime(0.00001, now + 0.16);
      await new Promise((res) => setTimeout(res, 180));
      o.stop();
      ctx.close().catch(() => {});
    } catch {}
  }

  function speakSegment(
    segment: string,
    opts: { rate?: number; pitch?: number; voice?: SpeechSynthesisVoice | null } = { rate: 1, pitch: 1, voice: null }
  ) {
    return new Promise<void>((resolve) => {
      if (!segment) {
        resolve();
        return;
      }

      const synth = synthRef.current!;
      const utterance = new SpeechSynthesisUtterance(segment);
      const rate = opts.rate ?? 1;
      const pitch = opts.pitch ?? 1;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.lang = mapLangToBCP47(lang);
      if (opts.voice) utterance.voice = opts.voice;

      (utterance as any).onboundary = (ev: any) => {
        if (typeof ev.charIndex === "number") {
          setDisplayText(() => {
            const visible = segment.slice(0, ev.charIndex + 1);
            const prefix = getPrefixForSegment();
            return prefix + visible;
          });
        }
      };

      utterance.onend = () => {
        setDisplayText(() => {
          const prefix = getPrefixForSegment();
          return prefix + segment;
        });
        resolve();
      };

      utterance.onerror = () => {
        setDisplayText(() => {
          const prefix = getPrefixForSegment();
          return prefix + segment;
        });
        resolve();
      };

      synth.speak(utterance);

      const charsPerSec = estimateCharsPerSecond(rate);
      const delayMs = Math.max(12, 1000 / charsPerSec);
      let idx = 0;
      const prefix = getPrefixForSegment();
      if (charTimerRef.current) {
        window.clearInterval(charTimerRef.current);
        charTimerRef.current = null;
      }
      charTimerRef.current = window.setInterval(() => {
        if (!speaking || paused || shouldStopRef.current) return;
        idx++;
        const visible = segment.slice(0, idx);
        setDisplayText(prefix + visible);
        if (idx >= segment.length) {
          if (charTimerRef.current) {
            window.clearInterval(charTimerRef.current);
            charTimerRef.current = null;
          }
        }
      }, delayMs);
    });
  }

  async function playAll() {
    if (!transcript) return;

    shouldStopRef.current = false;
    setSpeaking(true);
    setPaused(false);
    setDisplayText("");
    finishedSegmentsRef.current = [];

    const languageTag = mapLangToBCP47(lang);
    const prosody = getProsody(lang);
    const voice = pickPleasingVoice(voicesRef.current || [], languageTag);

    await playChime();

    const segments = chunkTextForTTS(transcript, 120);
    for (let i = 0; i < segments.length; i++) {
      if (shouldStopRef.current) break;
      await speakSegment(segments[i], { ...prosody, voice });
      finishedSegmentsRef.current.push(segments[i]);
      setDisplayText(finishedSegmentsRef.current.join(" ") + (i < segments.length - 1 ? " " : ""));
      await new Promise((res) => setTimeout(res, 120));
      while (paused && !shouldStopRef.current) {
        await new Promise((res) => setTimeout(res, 200));
      }
    }

    setSpeaking(false);
  }

  function handlePlayPause() {
    if (speaking && !paused) {
      window.speechSynthesis.pause();
      setPaused(true);
      return;
    }
    if (speaking && paused) {
      window.speechSynthesis.resume();
      setPaused(false);
      return;
    }
    setOpen(true);
    playAll().catch(() => {
      setSpeaking(false);
    });
  }

  function handleStopAndClose() {
    shouldStopRef.current = true;
    window.speechSynthesis.cancel();
    if (charTimerRef.current) {
      window.clearInterval(charTimerRef.current);
      charTimerRef.current = null;
    }
    finishedSegmentsRef.current = [];
    setDisplayText("");
    setSpeaking(false);
    setPaused(false);
    setOpen(false);
  }

  return (
    <>
      <div className="chatbot-side-button" title="Tutor voice">
        <button
          onClick={() => {
            setOpen((s) => !s);
          }}
          className={speaking ? "is-speaking" : ""}
        >
          <span className="audio-dot" />
          <span className="audio-label">Tutor Voice</span>
        </button>
      </div>

      <div className={`chatbot-container ${open ? "open" : "closed"}`}>
        <div className="chatbot-header">
          <div className="chatbot-avatar">
            {lottiePublicPath ? (
              <Lottie animationData={null as any} loop style={{ width: 64, height: 64 }} />
            ) : (
              <div className="chatbot-emoji">VC</div>
            )}
          </div>

          <div className="chatbot-controls">
            <button className="btn" onClick={handlePlayPause}>
              {speaking ? (paused ? "Resume" : "Pause") : "Play"}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                handleStopAndClose();
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div className="chatbot-body">
          <div className="chatbot-text">
            {displayText || (transcript ? "Press Play to hear the tutor voice explanation." : "No explanation yet.")}
            <span className="chatbot-cursor" />
          </div>
        </div>
      </div>
    </>
  );
}

function mapLangToBCP47(lang: string) {
  if (!lang) return "en-US";

  const key = lang.slice(0, 2).toLowerCase();
  if (key === "hi") return "hi-IN";
  if (key === "es") return "es-ES";
  if (key === "fr") return "fr-FR";
  if (key === "de") return "de-DE";
  if (key === "ta") return "ta-IN";
  if (key === "te") return "te-IN";

  return "en-US";
}
