import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import Modal from "./components/Modal";
import QuizManager from "./components/QuizManager";
import ChatbotAvatarSync from "./components/ChatbotAvatarSync";
import "./App.css";

type ExplainResp = {
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
  recentAttempts: {
    id: string;
    quizTitle: string;
    score: number;
    totalQuestions: number;
    createdAt: string;
  }[];
};

type StudyPlan = {
  title?: string;
  daily_plan?: { day: number; focus: string; task: string; practice_minutes: number }[];
  tips?: string[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type MentorContentChunk =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string; language: string };

type RunLanguage = "javascript" | "python" | "java" | "cpp" | "c" | "typescript" | "go" | "rust";

type GoogleWindow = Window & typeof globalThis & {
  google?: any;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
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
  const googleInitRef = useRef(false);
  const [code, setCode] = useState<string>(
    `// Example: sum function\nfunction sum(a, b) {\n  return a + b;\n}`
  );

  const [result, setResult] = useState<ExplainResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [backendHealth, setBackendHealth] = useState<BackendHealth>("checking");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [avatarOpen, setAvatarOpen] = useState<boolean>(false);
  const [avatarTranscript, setAvatarTranscript] = useState<string>("");
  const [autoPlayAvatar, setAutoPlayAvatar] = useState(false);
  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [flashcardsOpen, setFlashcardsOpen] = useState(false);
  const [editorWidthPct, setEditorWidthPct] = useState(66);
  const [editorOutputSplit, setEditorOutputSplit] = useState(68);
  const [runBusy, setRunBusy] = useState(false);
  const [runOutput, setRunOutput] = useState("");
  const [runError, setRunError] = useState("");
  const [runLanguage, setRunLanguage] = useState<RunLanguage>("javascript");

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

  const selectedLanguageLabel =
    EXPLANATION_LANGUAGES.find((lang) => lang.code === selectedLanguage)?.label ?? "English";

  const transcriptString =
    (avatarTranscript || result?.transcript) ??
    `${result?.summary ?? ""} ${(result?.responsibilities ?? []).join(". ")}`.trim();

  const quickFacts = useMemo(() => buildQuickFacts(result), [result]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("codecoach-theme", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;

    async function pingHealth() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/health`);
        if (!res.ok) throw new Error(String(res.status));
        if (active) setBackendHealth("online");
      } catch {
        if (active) setBackendHealth("offline");
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

  useEffect(() => {
    if (!authModalOpen || authMode !== "login" || !googleReady || !GOOGLE_CLIENT_ID) return;
    const win = window as GoogleWindow;
    const google = win.google;
    if (!google?.accounts?.id || !googleBtnRef.current) return;

    if (!googleInitRef.current) {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential?: string }) => {
          const idToken = String(resp?.credential || "");
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
            setAuthToken(token);
            setUser(payload.user || null);
            setAuthModalOpen(false);
          } catch (err: any) {
            setAuthError(err?.message || "Google sign-in failed");
          } finally {
            setAuthLoading(false);
          }
        }
      });
      googleInitRef.current = true;
    }

    googleBtnRef.current.innerHTML = "";
    google.accounts.id.renderButton(googleBtnRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      width: 260
    });
  }, [authModalOpen, authMode, googleReady]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  async function handleExplain() {
    setLoading(true);
    setResult(null);
    setFlashcardsOpen(false);
    setErrorMessage("");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 40000);

    try {
      const res = await fetch(`${API_BASE_URL}/api/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          code,
          outputLanguage: selectedLanguageLabel,
          codeLanguage: "javascript"
        })
      });

      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }

      const data = await res.json();
      setResult(data);
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
        setErrorMessage("Request timed out. The AI service took too long.");
      } else {
        setErrorMessage(err?.message || fallback);
      }
      console.error(err);
    } finally {
      window.clearTimeout(timeout);
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
      setAuthToken(token);
      setUser(payload.user || null);
      setAuthModalOpen(false);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (err: any) {
      setAuthError(err?.message || "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
    setAnalytics(null);
    setStudyPlan(null);
  }

  async function loadAnalytics() {
    if (!authToken) return;
    setAnalyticsLoading(true);
    setAnalyticsError("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/analytics/dashboard`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setAnalytics(payload.analytics || null);
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

  function startSplitResize(ev: React.MouseEvent<HTMLDivElement>) {
    ev.preventDefault();
    resizingSplitRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  async function runCodePreview() {
    setRunBusy(true);
    setRunError("");
    setRunOutput("Running...");

    try {
      const res = await fetch(`${API_BASE_URL}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: runLanguage, code })
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message || payload?.detail || `Execution failed (${res.status})`);
      }
      const combined = [payload.compileOutput, payload.stdout, payload.output, payload.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
      setRunOutput(combined || "No output.");
    } catch (err: any) {
      setRunError(err?.stack || err?.message || String(err));
      setRunOutput("");
    } finally {
      setRunBusy(false);
    }
  }

  function clearRunOutput() {
    setRunError("");
    setRunOutput("");
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

  return (
    <div className="app-shell">
      <div className="app-main" ref={splitLayoutRef} style={{ ["--editor-width" as any]: `${editorWidthPct}%` }}>
        <section className="editor-panel">
          <div className="editor-toolbar">
            <div className="hero-copy">
              <p className="code-kicker">{"// AI coding mentor for students"}</p>
              <h1 className="app-title">CodeCoach Studio</h1>
              <p className="app-subtitle">Get fast, structured code explanations with guided follow-up learning.</p>
              <div className="study-flow">
                {STUDY_MILESTONES.map((step, index) => (
                  <span key={step} className="study-chip">{`${index + 1}. ${step}`}</span>
                ))}
              </div>
              <p className="capability-note">
                Quiz Studio supports AI quiz generation, uploading your own quiz JSON, and Instructor Editor for custom sets, with optional proctored attempts.
              </p>
            </div>
            <div className="toolbar-actions">
              <div className="top-utility">
                <span className={`backend-pill ${backendHealth}`}>{backendHealth === "online" ? "Backend online" : backendHealth === "offline" ? "Backend offline" : "Checking backend"}</span>
                <button
                  onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                  className="theme-toggle"
                >
                  {theme === "dark" ? "Light" : "Dark"}
                </button>
              </div>

              <div className="auth-strip">
                {user ? (
                  <>
                    <span className="user-pill">{user.name}</span>
                    <button className="tiny-btn" onClick={() => { setAnalyticsOpen(true); loadAnalytics(); }}>Analytics</button>
                    <button className="tiny-btn ghost" onClick={handleLogout}>Logout</button>
                  </>
                ) : (
                  <button className="tiny-btn" onClick={() => setAuthModalOpen(true)}>Login / Register</button>
                )}
              </div>

              <label className="lang-control">
                <span>Explanation language</span>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                >
                  {EXPLANATION_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.label}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={handleExplain}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? "Explaining..." : "Explain Code"}
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
              height={`${editorOutputSplit}vh`}
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

          <div className="editor-output-slider-row">
            <span>Editor / Output Split</span>
            <input
              type="range"
              min={50}
              max={78}
              value={editorOutputSplit}
              onChange={(e) => setEditorOutputSplit(Number(e.target.value))}
            />
          </div>

          <section className="editor-terminal">
            <div className="terminal-toolbar">
              <strong>{`Code Output (${runLanguage})`}</strong>
              <div className="terminal-actions">
                <label className="terminal-lang">
                  <span>Language</span>
                  <select value={runLanguage} onChange={(e) => setRunLanguage(e.target.value as RunLanguage)}>
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                    <option value="c">C</option>
                    <option value="typescript">TypeScript</option>
                    <option value="go">Go</option>
                    <option value="rust">Rust</option>
                  </select>
                </label>
                <button className="btn-tertiary" onClick={runCodePreview} disabled={runBusy}>
                  {runBusy ? "Running..." : "Run Code"}
                </button>
                <button className="btn-tertiary" onClick={clearRunOutput} disabled={runBusy}>
                  Clear
                </button>
              </div>
            </div>
            <pre className={`terminal-output ${runError ? "error" : ""}`}>
              {runError || runOutput || "Click Run Code to execute your selected language and preview output here."}
            </pre>
            <p className="terminal-note">
              Code is executed by the backend runner service with language-specific runtimes and timeouts.
            </p>
          </section>
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

          <Modal open={quizModalOpen} onClose={() => setQuizModalOpen(false)} title="Quiz Manager">
            <QuizManager
              apiBaseUrl={API_BASE_URL}
              preferredLanguage={selectedLanguageLabel}
              contextCode={code}
              authToken={authToken}
              onAttemptRecorded={loadAnalytics}
            />
          </Modal>
        </aside>
      </div>

      <Modal open={flashcardsOpen} onClose={() => setFlashcardsOpen(false)} title="Revision Flashcards">
        <section className="flashcard-popup">
          {quickFacts.length === 0 && <p>No key takeaways available yet.</p>}
          {quickFacts.map((fact, i) => (
            <article key={`${fact}-${i}`} className="quick-card" style={{ animationDelay: `${i * 70}ms` }}>
              {fact}
            </article>
          ))}
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

      <Modal open={authModalOpen} onClose={() => setAuthModalOpen(false)} title={authMode === "login" ? "Login" : "Create Account"}>
        <form className="auth-form" onSubmit={handleAuthSubmit}>
          {authMode === "register" && (
            <label>
              Name
              <input value={authForm.name} onChange={(e) => setAuthForm((prev) => ({ ...prev, name: e.target.value }))} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={authForm.email} onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))} required />
          </label>
          <label>
            Password
            <input type="password" value={authForm.password} onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))} required minLength={6} />
          </label>
          {authError && <div className="auth-error">{authError}</div>}
          <div className="auth-actions">
            <button type="submit" className="btn-primary" disabled={authLoading}>{authLoading ? "Please wait..." : authMode === "login" ? "Login" : "Register"}</button>
            <button
              type="button"
              className="btn-tertiary"
              onClick={() => {
                setAuthError("");
                setAuthMode((prev) => (prev === "login" ? "register" : "login"));
              }}
            >
              {authMode === "login" ? "Need an account?" : "Already have an account?"}
            </button>
          </div>
          {authMode === "login" && GOOGLE_CLIENT_ID && (
            <div className="google-auth-wrap">
              <span>or</span>
              <div ref={googleBtnRef} />
            </div>
          )}
        </form>
      </Modal>

      <Modal open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} title="Learning Analytics Dashboard">
        <div className="analytics-panel">
          <div className="analytics-actions">
            <button className="btn-tertiary" onClick={loadAnalytics} disabled={analyticsLoading}>{analyticsLoading ? "Refreshing..." : "Refresh"}</button>
            <button className="btn-secondary" onClick={generateStudyPlan} disabled={!authToken || planLoading}>{planLoading ? "Generating..." : "Generate 7-Day Study Plan"}</button>
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
                <h4>Recent Scores</h4>
                {analytics.scoreTrend.length === 0 && <p>No attempts yet.</p>}
                <div className="trend-bars">
                  {analytics.scoreTrend.slice(-8).map((point, idx) => (
                    <div key={`${point.at}-${idx}`} className="trend-item">
                      <div className="trend-bar" style={{ height: `${Math.max(8, point.score)}%` }} />
                      <span>{point.score}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {studyPlan && (
            <section className="analytics-card">
              <h4>{studyPlan.title || "7-Day Plan"}</h4>
              <div className="plan-list">
                {(studyPlan.daily_plan || []).map((d) => (
                  <article key={d.day}>
                    <strong>{`Day ${d.day}: ${d.focus}`}</strong>
                    <p>{`${d.task} (${d.practice_minutes} mins)`}</p>
                  </article>
                ))}
              </div>
              {(studyPlan.tips || []).length > 0 && (
                <ul>
                  {studyPlan.tips?.map((tip, i) => <li key={`${tip}-${i}`}>{tip}</li>)}
                </ul>
              )}
            </section>
          )}
        </div>
      </Modal>

      <style>{`.myLineDecoration { background: rgba(251, 191, 36, 0.18) !important; border-left: 2px solid rgba(251, 191, 36, 0.8); }`}</style>

      <ChatbotAvatarSync
        transcript={transcriptString}
        lang={selectedLanguage}
        apiBaseUrl={API_BASE_URL}
        startOpen={avatarOpen || !!result}
        autoPlay={autoPlayAvatar}
      />
    </div>
  );
}

