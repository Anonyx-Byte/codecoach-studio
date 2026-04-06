import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
} from "chart.js";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import Modal from "./components/Modal";
import QuizManager from "./components/QuizManager";
import ChatbotAvatarSync from "./components/ChatbotAvatarSync";
import SkillMapPage from "./features/skillMap/SkillMapPage";
import ArenaPage from "./features/arena/ArenaPage";
import ImpostorBadge from "./features/dashboard/ImpostorBadge";
import GraphAgentChat from "./features/dashboard/GraphAgentChat";
import "./App.css";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);
ChartJS.defaults.color = "#94a3b8";
ChartJS.defaults.borderColor = "rgba(30, 30, 46, 0.9)";
ChartJS.defaults.plugins.legend.labels.color = "#cbd5e1";
ChartJS.defaults.plugins.tooltip.backgroundColor = "#111118";
ChartJS.defaults.plugins.tooltip.borderColor = "#1e1e2e";
ChartJS.defaults.plugins.tooltip.borderWidth = 1;
ChartJS.defaults.plugins.tooltip.titleColor = "#f1f5f9";
ChartJS.defaults.plugins.tooltip.bodyColor = "#cbd5e1";

type ExplainResp = {
  ok?: boolean;
  provider?: string;
  model?: string;
  reviewType?: string;
  fallbackFrom?: string | null;
  summary?: string;
  transcript?: string;
  responsibilities?: string[];
  edge_cases?: string[];
  suggested_unit_test?: string;
  used_lines?: string[];
  flashcards?: { q: string; a: string }[];
  key_points?: string[];
  confidence?: "low" | "medium" | "high";
};

type ThemeMode = "light" | "dark";
type BackendHealth = "checking" | "online" | "offline";
type AuthMode = "login" | "register";
type AIProvider = "groq" | "gemma";
type ReviewType = "quick" | "detailed";

type ApiErrorShape = {
  ok?: boolean;
  code?: string;
  message?: string;
  detail?: string;
  error?: string;
};

type UserProfile = {
  id: string;
  name: string;
  email: string;
  studentId?: string;
  createdAt: string;
  profile?: {
    preferredLanguage?: string;
    goals?: string[];
    preferences?: {
      theme?: string;
      selectedLanguage?: string;
      lastOpenedAt?: string;
    };
  };
  analyticsMeta?: {
    attemptsCount?: number;
    questionsAsked?: number;
    badges?: string[];
  };
};

type AnalyticsData = {
  totalAttempts: number;
  avgScore: number;
  questionsAsked: number;
  proctorFlags: number;
  scoreTrend: { at: string; score: number }[];
  weakTopics: { topic: string; count: number }[];
  badges: string[];
  topicAccuracy?: { topic: string; accuracy: number }[];
  weeklyActivity?: { day: string; attempts: number }[];
  improvementPercentage?: number;
  completionRate?: number;
  recommendedPracticeMinutes?: number;
  recentAttempts: {
    id: string;
    quizTitle: string;
    score: number;
    totalQuestions: number;
    createdAt: string;
  }[];
  arenaResults?: {
    wins: number;
    losses: number;
    avg_score: number;
    matches: { problemTitle: string; score: number; timestamp: string }[];
  };
};

type StudyPlan = {
  title: string;
  recommendedPracticeMinutes: number;
  weakTopics: string[];
  quizSuggestions: string[];
  revisionReminders: string[];
  days: { day: string; topics: string[]; tasks: string[]; practiceMinutes: number }[];
  tips?: string[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type MentorContentChunk =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string; language: string };

type GoogleWindow = Window & typeof globalThis & {
  google?: any;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const AUTH_TOKEN_KEY = "codecoach-auth-token";
const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "");

const EXPLANATION_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" }
] as const;

const AI_PROVIDER_OPTIONS: { value: AIProvider; label: string }[] = [
  { value: "groq", label: "Groq" },
  { value: "gemma", label: "Gemma (Bedrock)" }
];

const GEMMA_REVIEW_OPTIONS: { value: ReviewType; label: string }[] = [
  { value: "quick", label: "Quick (Gemma 3 4B IT)" },
  { value: "detailed", label: "Detailed (Gemma 3 12B IT)" }
];

const STUDY_MILESTONES = [
  "Read the summary first",
  "Review highlighted code lines",
  "Practice with flashcards and quiz"
];

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem("codecoach-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function toOneLine(text: string, maxLen = 120) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen).trimEnd()}...`;
}

function FlipCard({ front, back, index }: { front: string; back: string; index: number }) {
  const [flipped, setFlipped] = useState(false);
  const cardStyle: React.CSSProperties = {
    padding: "18px 20px",
    borderRadius: "16px",
    display: "flex", flexDirection: "column", gap: "8px",
    minHeight: "90px",
  };
  return (
    <div
      onClick={() => setFlipped((f) => !f)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFlipped((f) => !f); }}
      style={{
        cursor: "pointer",
        animation: `fc-slideIn 0.4s ease ${index * 80}ms both`,
        transition: "transform 0.15s ease",
      }}
    >
      {!flipped ? (
        <div style={{
          ...cardStyle,
          background: "linear-gradient(135deg, rgba(99,102,241,0.14), rgba(139,92,246,0.08))",
          border: "1px solid rgba(99,102,241,0.24)",
        }}>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Question {index + 1}
          </div>
          <div style={{ fontSize: "0.92rem", color: "#f1f5f9", lineHeight: 1.6, fontWeight: 500 }}>
            {front}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: "4px" }}>
            Tap to reveal answer →
          </div>
        </div>
      ) : (
        <div style={{
          ...cardStyle,
          background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(22,163,74,0.06))",
          border: "1px solid rgba(34,197,94,0.24)",
          animation: "fc-revealIn 0.3s ease",
        }}>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Answer {index + 1}
          </div>
          <div style={{ fontSize: "0.92rem", color: "#f1f5f9", lineHeight: 1.6 }}>
            {back}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: "4px" }}>
            ← Tap to see question
          </div>
        </div>
      )}

      <style>{`
        @keyframes fc-slideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fc-revealIn {
          from { opacity: 0.6; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function buildQuickFacts(result: ExplainResp | null) {
  if (!result) return [] as string[];

  const fromModelCards = (result.flashcards ?? []).map((card) => toOneLine(card.a || card.q));
  const keyPoints = (result.key_points ?? []).map((point) => toOneLine(point));
  const summary = result.summary ? [toOneLine(result.summary)] : [];
  const responsibilities = (result.responsibilities ?? []).map((item) => toOneLine(item));
  const edgeCases = (result.edge_cases ?? []).map((item) => toOneLine(item));

  return Array.from(new Set([...keyPoints, ...fromModelCards, ...summary, ...responsibilities, ...edgeCases]))
    .filter(Boolean)
    .slice(0, 8);
}

async function parseApiError(response: Response) {
  let message = `Server returned ${response.status}`;
  try {
    const body = (await response.json()) as ApiErrorShape;
    message = body.message || body.error || message;
    if (body.detail) message = `${message}: ${body.detail}`;
  } catch {}
  return message;
}

function normalizeAnalyticsPayload(payload: any): AnalyticsData {
  const src = payload?.analytics || payload || {};
  return {
    totalAttempts: Number(src.totalAttempts || 0),
    avgScore: Number(src.avgScore || 0),
    questionsAsked: Number(src.questionsAsked || 0),
    proctorFlags: Number(src.proctorFlags || 0),
    scoreTrend: Array.isArray(src.scoreTrend) ? src.scoreTrend : [],
    weakTopics: Array.isArray(src.weakTopics) ? src.weakTopics : [],
    badges: Array.isArray(src.badges) ? src.badges : [],
    topicAccuracy: Array.isArray(src.topicAccuracy) ? src.topicAccuracy : [],
    weeklyActivity: Array.isArray(src.weeklyActivity) ? src.weeklyActivity : [],
    improvementPercentage: Number(src.improvementPercentage || 0),
    completionRate: Number(src.completionRate || 0),
    recommendedPracticeMinutes: Number(src.recommendedPracticeMinutes || 45),
    recentAttempts: Array.isArray(src.recentAttempts) ? src.recentAttempts : [],
    arenaResults: src.arenaResults || undefined
  };
}

function parseMentorContent(content: string): MentorContentChunk[] {
  const source = String(content || "");
  const chunks: MentorContentChunk[] = [];
  const fence = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null = null;

  while ((match = fence.exec(source)) !== null) {
    const start = match.index;
    if (start > last) {
      const text = source.slice(last, start).trim();
      if (text) chunks.push({ kind: "text", value: text });
    }

    const lang = (match[1] || "").trim().toLowerCase();
    const code = (match[2] || "").replace(/\s+$/, "");
    if (code) chunks.push({ kind: "code", value: code, language: lang || "code" });
    last = fence.lastIndex;
  }

  if (last < source.length) {
    const tail = source.slice(last).trim();
    if (tail) chunks.push({ kind: "text", value: tail });
  }

  if (!chunks.length && source.trim()) {
    chunks.push({ kind: "text", value: source.trim() });
  }

  return chunks;
}

export default function App() {
  const editorRef = useRef<any>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const resizingSplitRef = useRef(false);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const googleLoginRef = useRef<(idToken: string) => Promise<void>>(async () => {});
  const [code, setCode] = useState<string>(
    `// Example: sum function\nfunction sum(a, b) {\n  return a + b;\n}`
  );

  const [result, setResult] = useState<ExplainResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<AIProvider | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("groq");
  const [selectedReviewType, setSelectedReviewType] = useState<ReviewType>("quick");
  const [activeModel, setActiveModel] = useState<string>("");
  const [providerReady, setProviderReady] = useState<{ groq: boolean; gemma: boolean }>({ groq: true, gemma: true });
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [backendHealth, setBackendHealth] = useState<BackendHealth>("checking");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [avatarOpen, setAvatarOpen] = useState<boolean>(false);
  const [avatarTranscript, setAvatarTranscript] = useState<string>("");
  const [autoPlayAvatar, setAutoPlayAvatar] = useState(false);
  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [quizLocked, setQuizLocked] = useState(false);
  const [flashcardsOpen, setFlashcardsOpen] = useState(false);
  const [editorWidthPct, setEditorWidthPct] = useState(66);

  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem(AUTH_TOKEN_KEY));
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });

  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);

  const [askOpen, setAskOpen] = useState(false);
  const [askLoading, setAskLoading] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [askFollowups, setAskFollowups] = useState<string[]>([]);
  const [speechListening, setSpeechListening] = useState(false);
  const speechSupported = Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  void setAuthMode;
  void authLoading;

  const selectedLanguageLabel =
    EXPLANATION_LANGUAGES.find((lang) => lang.code === selectedLanguage)?.label ?? "English";

  const transcriptString =
    (avatarTranscript || result?.transcript) ??
    `${result?.summary ?? ""} ${(result?.responsibilities ?? []).join(". ")}`.trim();

  const quickFacts = useMemo(() => buildQuickFacts(result), [result]);
  const knowledgeDebtScore = useMemo(() => {
    if (analytics) {
      return Math.max(18, Math.min(94, Math.round(100 - analytics.avgScore + analytics.weakTopics.length * 4)));
    }

    if (result) {
      return Math.max(34, 74 - quickFacts.length * 3);
    }

    return 68;
  }, [analytics, quickFacts.length, result]);
  const scoreTrendChartData = useMemo(() => {
    const points = analytics?.scoreTrend || [];
    return {
      labels: points.map((p) => new Date(p.at).toLocaleDateString()),
      datasets: [
        {
          label: "Score",
          data: points.map((p) => p.score),
          borderColor: "#818cf8",
          backgroundColor: "rgba(99, 102, 241, 0.18)",
          tension: 0.3
        }
      ]
    };
  }, [analytics]);

  const topicAccuracyData = useMemo(() => {
    const rows = analytics?.topicAccuracy || [];
    return {
      labels: rows.map((r) => r.topic),
      datasets: [
        {
          label: "Accuracy %",
          data: rows.map((r) => r.accuracy),
          backgroundColor: "rgba(34, 197, 94, 0.55)"
        }
      ]
    };
  }, [analytics]);

  const weeklyActivityData = useMemo(() => {
    const rows = analytics?.weeklyActivity || [];
    return {
      labels: rows.map((r) => r.day),
      datasets: [
        {
          label: "Attempts",
          data: rows.map((r) => r.attempts),
          backgroundColor: "rgba(99, 102, 241, 0.52)"
        }
      ]
    };
  }, [analytics]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("codecoach-theme", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;

    void fetch(`${API_BASE_URL}/api/graph/wake`).catch(() => {});

    async function pingHealth() {
      try {
        const [healthRes, statusRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/health`),
          fetch(`${API_BASE_URL}/api/status`)
        ]);
        if (!healthRes.ok) throw new Error(String(healthRes.status));

        if (active) {
          setBackendHealth("online");
        }

        if (active && statusRes.ok) {
          const payload = await statusRes.json();
          const groqConfigured = Boolean(payload?.providers?.groq?.configured);
          const gemmaConfigured = Boolean(payload?.providers?.gemma?.configured);
          setProviderReady({
            groq: groqConfigured,
            gemma: gemmaConfigured
          });
        }
      } catch (err){
        if (active) {
          console.error("Health check failed:",err);
          setBackendHealth("offline");
          setProviderReady({groq: false, gemma: false});
          
        }
      }
    }

    pingHealth();
    const timer = window.setInterval(pingHealth, 20000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!authToken) {
      setUser(null);
      return;
    }

    let active = true;

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });

        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }

        const payload = await res.json();
        if (active) {
          setUser(payload.user || null);
          if (payload.user?.id) localStorage.setItem("userId", payload.user.id);
        }
      } catch {
        if (active) {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          setAuthToken(null);
          setUser(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const timer = window.setTimeout(async () => {
      try {
        await fetch(`${API_BASE_URL}/api/profile/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            theme,
            selectedLanguage: selectedLanguageLabel,
            lastOpenedAt: new Date().toISOString()
          })
        });
      } catch {}
    }, 600);

    return () => window.clearTimeout(timer);
  }, [authToken, theme, selectedLanguageLabel]);

  useEffect(() => {
    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingSplitRef.current || !splitLayoutRef.current) return;
      const rect = splitLayoutRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const raw = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(42, Math.min(78, raw));
      setEditorWidthPct(clamped);
    };

    const onMouseUp = () => {
      if (!resizingSplitRef.current) return;
      resizingSplitRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const win = window as GoogleWindow;
    if (win.google?.accounts?.id) {
      setGoogleReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    script.onerror = () => setGoogleReady(false);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  async function handleGoogleLogin(idToken: string) {
    if (!idToken) return;

    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      const token = payload.token as string;
      if (!token) throw new Error("No auth token received");
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      const uid = payload.user?.id || payload.user?.userId;
      if (uid) {
        localStorage.setItem("userId", uid);
        localStorage.setItem("user", JSON.stringify(payload.user));
      }
      setAuthToken(token);
      setUser(payload.user || null);
      setAuthModalOpen(false);
    } catch (err: any) {
      setAuthError(err?.message || "Google sign-in failed");
    } finally {
      setAuthLoading(false);
    }
  }

  // Keep ref current so the Google callback always calls the latest version
  googleLoginRef.current = handleGoogleLogin;

  useEffect(() => {
    if (!authModalOpen || !googleReady || !GOOGLE_CLIENT_ID) return;
    const win = window as GoogleWindow;
    const google = win.google;
    if (!google?.accounts?.id) return;

    // Always re-initialize so the callback is fresh (Google GSI allows re-init)
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (resp: { credential?: string }) => {
        const idToken = String(resp?.credential || "");
        googleLoginRef.current(idToken);
      }
    });

    if (googleBtnRef.current) {
      googleBtnRef.current.innerHTML = "";
      google.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 260
      });
    }
  }, [authModalOpen, googleReady]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  async function handleExplain() {
    setLoading(true);
    setLoadingProvider(selectedProvider);
    setResult(null);
    setFlashcardsOpen(false);
    setErrorMessage("");
    setActiveModel("");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 50000);

    try {
      const reviewRes = await fetch(`${API_BASE_URL}/api/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          code,
          provider: selectedProvider,
          reviewType: selectedReviewType,
          outputLanguage: selectedLanguageLabel,
          codeLanguage: "javascript"
        })
      });

      let data: ExplainResp;
      if (reviewRes.ok) {
        data = await reviewRes.json();
      } else {
        const legacyRes = await fetch(`${API_BASE_URL}/api/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            code,
            outputLanguage: selectedLanguageLabel,
            codeLanguage: "javascript"
          })
        });

        if (!legacyRes.ok) {
          throw new Error(await parseApiError(reviewRes));
        }

        const legacyData = await legacyRes.json();
        data = {
          ...legacyData,
          provider: "groq",
          model: "legacy-groq"
        };
      }
      setResult(data);
      setActiveModel(String(data.model || ""));
      const transcript = data.transcript ?? `${data.summary ?? ""} ${(data.responsibilities ?? []).join(". ")}`.trim();
      setAvatarTranscript(transcript);
      setAutoPlayAvatar(true);
      setAvatarOpen(true);

      if (editorRef.current && data.used_lines?.length) {
        const monaco = (window as any).monaco;
        const decs = data.used_lines.map((r: string) => {
          const [s, e] = r.split("-").map((x) => parseInt(x, 10));
          return {
            range: new monaco.Range(s, 1, e, 1),
            options: { isWholeLine: true, className: "myLineDecoration" }
          };
        });

        (editorRef.current as any).deltaDecorations([], decs);
        const firstStart = parseInt(data.used_lines[0].split("-")[0], 10);
        (editorRef.current as any).revealLineInCenter(firstStart);
      }
    } catch (err: any) {
      const fallback = "Could not generate explanation. Check backend status and API key.";
      if (err?.name === "AbortError") {
        setErrorMessage("Request timed out. The selected AI provider took too long.");
      } else {
        setErrorMessage(err?.message || fallback);
      }
      console.error(err);
    } finally {
      window.clearTimeout(timeout);
      setLoadingProvider(null);
      setLoading(false);
    }
  }

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = authMode === "login"
        ? { email: authForm.email, password: authForm.password }
        : { name: authForm.name, email: authForm.email, password: authForm.password };

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      const payload = await res.json();
      const token = payload.token as string;
      if (!token) throw new Error("No auth token received");

      localStorage.setItem(AUTH_TOKEN_KEY, token);
      const uid = payload.user?.id || payload.user?.userId;
      if (uid) {
        localStorage.setItem("userId", uid);
        localStorage.setItem("user", JSON.stringify(payload.user));
      }
      setAuthToken(token);
      setUser(payload.user || null);
      setAuthModalOpen(false);
      setAuthForm({ name: "", email: "", password: "" });
      if (payload.linked_password) {
        // Non-blocking toast — account was a Google-only account, password now linked
        console.info("[Auth] Password linked to Google account successfully");
      }
    } catch (err: any) {
      setAuthError(err?.message || "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  void handleAuthSubmit;

  function handleLogout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
    setAnalytics(null);
    setStudyPlan(null);
  }

  async function loadAnalytics() {
    if (!authToken) {
      setAnalyticsError("Login required to load analytics.");
      setAnalytics(null);
      return;
    }
    setAnalyticsLoading(true);
    setAnalyticsError("");

    try {
      const endpoints = ["/api/analytics", "/api/analytics/dashboard"];
      let loaded = false;
      let lastError = "Analytics endpoint not available";

      for (const endpoint of endpoints) {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });

        if (res.ok) {
          const payload = await res.json();
          const normalized = normalizeAnalyticsPayload(payload);

          // Fetch arena results in parallel
          try {
            const arenaRes = await fetch(`${API_BASE_URL}/api/arena/leaderboard`);
            if (arenaRes.ok) {
              const arenaData = await arenaRes.json();
              const studentId = user?.studentId || localStorage.getItem("userId") || "";
              const myEntry = (arenaData.leaderboard || []).find((e: any) => e.studentId === studentId);
              if (myEntry) {
                // Also fetch individual match history from DynamoDB
                normalized.arenaResults = {
                  wins: myEntry.wins || 0,
                  losses: myEntry.losses || 0,
                  avg_score: myEntry.avg_score || 0,
                  matches: []
                };
              }
            }
          } catch {}

          setAnalytics(normalized);
          loaded = true;
          break;
        }

        if (res.status === 404) {
          lastError = `Analytics endpoint missing: ${endpoint}`;
          continue;
        }

        lastError = await parseApiError(res);
        break;
      }

      if (!loaded) {
        throw new Error(lastError);
      }
    } catch (err: any) {
      setAnalyticsError(err?.message || "Failed to load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function generateStudyPlan() {
    if (!authToken) return;
    setPlanLoading(true);
    setAnalyticsError("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/study-plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ outputLanguage: selectedLanguageLabel })
      });

      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setStudyPlan(payload.plan || null);
    } catch (err: any) {
      setAnalyticsError(err?.message || "Failed to generate study plan");
    } finally {
      setPlanLoading(false);
    }
  }

  async function askQuestion(questionText?: string) {
    const question = (questionText ?? askInput).trim();
    if (!question) return;

    const outgoing: ChatMessage = { role: "user", content: question };
    const history = [...askMessages, outgoing].slice(-10);

    setAskMessages((prev) => [...prev, outgoing]);
    setAskInput("");
    setAskLoading(true);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch(`${API_BASE_URL}/api/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          question,
          code,
          outputLanguage: selectedLanguageLabel,
          history
        })
      });

      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();

      setAskMessages((prev) => [...prev, { role: "assistant", content: payload.answer || "No answer received." }]);
      setAskFollowups(Array.isArray(payload.followups) ? payload.followups : []);
    } catch (err: any) {
      setAskMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err?.message || "Could not answer now."}` }]);
    } finally {
      setAskLoading(false);
    }
  }

  function getSpeechLocale(langCode: string) {
    if (langCode === "hi") return "hi-IN";
    if (langCode === "es") return "es-ES";
    if (langCode === "fr") return "fr-FR";
    if (langCode === "de") return "de-DE";
    if (langCode === "ta") return "ta-IN";
    if (langCode === "te") return "te-IN";
    return "en-US";
  }

  function startVoiceInput() {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setAskMessages((prev) => [...prev, { role: "assistant", content: "Speech recognition is not supported in this browser." }]);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = getSpeechLocale(selectedLanguage);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setSpeechListening(true);
    recognition.onerror = (event: any) => {
      setSpeechListening(false);
      setAskMessages((prev) => [...prev, { role: "assistant", content: `Mic error: ${event?.error || "speech recognition failed"}` }]);
    };
    recognition.onend = () => setSpeechListening(false);
    recognition.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || "").trim();
      if (transcript) {
        setAskInput(transcript);
      }
    };

    recognition.start();
  }

  function startSplitResize(ev: React.MouseEvent<HTMLDivElement>) {
    ev.preventDefault();
    resizingSplitRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function renderMentorMessage(content: string) {
    const chunks = parseMentorContent(content);
    return chunks.map((chunk, idx) => {
      if (chunk.kind === "code") {
        return (
          <pre key={`code-${idx}`} className="ask-code-block">
            <code>{chunk.value}</code>
          </pre>
        );
      }
      return (
        <p key={`text-${idx}`} className="ask-text-block">
          {chunk.value}
        </p>
      );
    });
  }

  const homePage = (
    <>
      <div style={{ padding: "16px 24px 0" }}>
        <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", alignItems: "start" }}>
          <ImpostorBadge />
        </div>
      </div>
      <div className="app-shell">
      <div className="app-main" ref={splitLayoutRef} style={{ ["--editor-width" as any]: `${editorWidthPct}%` }}>
        <section className="editor-panel">
          <div className="editor-toolbar">
            <div className="hero-copy">
              <p className="code-kicker">{"// Graph-native engineering coach"}</p>
              <h1 className="app-title">Graph-Powered Skill Intelligence</h1>
              <p className="app-subtitle">Know why you struggle. Not just what.</p>
              <div className="hero-badge">
                <span>Powered by TigerGraph {"\u26A1"}</span>
              </div>
              <div className="hero-preview-grid">
                <article className="hero-preview-card">
                  <span className="preview-label">Skill Map Preview</span>
                  <h3>Trace prerequisite gaps before they become blind spots.</h3>
                  <p>See the bridge between strong concepts, weak nodes, and the exact path to recover momentum.</p>
                  <div className="mini-skill-graph" aria-hidden="true">
                    <span className="mini-node core" />
                    <span className="mini-node stable" />
                    <span className="mini-node bridge" />
                    <span className="mini-node weak" />
                  </div>
                  <div className="mini-legend">
                    <span>Core topic</span>
                    <span>Mastered</span>
                    <span>Weak node</span>
                  </div>
                </article>
                <article className="hero-preview-card">
                  <span className="preview-label">Knowledge Debt Score</span>
                  <h3>Catch hidden friction before it slows your next review.</h3>
                  <p>A fast signal for prerequisite drag, fragile understanding, and what needs attention next.</p>
                  <div className="knowledge-score">
                    <strong>{knowledgeDebtScore}</strong>
                    <span>/ 100 debt index</span>
                  </div>
                  <div className="debt-meter" aria-hidden="true">
                    <div className="debt-meter-fill" style={{ width: `${knowledgeDebtScore}%` }} />
                  </div>
                  <div className="debt-footnote">
                    <span>{analytics ? `${analytics.weakTopics.length || 0} weak clusters live` : "Live after your next scan"}</span>
                    <span>{analytics ? `${analytics.recommendedPracticeMinutes || 45} min recovery plan` : "TigerGraph inference ready"}</span>
                  </div>
                </article>
              </div>
              <div className="study-flow" style={{ marginTop: "16px" }}>
                {STUDY_MILESTONES.map((step, index) => (
                  <span key={step} className="study-chip">{`${index + 1}. ${step}`}</span>
                ))}
              </div>
            </div>
            <div className="toolbar-actions">
              <label className="lang-control">
                <span>Explanation language</span>
                <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}>
                  {EXPLANATION_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.label}</option>
                  ))}
                </select>
              </label>

              <label className="lang-control">
                <span>AI provider</span>
                <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value as AIProvider)}>
                  {AI_PROVIDER_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>

              {selectedProvider === "gemma" && (
                <label className="lang-control">
                  <span>Review depth</span>
                  <select value={selectedReviewType} onChange={(e) => setSelectedReviewType(e.target.value as ReviewType)}>
                    {GEMMA_REVIEW_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="provider-readiness">
                <span className={providerReady.groq ? "ready" : "not-ready"}>Groq: {providerReady.groq ? "ready" : "not set"}</span>
                <span className={providerReady.gemma ? "ready" : "not-ready"}>Gemma: {providerReady.gemma ? "ready" : "not set"}</span>
              </div>

              <button onClick={handleExplain} disabled={loading} className="btn-primary" style={{ fontSize: "1rem", padding: "13px 18px" }}>
                {loading
                  ? `Analyzing with ${loadingProvider === "gemma" ? (selectedReviewType === "detailed" ? "Gemma 12B" : "Gemma 4B") : "Groq"}...`
                  : "Explain Code"}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="error-banner">
              {errorMessage}
            </div>
          )}

          <p className="editor-context-note">
            Paste code here. In Quiz Studio, you can generate quizzes with AI or upload your own quiz JSON, and this code can be reused as optional AI quiz context.
          </p>

          <div className="editor-frame">
            <Editor
              height="62vh"
              theme="vs-dark"
              defaultLanguage="javascript"
              defaultValue={code}
              value={code}
              onMount={handleEditorMount}
              onChange={(v) => setCode(v ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "JetBrains Mono, Consolas, monospace",
                smoothScrolling: true,
                padding: { top: 16 }
              }}
            />
          </div>
        </section>

        <div
          className="layout-resizer"
          onMouseDown={startSplitResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor and results panels"
        />

        <aside className="results-panel">
          <div className="results-header">
            <div className="results-headline">
              <h2>Results</h2>
              {(result?.provider || activeModel) && (
                <span className="confidence-chip model-chip">
                  {`${String(result?.provider || selectedProvider).toUpperCase()}${result?.model || activeModel ? ` | ${result?.model || activeModel}` : ""}`}
                </span>
              )}
              {result?.fallbackFrom && (
                <span className="confidence-chip fallback-chip">{`fallback from ${result.fallbackFrom}`}</span>
              )}
              {result?.confidence && <span className={`confidence-chip ${result.confidence}`}>{`${result.confidence} confidence`}</span>}
            </div>
            <div className="results-actions">
              <button
                onClick={() => setFlashcardsOpen((prev) => !prev)}
                disabled={!result}
                className={`btn-secondary result-action-btn action-flash ${flashcardsOpen ? "active" : ""}`}
              >
                {flashcardsOpen ? "Minimize Flashcards" : "Open Flashcards"}
              </button>
              <button
                onClick={() => setAskOpen((prev) => !prev)}
                disabled={!result}
                className={`btn-secondary result-action-btn action-ask ${askOpen ? "active" : ""}`}
              >
                {askOpen ? "Minimize AI Mentor" : "Open AI Mentor"}
              </button>
              <button
                onClick={() => {
                  if (!result) {
                    const ok = window.confirm("No explanation exists yet. Create an empty quiz anyway?");
                    if (!ok) return;
                  }
                  setQuizModalOpen(true);
                }}
                className="btn-secondary result-action-btn action-quiz"
              >
                Open Quiz Studio
              </button>
            </div>
          </div>

          {!result && (
            <div className="empty-state">
              <p>No results yet. Click Explain Code to generate an analysis.</p>
              <ul className="starter-list">
                <li>Pick your explanation language first.</li>
                <li>Ask the tutor voice to read the transcript.</li>
                <li>Use Flashcards for one-line revision.</li>
                <li>Log in to save profile + long-term analytics.</li>
              </ul>
            </div>
          )}

          {result && (
            <>
              <div className="results-content">
                <section className="result-block">
                  <h3>Summary</h3>
                  <p>{result.summary}</p>
                </section>

                <section className="result-block">
                  <h3>Responsibilities</h3>
                  <ul>
                    {result.responsibilities?.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </section>

                <section className="result-block">
                  <h3>Edge Cases</h3>
                  <ul>
                    {result.edge_cases?.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </section>

                {result.suggested_unit_test && (
                  <section className="result-block">
                    <h3>Suggested Unit Test</h3>
                    <pre>{result.suggested_unit_test}</pre>
                  </section>
                )}
              </div>
            </>
          )}

        </aside>
      </div>

      <Modal
        open={quizModalOpen}
        onClose={() => {
          if (quizLocked) return;
          setQuizModalOpen(false);
          setQuizLocked(false);
        }}
        disableClose={quizLocked}
        title={quizLocked ? "Quiz Manager (Proctored Attempt Active)" : "Quiz Manager"}
        panelStyle={{ width: "min(1180px, 96vw)", maxHeight: "90vh" }}
        contentStyle={{ padding: 18, maxHeight: "82vh" }}
      >
        <QuizManager
          apiBaseUrl={API_BASE_URL}
          preferredLanguage={selectedLanguageLabel}
          contextCode={code}
          authToken={authToken}
          onAttemptRecorded={loadAnalytics}
          onProctorLockChange={setQuizLocked}
        />
      </Modal>

      <Modal open={flashcardsOpen} onClose={() => setFlashcardsOpen(false)} title="Revision Flashcards">
        <section style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "4px 0" }}>
          {!result && (
            <p style={{ color: "#64748b" }}>No key takeaways available yet. Click Explain Code first.</p>
          )}

          {result && (() => {
            // Build flip cards: prefer API flashcards, fall back to synthesized ones
            const cards: { q: string; a: string }[] = [];
            if (result.flashcards?.length) {
              cards.push(...result.flashcards);
            } else {
              // Synthesize from result data
              if (result.summary) cards.push({ q: "What does this code do?", a: result.summary });
              (result.responsibilities || []).forEach((r, i) => {
                cards.push({ q: `Responsibility ${i + 1}`, a: r });
              });
              (result.edge_cases || []).forEach((e, i) => {
                cards.push({ q: `Edge case ${i + 1}?`, a: e });
              });
            }
            if (cards.length === 0) return <p style={{ color: "#64748b" }}>No flashcards generated.</p>;
            return cards.slice(0, 8).map((card, i) => (
              <FlipCard key={`fc-${i}`} front={card.q} back={card.a} index={i} />
            ));
          })()}
        </section>
      </Modal>

      <Modal open={askOpen} onClose={() => setAskOpen(false)} title="Interactive Mentor Q&A">
        <section className="ask-panel ask-popup">
          <div className="ask-messages">
            {askMessages.length === 0 && <p className="ask-empty">Ask follow-up doubts about the current code.</p>}
            {askMessages.map((msg, idx) => (
              <article key={`${msg.role}-${idx}`} className={`ask-msg ${msg.role}`}>
                <strong>{msg.role === "user" ? "You" : "Mentor"}</strong>
                <div className="ask-msg-content">{renderMentorMessage(msg.content)}</div>
              </article>
            ))}
          </div>

          <div className="ask-input-row">
            <input
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              placeholder="Ask a concept or code question"
            />
            <button className="btn-tertiary" onClick={startVoiceInput} disabled={!speechSupported || speechListening}>
              {speechListening ? "Listening..." : "Mic"}
            </button>
            <button className="btn-tertiary" onClick={() => askQuestion()} disabled={askLoading}>{askLoading ? "Thinking..." : "Ask"}</button>
          </div>

          {askFollowups.length > 0 && (
            <div className="followups">
              {askFollowups.map((f) => (
                <button key={f} className="followup-btn" onClick={() => askQuestion(f)}>{f}</button>
              ))}
            </div>
          )}
        </section>
      </Modal>

      <Modal open={authModalOpen} onClose={() => setAuthModalOpen(false)} title="Sign In">
        <div className="auth-form" style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "8px 0" }}>
          <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "0.92rem", lineHeight: 1.6 }}>
            Sign in with your Google account to unlock analytics, skill tracking, and personalized coaching.
          </div>

          {authError && (
            <div className="auth-error">{authError}</div>
          )}

          {/* Hidden GSI button for initialization */}
          <div ref={googleBtnRef} style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0, overflow: "hidden" }} />

          <button
            type="button"
            onClick={() => {
              const g = (window as GoogleWindow).google;
              if (g?.accounts?.id) {
                g.accounts.id.prompt();
              }
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "14px",
              padding: "14px 24px",
              borderRadius: "14px",
              border: "none",
              background: "#fff",
              color: "#3c4043",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "box-shadow 0.25s, transform 0.15s",
              boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
              fontFamily: "'Google Sans', Roboto, sans-serif",
              letterSpacing: "0.01em",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 24px rgba(0,0,0,0.32)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 14px rgba(0,0,0,0.2)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
          >
            <svg width="22" height="22" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            Continue with Google
          </button>

          <div style={{ textAlign: "center", fontSize: "0.75rem", color: "#475569" }}>
            Powered by Google OAuth 2.0
          </div>
        </div>
      </Modal>

      <Modal open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} title="Learning Analytics Dashboard">
        <div className="analytics-panel">
          <div className="analytics-actions">
            <button className="btn-tertiary" onClick={loadAnalytics} disabled={analyticsLoading}>{analyticsLoading ? "Refreshing..." : "Refresh"}</button>
            <button className="btn-secondary analytics-plan-btn" onClick={generateStudyPlan} disabled={!authToken || planLoading}>{planLoading ? "Generating..." : "Generate 7-Day Study Plan"}</button>
          </div>

          {analyticsError && <div className="auth-error">{analyticsError}</div>}

          {analytics && (
            <>
              <div className="analytics-grid">
                <article><strong>{analytics.totalAttempts}</strong><span>Total attempts</span></article>
                <article><strong>{analytics.avgScore}%</strong><span>Average score</span></article>
                <article><strong>{analytics.questionsAsked}</strong><span>Questions asked</span></article>
                <article><strong>{analytics.proctorFlags}</strong><span>Proctor flags</span></article>
              </div>

              <section className="analytics-card">
                <h4>Badges</h4>
                <div className="badge-list">
                  {(analytics.badges.length ? analytics.badges : ["start-your-journey"]).map((badge) => (
                    <span key={badge} className="badge-pill">{badge}</span>
                  ))}
                </div>
              </section>

              <section className="analytics-card">
                <h4>Weak Topics</h4>
                {analytics.weakTopics.length === 0 && <p>No weak-topic data yet.</p>}
                {analytics.weakTopics.map((w) => (
                  <div key={w.topic} className="weak-row"><span>{w.topic}</span><strong>{w.count}</strong></div>
                ))}
              </section>

              <section className="analytics-card">
                <h4>Improvement Snapshot</h4>
                <div className="analytics-grid">
                  <article><strong>{analytics.improvementPercentage ?? 0}%</strong><span>Improvement</span></article>
                  <article><strong>{analytics.completionRate ?? 0}%</strong><span>Completion rate</span></article>
                  <article><strong>{analytics.recommendedPracticeMinutes ?? 45} min</strong><span>Daily target</span></article>
                </div>
              </section>

              <section className="analytics-card">
                <h4>Quiz Score Trend</h4>
                {analytics.scoreTrend.length === 0 ? <p>No attempts yet.</p> : <Line data={scoreTrendChartData} />}
              </section>

              <section className="analytics-card">
                <h4>Topic Accuracy</h4>
                {(analytics.topicAccuracy || []).length === 0 ? <p>No topic accuracy yet.</p> : <Bar data={topicAccuracyData} />}
              </section>

              <section className="analytics-card">
                <h4>Weekly Study Activity</h4>
                {(analytics.weeklyActivity || []).length === 0 ? <p>No activity yet.</p> : <Bar data={weeklyActivityData} />}
              </section>

              <section className="analytics-card">
                <h4>Recent Attempts</h4>
                <div className="plan-list">
                  {(analytics.recentAttempts || []).slice(-6).map((attempt, idx) => (
                    <article key={`${attempt.quizTitle}-${attempt.createdAt}-${idx}`}>
                      <strong>{attempt.quizTitle || "Quiz"}</strong>
                      <p>{`${attempt.score}% (${attempt.totalQuestions} Q)`}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="analytics-card">
                <h4>Arena Battle Results</h4>
                {analytics.arenaResults ? (
                  <>
                    <div className="analytics-grid">
                      <article><strong>{analytics.arenaResults.wins}</strong><span>Wins</span></article>
                      <article><strong>{analytics.arenaResults.losses}</strong><span>Losses</span></article>
                      <article><strong>{analytics.arenaResults.avg_score}%</strong><span>Avg Score</span></article>
                    </div>
                    {analytics.arenaResults.matches.length > 0 && (
                      <div className="plan-list" style={{ marginTop: "10px" }}>
                        {analytics.arenaResults.matches.slice(-5).map((m, i) => (
                          <article key={`arena-${i}`}>
                            <strong>{m.problemTitle || "Arena Battle"}</strong>
                            <p>{`Score: ${m.score}% — ${new Date(m.timestamp).toLocaleDateString()}`}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p>No arena battles yet. Head to the Arena to compete!</p>
                )}
              </section>
            </>
          )}

          {studyPlan && (
            <section className="analytics-card">
              <h4>{studyPlan.title || "7-Day Plan"}</h4>
              <div className="plan-list">
                {(studyPlan.days || []).map((d) => (
                  <article key={d.day}>
                    <strong>{`${d.day} (${d.practiceMinutes} mins)`}</strong>
                    <p>{d.topics.join(", ")}</p>
                    <p>{d.tasks.join(" | ")}</p>
                  </article>
                ))}
              </div>
              {studyPlan.weakTopics?.length > 0 && (
                <p>{`Weak topics focus: ${studyPlan.weakTopics.join(", ")}`}</p>
              )}
              {studyPlan.quizSuggestions?.length > 0 && (
                <ul>
                  {studyPlan.quizSuggestions.map((item, i) => <li key={`${item}-${i}`}>{item}</li>)}
                </ul>
              )}
              {studyPlan.revisionReminders?.length > 0 && (
                <ul>
                  {studyPlan.revisionReminders.map((item, i) => <li key={`${item}-${i}`}>{item}</li>)}
                </ul>
              )}
              {(studyPlan.tips || []).length > 0 && (
                <ul>
                  {studyPlan.tips?.map((tip, i) => <li key={`${tip}-${i}`}>{tip}</li>)}
                </ul>
              )}
            </section>
          )}
        </div>
      </Modal>

      <style>{`.myLineDecoration { background: rgba(99, 102, 241, 0.18) !important; border-left: 2px solid rgba(129, 140, 248, 0.9); }`}</style>

      <ChatbotAvatarSync
        transcript={transcriptString}
        lang={selectedLanguage}
        apiBaseUrl={API_BASE_URL}
        startOpen={avatarOpen || !!result}
        autoPlay={autoPlayAvatar}
      />
      </div>
    </>
  );

  const [demoOpen, setDemoOpen] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [, setDemoShown] = useState(() => localStorage.getItem("demo-shown") === "1");

  // Auto-show demo once for first-time visitors
  useEffect(() => {
    if (localStorage.getItem("demo-shown") !== "1") {
      const t = setTimeout(() => setDemoOpen(true), 900);
      return () => clearTimeout(t);
    }
  }, []);

  const DEMO_STEPS = [
    {
      icon: "\uD83D\uDD10",
      title: "Sign In with Google",
      route: "/",
      color: "#6366f1",
      description: "Create your account in one click. Your profile is stored in DynamoDB and linked to TigerGraph's knowledge graph. Every action from here builds your personal learning profile.",
      action: "Click Sign In → Continue with Google",
    },
    {
      icon: "\uD83E\uDDE0",
      title: "Code Explainer + Flashcards",
      route: "/",
      color: "#818cf8",
      description: "Paste any code and click Explain Code. The AI generates a full breakdown — summary, responsibilities, edge cases, and interactive flip-card flashcards for revision. Open the AI Mentor to ask follow-up doubts.",
      action: "Paste code → Explain Code → open Flashcards",
    },
    {
      icon: "\uD83D\uDCDD",
      title: "AI Quiz Studio",
      route: "/",
      color: "#a78bfa",
      description: "Open Quiz Studio and generate an AI-powered quiz on any topic. Choose proctored mode for fullscreen lock + tab-switch detection. Answers are graded with AI feedback, and weak areas are written to your TigerGraph profile.",
      action: "Open Quiz Studio → Generate Quiz → Begin Quiz",
    },
    {
      icon: "\uD83D\uDDFA\uFE0F",
      title: "Skill Intelligence Map",
      route: "/skill-map",
      color: "#22c55e",
      description: "TigerGraph traverses your weak_in edges and prerequisite chains to build a live knowledge graph. Red nodes = critical weaknesses, amber = needs work, green = strong. Knowledge Debt shows what to fix first.",
      action: "Go to Skill Map → see your graph → click AI Analyze",
    },
    {
      icon: "\uD83D\uDCA1",
      title: "Graph AI Chat",
      route: "/",
      color: "#06b6d4",
      description: "The Graph AI uses a LangChain ReAct agent with 3 TigerGraph tools — skill gaps, prerequisite chains, and peer matching. It queries YOUR graph data live to give personalized answers. Look for the 'Graph-Powered' badge.",
      action: "Click Ask Graph AI → type a question → see graph-powered answer",
    },
    {
      icon: "\u2694\uFE0F",
      title: "Live Coding Arena",
      route: "/arena",
      color: "#f59e0b",
      description: "Battle the AI opponent! TigerGraph finds your weak concepts, the AI generates a tailored problem, you write code that runs against real test cases via Piston API. Results update your graph — the system learns from every battle.",
      action: "Go to Arena → Compete vs AI → solve & submit",
    },
    {
      icon: "\uD83D\uDCCA",
      title: "Analytics Dashboard",
      route: "/",
      color: "#ec4899",
      description: "Track your quiz scores, arena battle results, improvement trends, weak topics, and badges. Generate a 7-day AI study plan based on your analytics. Every interaction feeds back into TigerGraph — the graph gets smarter over time.",
      action: "Click Analytics → view scores → Generate Study Plan",
    },
  ];

  function openDemo() {
    setDemoStep(0);
    setDemoOpen(true);
  }

  function closeDemoAndMark() {
    setDemoOpen(false);
    localStorage.setItem("demo-shown", "1");
    setDemoShown(true);
  }

  return (
    <BrowserRouter>
      {/* ── Navbar ── */}
      <div className="demo-nav">
        <div className="demo-nav-brand">
          <span className="demo-nav-brand-icon" aria-hidden="true">{"\u25C8"}</span>
          <span>CodeCoach</span>
        </div>

        <div className="demo-nav-links">
          <NavLink to="/" end className={({ isActive }) => `demo-nav-link${isActive ? " active" : ""}`}>
            Home
          </NavLink>
          <NavLink to="/skill-map" className={({ isActive }) => `demo-nav-link${isActive ? " active" : ""}`}>
            {"\u25C9"} Skill Map
          </NavLink>
          <NavLink to="/arena" className={({ isActive }) => `demo-nav-link${isActive ? " active" : ""}`}>
            {"\u2694"} Arena
          </NavLink>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Backend health */}
          <span className={`backend-pill ${backendHealth}`} style={{ fontSize: "0.72rem" }}>
            {backendHealth === "online" ? "● Backend online" : backendHealth === "offline" ? "● Offline" : "● Checking"}
          </span>

          {/* Theme */}
          <button
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            className="theme-toggle"
            style={{ padding: "6px 10px", fontSize: "0.78rem" }}
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>

          {/* Demo button */}
          <button
            onClick={openDemo}
            style={{
              padding: "7px 14px", borderRadius: "999px", fontSize: "0.8rem", fontWeight: 700,
              border: "1px solid rgba(245,158,11,0.4)",
              background: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(239,68,68,0.1))",
              color: "#fbbf24", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px"
            }}
          >
            🎯 Judge Demo
          </button>

          {/* Auth */}
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="user-pill">{user.name}</span>
              <button className="tiny-btn" onClick={() => { setAnalyticsOpen(true); loadAnalytics(); }} style={{ padding: "6px 10px", fontSize: "0.78rem" }}>Analytics</button>
              <button className="tiny-btn ghost" onClick={handleLogout} style={{ padding: "6px 10px", fontSize: "0.78rem" }}>Logout</button>
            </div>
          ) : (
            <button
              className="btn-primary"
              onClick={() => setAuthModalOpen(true)}
              style={{ padding: "8px 16px", fontSize: "0.82rem" }}
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      <Routes>
        <Route path="/" element={homePage} />
        <Route path="/skill-map" element={<SkillMapPage />} />
        <Route path="/arena" element={<ArenaPage />} />
      </Routes>

      <GraphAgentChat />

      {/* ── Demo Flow Modal ── */}
      {demoOpen && (() => {
        const step = DEMO_STEPS[demoStep];
        return (
          <div style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(5,5,10,0.85)", backdropFilter: "blur(12px)",
            display: "grid", placeItems: "center", padding: "24px"
          }}>
            <div style={{
              width: "min(560px, 100%)", borderRadius: "24px",
              background: "#111118", border: "1px solid rgba(99,102,241,0.22)",
              boxShadow: "0 40px 100px rgba(0,0,0,0.7)",
              overflow: "hidden"
            }}>
              {/* Progress bar */}
              <div style={{ height: "3px", background: "#1e1e2e" }}>
                <div style={{
                  height: "100%", transition: "width 0.4s ease",
                  width: `${((demoStep + 1) / DEMO_STEPS.length) * 100}%`,
                  background: `linear-gradient(90deg, #6366f1, ${step.color})`
                }} />
              </div>

              <div style={{ padding: "32px 32px 28px" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
                  <div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#475569", marginBottom: "6px" }}>
                      Step {demoStep + 1} of {DEMO_STEPS.length}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "48px", height: "48px", borderRadius: "16px", fontSize: "1.5rem",
                        display: "grid", placeItems: "center",
                        background: `linear-gradient(135deg, ${step.color}22, ${step.color}08)`,
                        border: `1px solid ${step.color}44`
                      }}>
                        {step.icon}
                      </div>
                      <h2 style={{ margin: 0, color: "#f1f5f9", fontSize: "1.25rem", fontWeight: 800 }}>
                        {step.title}
                      </h2>
                    </div>
                  </div>
                  <button onClick={closeDemoAndMark} style={{ background: "none", border: "none", color: "#475569", fontSize: "1.4rem", cursor: "pointer", padding: "0 4px" }}>×</button>
                </div>

                {/* Description */}
                <p style={{ margin: "0 0 20px", color: "#94a3b8", lineHeight: 1.75, fontSize: "0.97rem" }}>
                  {step.description}
                </p>

                {/* Action hint */}
                <div style={{
                  padding: "14px 16px", borderRadius: "12px",
                  background: `linear-gradient(135deg, ${step.color}12, ${step.color}06)`,
                  border: `1px solid ${step.color}28`,
                  color: step.color, fontSize: "0.88rem", fontWeight: 600,
                  marginBottom: "24px"
                }}>
                  👉 {step.action}
                </div>

                {/* Step dots */}
                <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "24px" }}>
                  {DEMO_STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setDemoStep(i)}
                      style={{
                        width: i === demoStep ? "24px" : "8px", height: "8px",
                        borderRadius: "999px", border: "none", cursor: "pointer",
                        background: i === demoStep ? step.color : "#2a2a3d",
                        transition: "all 0.3s ease", padding: 0
                      }}
                    />
                  ))}
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", gap: "10px" }}>
                  {demoStep > 0 && (
                    <button
                      onClick={() => setDemoStep((s) => s - 1)}
                      style={{
                        flex: 1, padding: "12px", borderRadius: "12px", fontWeight: 600,
                        border: "1px solid #2a2a3d", background: "#161622",
                        color: "#94a3b8", cursor: "pointer", fontSize: "0.92rem"
                      }}
                    >
                      ← Back
                    </button>
                  )}
                  {demoStep < DEMO_STEPS.length - 1 ? (
                    <button
                      onClick={() => setDemoStep((s) => s + 1)}
                      style={{
                        flex: 2, padding: "12px", borderRadius: "12px", fontWeight: 700,
                        border: "none",
                        background: `linear-gradient(135deg, #6366f1, ${step.color})`,
                        color: "#fff", cursor: "pointer", fontSize: "0.92rem"
                      }}
                    >
                      Next Feature →
                    </button>
                  ) : (
                    <button
                      onClick={closeDemoAndMark}
                      style={{
                        flex: 2, padding: "12px", borderRadius: "12px", fontWeight: 700,
                        border: "none",
                        background: "linear-gradient(135deg, #6366f1, #22c55e)",
                        color: "#fff", cursor: "pointer", fontSize: "0.92rem"
                      }}
                    >
                      🚀 Start Exploring
                    </button>
                  )}
                </div>

                <p style={{ textAlign: "center", margin: "16px 0 0", fontSize: "0.78rem", color: "#334155" }}>
                  Reopen anytime via the <strong style={{ color: "#475569" }}>🎯 Judge Demo</strong> button in the nav
                </p>
              </div>
            </div>
          </div>
        );
      })()}

    </BrowserRouter>
  );
}
