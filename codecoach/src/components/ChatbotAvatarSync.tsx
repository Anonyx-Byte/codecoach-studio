import { useEffect, useRef, useState } from "react";
import "./chatbot-sync.css";

type Props = {
  transcript: string;
  lang?: string;
  apiBaseUrl?: string;
  startOpen?: boolean;
  autoPlay?: boolean;
};

export default function ChatbotAvatarSync({
  transcript,
  lang = "en",
  apiBaseUrl = "http://localhost:4000",
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");
  const playbackModeRef = useRef<"tts" | "audio" | null>(null);
  const playbackSeqRef = useRef(0);
  const voiceAbortRef = useRef<AbortController | null>(null);
  const speakingRef = useRef(false);
  const pausedRef = useRef(false);
  const lastTranscriptRef = useRef("");

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
  }, [startOpen]);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!transcript) return;
    const changed = transcript !== lastTranscriptRef.current;
    lastTranscriptRef.current = transcript;
    if (!changed) return;

    stopPlayback(false);
    setDisplayText("");
    finishedSegmentsRef.current = [];

    if (autoPlay) {
      setOpen(true);
      startPlayback().catch(() => {
        setSpeaking(false);
      });
    }
  }, [transcript, autoPlay]);

  useEffect(() => {
    return () => {
      stopPlayback(false);
      cleanupAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanupAudio() {
    if (voiceAbortRef.current) {
      voiceAbortRef.current.abort();
      voiceAbortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
  }

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
    return 12.5 * rate;
  }

  function getPrefixForSegment() {
    return finishedSegmentsRef.current.join(" ");
  }

  function pickPleasingVoice(voices: SpeechSynthesisVoice[], languageTag: string) {
    if (!voices.length) return null;

    const sameLanguage = voices.filter((voice) => voice.lang?.toLowerCase().startsWith(languageTag.slice(0, 2).toLowerCase()));
    const pool = sameLanguage.length ? sameLanguage : voices;

    const preferredTokens = ["neural", "natural", "premium", "wavenet", "google", "microsoft", "aria", "jenny", "samantha", "female"];
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
    if (code === "hi" || code === "ta" || code === "te") return { rate: 0.94, pitch: 1.01 };
    if (code === "es" || code === "fr" || code === "de") return { rate: 0.95, pitch: 1.0 };
    return { rate: 0.96, pitch: 1.02 };
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
        if (!speakingRef.current || pausedRef.current || shouldStopRef.current) return;
        idx++;
        const visible = segment.slice(0, idx);
        setDisplayText(prefix + visible);
        if (idx >= segment.length && charTimerRef.current) {
          window.clearInterval(charTimerRef.current);
          charTimerRef.current = null;
        }
      }, delayMs);
    });
  }

  async function playViaTTS(playbackId: number) {
    shouldStopRef.current = false;
    setSpeaking(true);
    setPaused(false);
    setDisplayText("");
    finishedSegmentsRef.current = [];
    playbackModeRef.current = "tts";

    const languageTag = mapLangToBCP47(lang);
    const prosody = getProsody(lang);
    const voice = pickPleasingVoice(voicesRef.current || [], languageTag);

    const segments = chunkTextForTTS(transcript, 120);
    for (let i = 0; i < segments.length; i++) {
      if (playbackId !== playbackSeqRef.current) break;
      if (shouldStopRef.current) break;
      await speakSegment(segments[i], { ...prosody, voice });
      finishedSegmentsRef.current.push(segments[i]);
      setDisplayText(finishedSegmentsRef.current.join(" ") + (i < segments.length - 1 ? " " : ""));
      await new Promise((res) => setTimeout(res, 120));
      while (pausedRef.current && !shouldStopRef.current && playbackId === playbackSeqRef.current) {
        await new Promise((res) => setTimeout(res, 200));
      }
    }

    if (playbackId === playbackSeqRef.current) {
      setSpeaking(false);
      setPaused(false);
      playbackModeRef.current = null;
    }
  }

  async function playViaAwsVoice(playbackId: number) {
    const controller = new AbortController();
    voiceAbortRef.current = controller;
    const res = await fetch(`${apiBaseUrl}/api/voice/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ text: transcript, lang })
    });
    if (controller.signal.aborted || playbackId !== playbackSeqRef.current || shouldStopRef.current) return;

    if (!res.ok) {
      throw new Error(`Voice synthesis unavailable (${res.status})`);
    }

    const blob = await res.blob();
    if (controller.signal.aborted || playbackId !== playbackSeqRef.current || shouldStopRef.current) return;
    cleanupAudio();
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;

    shouldStopRef.current = false;
    playbackModeRef.current = "audio";
    setSpeaking(true);
    setPaused(false);
    setDisplayText(transcript);

    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Audio playback failed"));
      audio.play().catch(reject);
    });

    if (playbackId === playbackSeqRef.current) {
      setSpeaking(false);
      setPaused(false);
      playbackModeRef.current = null;
      cleanupAudio();
    }
  }

  async function startPlayback() {
    if (!transcript) return;
    const playbackId = ++playbackSeqRef.current;
    shouldStopRef.current = false;
    try {
      await playViaAwsVoice(playbackId);
    } catch {
      if (playbackId !== playbackSeqRef.current || shouldStopRef.current) return;
      await playViaTTS(playbackId);
    }
  }

  function stopPlayback(closePanel = false) {
    playbackSeqRef.current += 1;
    shouldStopRef.current = true;
    if (voiceAbortRef.current) {
      voiceAbortRef.current.abort();
      voiceAbortRef.current = null;
    }

    if (playbackModeRef.current === "audio" && audioRef.current) {
      audioRef.current.pause();
      cleanupAudio();
    }

    window.speechSynthesis.cancel();
    if (charTimerRef.current) {
      window.clearInterval(charTimerRef.current);
      charTimerRef.current = null;
    }

    setSpeaking(false);
    setPaused(false);
    playbackModeRef.current = null;
    if (closePanel) setOpen(false);
  }

  async function handlePlayPause() {
    if (speaking && !paused) {
      if (playbackModeRef.current === "audio" && audioRef.current) {
        audioRef.current.pause();
      } else {
        window.speechSynthesis.pause();
      }
      setPaused(true);
      return;
    }

    if (speaking && paused) {
      if (playbackModeRef.current === "audio" && audioRef.current) {
        await audioRef.current.play().catch(() => {});
      } else {
        window.speechSynthesis.resume();
      }
      setPaused(false);
      return;
    }

    setOpen(true);
    startPlayback().catch(() => {
      setSpeaking(false);
    });
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
            <div className="chatbot-emoji">VC</div>
          </div>

          <div className="chatbot-controls">
            <button className="btn" onClick={() => handlePlayPause()}>
              {speaking ? (paused ? "Resume" : "Pause") : "Play"}
            </button>
            <button className="btn ghost" onClick={() => setOpen(false)}>
              Minimize
            </button>
            <button className="btn ghost" onClick={() => stopPlayback(true)}>
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
