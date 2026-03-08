import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import "./quiz-manager.css";

type QuestionLevel = "easy" | "medium" | "hard";
type QuestionType = "mcq" | "text" | "code";

type BaseQuestion = {
  id: string;
  type: QuestionType;
  q: string;
  level: QuestionLevel;
  points: number;
};

type MCQ = BaseQuestion & {
  type: "mcq";
  options: string[];
  correctIndex: number;
};

type TextQ = BaseQuestion & {
  type: "text";
  keywords?: string[];
};

type CodeQ = BaseQuestion & {
  type: "code";
  starterCode?: string;
  expectedKeyPoints?: string[];
};

type Question = MCQ | TextQ | CodeQ;

type Quiz = {
  title: string;
  description?: string;
  questions: Question[];
};

type Answer = {
  id: string;
  type: QuestionType;
  value: number | string | null;
  correct?: boolean | null;
  pointsAwarded?: number;
};

type CorrectAnswerFeedback = {
  questionId: string;
  correct: string;
  explanation: string;
  userAnswer: string | number | null;
  isCorrect: boolean;
};

type QuizAttempt = {
  quizId: string;
  quizTitle: string;
  attemptNumber: number;
  score: number;
  total: number;
  scorePercent: number;
  timestamp: string;
  correctAnswers?: CorrectAnswerFeedback[];
};

type QuizManagerProps = {
  apiBaseUrl?: string;
  preferredLanguage?: string;
  contextCode?: string;
  authToken?: string | null;
  onAttemptRecorded?: () => void;
  onProctorLockChange?: (locked: boolean) => void;
};

type GenerateType = "mixed" | QuestionType;
type GenerateDifficulty = "mixed" | QuestionLevel;

type GeneratorState = {
  topic: string;
  questionType: GenerateType;
  difficulty: GenerateDifficulty;
  count: number;
  contextCode: string;
};

type ProctorEvent = {
  type: string;
  detail: string;
  at: string;
};

const LEVEL_POINTS: Record<QuestionLevel, number> = {
  easy: 1,
  medium: 2,
  hard: 3
};

function pointsForLevel(level: QuestionLevel) {
  return LEVEL_POINTS[level];
}

function normalizeLevel(level: string | undefined): QuestionLevel {
  if (level === "easy" || level === "medium" || level === "hard") return level;
  return "medium";
}

function normalizeType(type: string | undefined): QuestionType {
  if (type === "mcq" || type === "text" || type === "code") return type;
  return "text";
}

function normalizeQuestion(input: any, index: number): Question {
  const type = normalizeType(input?.type);
  const level = normalizeLevel(input?.level);
  const base: BaseQuestion = {
    id: String(input?.id || `q${index + 1}`),
    type,
    q: String(input?.q || `Question ${index + 1}`),
    level,
    points: Number.isFinite(Number(input?.points)) ? Math.max(1, Math.round(Number(input.points))) : pointsForLevel(level)
  };

  if (type === "mcq") {
    const options = Array.isArray(input?.options)
      ? input.options.map((opt: any) => String(opt || "")).filter(Boolean).slice(0, 4)
      : [];

    while (options.length < 4) {
      options.push(`Option ${options.length + 1}`);
    }

    return {
      ...base,
      type: "mcq",
      options,
      correctIndex: Math.max(0, Math.min(3, Number(input?.correctIndex) || 0))
    };
  }

  if (type === "code") {
    return {
      ...base,
      type: "code",
      starterCode: String(input?.starterCode || ""),
      expectedKeyPoints: Array.isArray(input?.expectedKeyPoints)
        ? input.expectedKeyPoints.map((x: any) => String(x || "")).filter(Boolean)
        : []
    };
  }

  return {
    ...base,
    type: "text",
    keywords: Array.isArray(input?.keywords)
      ? input.keywords.map((x: any) => String(x || "")).filter(Boolean)
      : []
  };
}

function normalizeQuiz(input: any): Quiz {
  const rawQuestions = Array.isArray(input?.questions) ? input.questions : [];
  const questions = rawQuestions.map((q: any, i: number) => normalizeQuestion(q, i));

  return {
    title: String(input?.title || "Practice Quiz"),
    description: String(input?.description || "AI-ready coding quiz"),
    questions
  };
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function sanitizeQuizId(raw: string) {
  return String(raw || "quiz").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80) || "quiz";
}

function escapeHtml(raw: string) {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildStarterQuiz(contextCode = ""): Quiz {
  const starterCode = String(contextCode || "").trim();
  const snippet = starterCode ? starterCode.slice(0, 420) : "function sum(a, b) {\n  return a + b;\n}";
  return {
    title: "Quick Start Quiz",
    description: "This starter quiz is preloaded so grading and reports work immediately.",
    questions: [
      {
        id: "q1",
        type: "mcq",
        q: "What is the output type of `sum(2, 3)` in JavaScript?",
        level: "easy",
        points: 1,
        options: ["string", "number", "boolean", "object"],
        correctIndex: 1
      },
      {
        id: "q2",
        type: "text",
        q: "Explain the difference between null and undefined in JavaScript.",
        level: "medium",
        points: 2,
        keywords: ["null", "undefined", "assigned", "intentional"]
      },
      {
        id: "q3",
        type: "code",
        q: "Improve this function to safely handle non-number inputs.",
        level: "hard",
        points: 3,
        starterCode: snippet,
        expectedKeyPoints: ["Number", "typeof", "NaN", "return"]
      }
    ]
  };
}

export default function QuizManager({
  apiBaseUrl = "http://localhost:8080",
  preferredLanguage = "English",
  contextCode = "",
  authToken = null,
  onAttemptRecorded,
  onProctorLockChange
}: QuizManagerProps) {
  const takeSectionRef = useRef<HTMLElement | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(() => buildStarterQuiz(contextCode));
  const [mode, setMode] = useState<"editor" | "take" | "results">("take");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [score, setScore] = useState<number | null>(null);
  const [scoreBreakdown, setScoreBreakdown] = useState<{ score: number; total: number; scorePercent: number } | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<Record<string, CorrectAnswerFeedback>>({});
  const [attemptHistory, setAttemptHistory] = useState<QuizAttempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busyGenerating, setBusyGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [grading, setGrading] = useState(false);

  const [proctorEnabled, setProctorEnabled] = useState(false);
  const [proctorActive, setProctorActive] = useState(false);
  const [proctorWarnings, setProctorWarnings] = useState(0);
  const [proctorEvents, setProctorEvents] = useState<ProctorEvent[]>([]);
  const [takeStartedAt, setTakeStartedAt] = useState<number | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  const [generator, setGenerator] = useState<GeneratorState>({
    topic: "JavaScript fundamentals",
    questionType: "mixed",
    difficulty: "mixed",
    count: 5,
    contextCode
  });

  useEffect(() => {
    if (contextCode && contextCode !== generator.contextCode) {
      setGenerator((prev) => ({ ...prev, contextCode }));
    }
  }, [contextCode]);

  useEffect(() => {
    if (!quiz || !authToken) return;
    loadQuizHistory(sanitizeQuizId(quiz.title));
  }, [quiz?.title, authToken]);

  useEffect(() => {
    onProctorLockChange?.(proctorActive);
    return () => onProctorLockChange?.(false);
  }, [proctorActive, onProctorLockChange]);

  useEffect(() => {
    return () => {
      onProctorLockChange?.(false);
      try {
        if (document.fullscreenElement && (document as any).exitFullscreen) {
          void (document as any).exitFullscreen();
        }
      } catch {}
    };
  }, [onProctorLockChange]);

  useEffect(() => {
    if (!proctorActive) return;
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "A proctored attempt is in progress.";
      return ev.returnValue;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [proctorActive]);

  useEffect(() => {
    if (mode !== "take" && proctorActive) {
      void stopProctoredAttempt();
    }
  }, [mode, proctorActive]);

  useEffect(() => {
    if (mode !== "take") return;
    if (proctorEnabled && !proctorActive) {
      setTimeElapsed(0);
      setTakeStartedAt(null);
      return;
    }

    if (!takeStartedAt) {
      setTakeStartedAt(Date.now());
      setTimeElapsed(0);
      setProctorEvents([]);
      setProctorWarnings(0);
    }

    const timer = window.setInterval(() => {
      setTimeElapsed((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [mode, takeStartedAt, proctorEnabled, proctorActive]);

  useEffect(() => {
    if (mode !== "take" || !proctorActive) return;

    const pushEvent = (type: string, detail: string) => {
      setProctorEvents((prev) => [...prev, { type, detail, at: new Date().toISOString() }].slice(-50));
      setProctorWarnings((prev) => prev + 1);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        pushEvent("tab_hidden", "User switched tabs or minimized window");
      }
    };

    const onBlur = () => pushEvent("window_blur", "Window lost focus");
    const onCopy = (ev: Event) => {
      ev.preventDefault();
      pushEvent("copy_attempt", "Copy was attempted during proctored quiz");
    };
    const onPaste = (ev: Event) => {
      ev.preventDefault();
      pushEvent("paste_attempt", "Paste was attempted during proctored quiz");
    };
    const onContextMenu = (ev: Event) => {
      ev.preventDefault();
      pushEvent("context_menu", "Right click blocked in proctored mode");
    };

    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);

    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [mode, proctorActive]);

  const totalQuestions = useMemo(() => quiz?.questions.length ?? 0, [quiz]);

  function createBlankQuiz() {
    setQuiz({
      title: "Custom Quiz",
      description: "Instructor-authored quiz",
      questions: []
    });
    setAnswers({});
    setAnswerFeedback({});
    setScore(null);
    setScoreBreakdown(null);
    setAttemptHistory([]);
    setMode("editor");
    setTakeStartedAt(null);
    setTimeElapsed(0);
    setProctorEnabled(false);
    void stopProctoredAttempt();
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || "{}"));
        if (!parsed.title || !Array.isArray(parsed.questions)) {
          alert("Invalid quiz JSON. Expected { title, questions: [] }");
          return;
        }
        setQuiz(normalizeQuiz(parsed));
        setMode("take");
        setAnswers({});
        setAnswerFeedback({});
        setScore(null);
        setScoreBreakdown(null);
        setTakeStartedAt(null);
        setTimeElapsed(0);
        setProctorEnabled(false);
        void stopProctoredAttempt();
      } catch (err) {
        alert("Could not parse JSON: " + String(err));
      }
    };
    reader.readAsText(f);
    e.currentTarget.value = "";
  }

  function addQuestion(type: QuestionType) {
    if (!quiz) return;
    const id = `q${Date.now()}`;
    const level: QuestionLevel = "medium";

    const question: Question = type === "mcq"
      ? {
          id,
          type: "mcq",
          q: "New MCQ question",
          options: ["Option 1", "Option 2", "Option 3", "Option 4"],
          correctIndex: 0,
          level,
          points: pointsForLevel(level)
        }
      : type === "code"
        ? {
            id,
            type: "code",
            q: "Write code to solve the task.",
            level,
            points: pointsForLevel(level),
            starterCode: "",
            expectedKeyPoints: []
          }
        : {
            id,
            type: "text",
            q: "Describe your answer.",
            level,
            points: pointsForLevel(level),
            keywords: []
          };

    setQuiz({
      ...quiz,
      questions: [...quiz.questions, question]
    });
  }

  function updateQuestion(updated: Question) {
    if (!quiz) return;
    setQuiz({
      ...quiz,
      questions: quiz.questions.map((q) => (q.id === updated.id ? updated : q))
    });
  }

  function removeQuestion(id: string) {
    if (!quiz) return;
    setQuiz({ ...quiz, questions: quiz.questions.filter((q) => q.id !== id) });
  }

  function setAnswer(id: string, value: number | string | null, type: QuestionType) {
    setAnswers((prev) => ({
      ...prev,
      [id]: { id, type, value, correct: null, pointsAwarded: 0 }
    }));
  }

  function setQuestionLevel(question: Question, level: QuestionLevel) {
    updateQuestion({ ...question, level, points: pointsForLevel(level) } as Question);
  }

  async function startProctoredAttempt() {
    if (mode !== "take") return;
    setProctorWarnings(0);
    setProctorEvents([]);
    setTimeElapsed(0);
    setTakeStartedAt(Date.now());
    setProctorActive(true);

    try {
      const node = takeSectionRef.current as any;
      if (node?.requestFullscreen && !document.fullscreenElement) {
        await node.requestFullscreen();
      }
    } catch {
      // Fullscreen may be blocked by browser policy; continue with app-level lock.
    }
  }

  async function stopProctoredAttempt() {
    setProctorActive(false);
    try {
      if (document.fullscreenElement && (document as any).exitFullscreen) {
        await (document as any).exitFullscreen();
      }
    } catch {}
  }

  function resetForRetry() {
    setAnswers({});
    setAnswerFeedback({});
    setScore(null);
    setScoreBreakdown(null);
    setMode("take");
    setTakeStartedAt(null);
    setTimeElapsed(0);
    setProctorWarnings(0);
    setProctorEvents([]);
    void stopProctoredAttempt();
  }

  function exportQuizDefinition() {
    if (!quiz) return;
    const lines: string[] = [];
    lines.push(quiz.title || "Quiz");
    lines.push("=".repeat(Math.max(24, (quiz.title || "Quiz").length)));
    if (quiz.description) {
      lines.push(quiz.description);
      lines.push("");
    }
    lines.push("Instructions:");
    lines.push("- Attempt all questions.");
    lines.push("- Write concise and clear answers.");
    lines.push("");

    quiz.questions.forEach((q, idx) => {
      lines.push(`${idx + 1}. [${q.type.toUpperCase()} | ${q.level} | ${q.points} pts] ${q.q}`);
      if (q.type === "mcq") {
        q.options.forEach((opt, optIdx) => {
          const label = String.fromCharCode(65 + optIdx);
          lines.push(`   ${label}. ${opt}`);
        });
      } else if (q.type === "code" && q.starterCode) {
        lines.push("   Starter code:");
        lines.push("   ---");
        String(q.starterCode).split("\n").forEach((line) => lines.push(`   ${line}`));
        lines.push("   ---");
      }
      lines.push("");
    });

    lines.push("Answer Key (Instructor)");
    lines.push("-----------------------");
    quiz.questions.forEach((q, idx) => {
      if (q.type === "mcq") {
        const correctOpt = q.options[q.correctIndex] || "";
        lines.push(`${idx + 1}. ${String.fromCharCode(65 + q.correctIndex)}. ${correctOpt}`);
      } else if (q.type === "text") {
        lines.push(`${idx + 1}. Expected keywords: ${(q.keywords || []).join(", ") || "N/A"}`);
      } else {
        lines.push(`${idx + 1}. Expected key points: ${(q.expectedKeyPoints || []).join(", ") || "N/A"}`);
      }
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeQuizId(quiz.title)}-quiz-sheet.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildQuizDocHtml() {
    if (!quiz) return "";
    const header = `
      <h1>${escapeHtml(quiz.title || "Quiz")}</h1>
      <p>${escapeHtml(quiz.description || "")}</p>
      <hr />
      <h2>Questions</h2>
    `;
    const body = quiz.questions.map((q, idx) => {
      let details = "";
      if (q.type === "mcq") {
        details = `<ol type="A">${q.options.map((opt) => `<li>${escapeHtml(opt)}</li>`).join("")}</ol>`;
      } else if (q.type === "text") {
        details = `<p><em>Expected keywords:</em> ${escapeHtml((q.keywords || []).join(", ") || "N/A")}</p>`;
      } else {
        details = `
          <pre>${escapeHtml(q.starterCode || "")}</pre>
          <p><em>Expected key points:</em> ${escapeHtml((q.expectedKeyPoints || []).join(", ") || "N/A")}</p>
        `;
      }
      return `
        <section style="margin-bottom:16px;">
          <h3>${idx + 1}. ${escapeHtml(q.q)} <small>(${q.type.toUpperCase()} | ${q.level} | ${q.points} pts)</small></h3>
          ${details}
        </section>
      `;
    }).join("");

    const answerKey = `
      <hr />
      <h2>Answer Key (Instructor)</h2>
      <ol>
        ${quiz.questions.map((q) => {
          if (q.type === "mcq") {
            const letter = String.fromCharCode(65 + q.correctIndex);
            return `<li>${letter}. ${escapeHtml(q.options[q.correctIndex] || "")}</li>`;
          }
          if (q.type === "text") {
            return `<li>${escapeHtml((q.keywords || []).join(", ") || "N/A")}</li>`;
          }
          return `<li>${escapeHtml((q.expectedKeyPoints || []).join(", ") || "N/A")}</li>`;
        }).join("")}
      </ol>
    `;

    return `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(quiz.title || "Quiz")}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
          h1, h2, h3 { margin: 0 0 8px; }
          p { margin: 0 0 10px; line-height: 1.5; }
          pre { background: #f5f5f5; border: 1px solid #ddd; padding: 10px; border-radius: 6px; white-space: pre-wrap; }
          small { color: #555; font-weight: normal; }
        </style>
      </head>
      <body>
        ${header}
        ${body}
        ${answerKey}
      </body>
      </html>
    `;
  }

  function exportQuizDoc() {
    if (!quiz) return;
    const html = buildQuizDocHtml();
    const blob = new Blob([`\ufeff${html}`], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeQuizId(quiz.title)}-quiz-sheet.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildAnswerPayload() {
    const out: Record<string, number | string | null> = {};
    Object.entries(answers).forEach(([id, value]) => {
      out[id] = value?.value ?? null;
    });
    return out;
  }

  async function gradeDescriptiveWithAI(question: string, reference: string, answer: string) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, reference, answer })
      });
      if (!res.ok) return null;
      const payload = await res.json();
      const score = typeof payload?.score === "number" ? Math.max(0, Math.min(100, payload.score)) : null;
      return {
        score,
        feedback: String(payload?.feedback || payload?.corrected_answer || "").trim(),
        corrected: String(payload?.corrected_answer || reference || "").trim()
      };
    } catch {
      return null;
    }
  }

  async function loadQuizHistory(currentQuizId?: string) {
    if (!authToken) {
      setAttemptHistory([]);
      return;
    }

    setHistoryLoading(true);
    try {
      const queryQuizId = currentQuizId || sanitizeQuizId(quiz?.title || "quiz");
      const res = await fetch(`${apiBaseUrl}/api/quiz/history?quizId=${encodeURIComponent(queryQuizId)}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) {
        throw new Error(`history request failed (${res.status})`);
      }
      const payload = await res.json();
      setAttemptHistory(Array.isArray(payload.attempts) ? payload.attempts : []);
    } catch {
      setAttemptHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function recordAttempt(scoreValue: number, weakAreas: string[], wasProctored = false) {
    if (!authToken || !quiz) return;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`
    };

    await fetch(`${apiBaseUrl}/api/analytics/attempt`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        quizTitle: quiz.title,
        score: scoreValue,
        totalQuestions: quiz.questions.length,
        durationSec: timeElapsed,
        weakAreas,
        proctorSummary: {
          enabled: wasProctored,
          warnings: proctorWarnings,
          events: proctorEvents
        }
      })
    });

    if (wasProctored && proctorEvents.length > 0) {
      const important = proctorEvents.slice(-10);
      for (const ev of important) {
        await fetch(`${apiBaseUrl}/api/proctor/event`, {
          method: "POST",
          headers,
          body: JSON.stringify({ type: ev.type, detail: ev.detail })
        });
      }
    }

    if (onAttemptRecorded) onAttemptRecorded();
  }

  async function grade() {
    if (!quiz) return;
    const proctoredAttempt = proctorEnabled && proctorActive;
    if (proctorEnabled && !proctorActive) {
      alert("Click 'Start Proctored Attempt' before submitting.");
      return;
    }
    setGrading(true);

    const quizId = sanitizeQuizId(quiz.title);
    let total = 0;
    let earned = 0;
    const nextAnswers = { ...answers };
    const weakAreas = new Set<string>();
    const localFeedback: Record<string, CorrectAnswerFeedback> = {};
    const descriptiveQuestions: Array<TextQ | CodeQ> = [];

    for (const q of quiz.questions) {
      const pts = Number(q.points || pointsForLevel(q.level));
      total += pts;
      const a = answers[q.id];

      if (q.type === "mcq") {
        const selected = typeof a?.value === "number" ? a.value : null;
        const correct = selected === q.correctIndex;
        nextAnswers[q.id] = {
          id: q.id,
          type: q.type,
          value: selected,
          correct,
          pointsAwarded: correct ? pts : 0
        };
        localFeedback[q.id] = {
          questionId: q.id,
          correct: q.options[q.correctIndex] || "N/A",
          explanation: "Review the correct option and concept.",
          userAnswer: selected == null ? null : q.options[selected] || null,
          isCorrect: Boolean(correct)
        };
        if (correct) earned += pts;
        else weakAreas.add(`mcq-${q.level}`);
        continue;
      }

      descriptiveQuestions.push(q);
      if (q.type === "text") {
        const answerText = String(a?.value || "").toLowerCase();
        const keywords = q.keywords || [];
        const matched = keywords.reduce((acc, kw) => acc + (answerText.includes(kw.toLowerCase()) ? 1 : 0), 0);
        const fraction = keywords.length ? Math.min(1, matched / Math.max(1, keywords.length)) : 0;
        const awarded = Math.round(fraction * pts);
        nextAnswers[q.id] = {
          id: q.id,
          type: q.type,
          value: a?.value ?? "",
          correct: awarded === pts,
          pointsAwarded: awarded
        };
        localFeedback[q.id] = {
          questionId: q.id,
          correct: keywords.join(", "),
          explanation: "Checking with AI for a better correction...",
          userAnswer: String(a?.value ?? ""),
          isCorrect: awarded === pts
        };
        earned += awarded;
        if (awarded < pts) weakAreas.add(`text-${q.level}`);
        continue;
      }

      const codeAnswer = String(a?.value || "").toLowerCase();
      const expected = (q.expectedKeyPoints || []).map((x) => x.toLowerCase());
      const matched = expected.reduce((acc, keyPoint) => acc + (codeAnswer.includes(keyPoint) ? 1 : 0), 0);
      const fraction = expected.length ? Math.min(1, matched / Math.max(1, expected.length)) : 0;
      const awarded = Math.round(fraction * pts);
      nextAnswers[q.id] = {
        id: q.id,
        type: q.type,
        value: a?.value ?? "",
        correct: awarded === pts,
        pointsAwarded: awarded
      };
      localFeedback[q.id] = {
        questionId: q.id,
        correct: (q.expectedKeyPoints || []).join(", "),
        explanation: "Checking with AI for a better correction...",
        userAnswer: String(a?.value ?? ""),
        isCorrect: awarded === pts
      };
      earned += awarded;
      if (awarded < pts) weakAreas.add(`code-${q.level}`);
    }

    const scoreValue = total > 0 ? Math.round((earned / total) * 100) : 0;
    setAnswers(nextAnswers);
    setAnswerFeedback(localFeedback);
    setScoreBreakdown({ score: earned, total, scorePercent: scoreValue });
    setScore(scoreValue);
    setMode("results");
    await stopProctoredAttempt();
    setGrading(false);

    const enrichDescriptiveFeedback = async () => {
      const updates = await Promise.all(
        descriptiveQuestions.map(async (q) => {
          const answerText = String(nextAnswers[q.id]?.value ?? "");
          const reference = q.type === "text"
            ? (q.keywords || []).join(", ")
            : (q.expectedKeyPoints || []).join(", ");
          const ai = await gradeDescriptiveWithAI(q.q, reference, answerText);
          return { q, ai };
        })
      );

      setAnswerFeedback((prev) => {
        const next = { ...prev };
        updates.forEach(({ q, ai }) => {
          if (!ai) return;
          const current = next[q.id] || {
            questionId: q.id,
            correct: "",
            explanation: "",
            userAnswer: String(nextAnswers[q.id]?.value ?? ""),
            isCorrect: false
          };
          next[q.id] = {
            ...current,
            correct: ai.corrected || current.correct,
            explanation: ai.feedback || current.explanation
          };
        });
        return next;
      });
    };

    let serverApplied = false;
    if (authToken) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/quiz/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            quizId,
            quizTitle: quiz.title,
            questions: quiz.questions,
            answers: buildAnswerPayload(),
            durationSec: timeElapsed,
            proctorSummary: {
              enabled: proctoredAttempt,
              warnings: proctorWarnings,
              events: proctorEvents
            }
          })
        });

        if (res.ok) {
          const payload = await res.json();
          const feedbackArr = Array.isArray(payload.correctAnswers) ? payload.correctAnswers : [];
          const feedbackMap: Record<string, CorrectAnswerFeedback> = {};
          feedbackArr.forEach((item: CorrectAnswerFeedback) => {
            feedbackMap[item.questionId] = item;
          });
          const mergedAnswers = { ...nextAnswers };
          quiz.questions.forEach((q) => {
            const fb = feedbackMap[q.id];
            if (!fb) return;
            mergedAnswers[q.id] = {
              ...(mergedAnswers[q.id] || { id: q.id, type: q.type, value: null }),
              correct: fb.isCorrect,
              pointsAwarded: fb.isCorrect ? Number(q.points || 0) : 0
            };
          });
          setAnswers(mergedAnswers);
          setAnswerFeedback(feedbackMap);
          setScoreBreakdown({
            score: Number(payload.score || 0),
            total: Number(payload.total || 0),
            scorePercent: Number(payload.scorePercent || 0)
          });
          setScore(Number(payload.scorePercent || 0));
          await loadQuizHistory(quizId);
          if (onAttemptRecorded) onAttemptRecorded();
          serverApplied = true;
        }
      } catch (err) {
        console.warn("Server quiz submit failed. Using local grading.", err);
      }
    }

    if (!serverApplied) {
      if (authToken) {
        await recordAttempt(scoreValue, Array.from(weakAreas), proctoredAttempt);
      }
      void enrichDescriptiveFeedback();
    }
  }

  async function generateQuizWithAI() {
    setBusyGenerating(true);
    setGenerateError("");

    try {
      const res = await fetch(`${apiBaseUrl}/api/quiz/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: generator.topic,
          questionType: generator.questionType,
          difficulty: generator.difficulty,
          count: generator.count,
          contextCode: generator.contextCode,
          outputLanguage: preferredLanguage
        })
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message || payload.error || `Server returned ${res.status}`);
      }

      const generatedQuiz = normalizeQuiz(payload.quiz);
      setQuiz(generatedQuiz);
      setMode("take");
      setAnswers({});
      setAnswerFeedback({});
      setScore(null);
      setScoreBreakdown(null);
      setTakeStartedAt(null);
      setTimeElapsed(0);
      setProctorEnabled(false);
      await stopProctoredAttempt();
      await loadQuizHistory(sanitizeQuizId(generatedQuiz.title));
    } catch (err: any) {
      setGenerateError(err?.message || "Failed to generate quiz");
    } finally {
      setBusyGenerating(false);
    }
  }

  function exportResults() {
    const out = {
      quizTitle: quiz?.title,
      answers,
      score,
      proctor: {
        enabled: proctorEnabled,
        warnings: proctorWarnings,
        events: proctorEvents
      }
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(quiz?.title || "quiz").replace(/\s+/g, "_")}_results.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const actionLocked = mode === "take" && proctorActive;
  const proctorPendingStart = mode === "take" && proctorEnabled && !proctorActive;

  return (
    <div className="quiz-manager">
      <div className="quiz-header">
        <div>
          <h3>Quiz Maker Studio</h3>
          <p>{`Questions: ${totalQuestions} | Language: ${preferredLanguage}`}</p>
        </div>
        <div className="quiz-toolbar">
          <button
            onClick={() => {
              if (!quiz) return;
              resetForRetry();
            }}
            className="qm-btn"
            disabled={!quiz || actionLocked}
          >
            Take Quiz
          </button>
          <button
            onClick={() => {
              if (actionLocked) return;
              if (!quiz) {
                createBlankQuiz();
                return;
              }
              setMode("editor");
            }}
            className="qm-btn"
            title="Manual question builder for instructors and custom quiz authors"
            disabled={actionLocked}
          >
            Instructor Editor
          </button>
          <button onClick={resetForRetry} className="qm-btn" disabled={!quiz || actionLocked}>Retry Quiz</button>
          <button onClick={exportResults} style={{ marginLeft: 8 }} className="qm-btn ghost" disabled={!quiz || actionLocked}>Export Results</button>
          <button onClick={exportQuizDefinition} className="qm-btn ghost" disabled={!quiz || actionLocked}>Download Quiz Sheet</button>
          <button onClick={exportQuizDoc} className="qm-btn ghost" disabled={!quiz || actionLocked}>Download DOC</button>
        </div>
      </div>
      <p className="quiz-capability-note">Instructor Editor is for personal/custom quizzes. Proctored mode is available in Take Quiz.</p>

      <section className="generator-card">
        <h4>AI Quiz Generator</h4>
        <p>Pick topic, type, and difficulty, then generate. You can also upload your own quiz JSON and edit it.</p>

        <div className="generator-grid">
          <label>
            Topic
            <input
              value={generator.topic}
              onChange={(e) => setGenerator((prev) => ({ ...prev, topic: e.target.value }))}
              placeholder="e.g. arrays, recursion, React hooks"
            />
          </label>

          <label>
            Type
            <select
              value={generator.questionType}
              onChange={(e) => setGenerator((prev) => ({ ...prev, questionType: e.target.value as GenerateType }))}
            >
              <option value="mixed">Mixed</option>
              <option value="mcq">MCQ</option>
              <option value="text">Text</option>
              <option value="code">Code</option>
            </select>
          </label>

          <label>
            Difficulty
            <select
              value={generator.difficulty}
              onChange={(e) => setGenerator((prev) => ({ ...prev, difficulty: e.target.value as GenerateDifficulty }))}
            >
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>

          <label>
            Count
            <input
              type="number"
              min={1}
              max={15}
              value={generator.count}
              onChange={(e) => setGenerator((prev) => ({ ...prev, count: Math.max(1, Math.min(15, Number(e.target.value) || 1)) }))}
            />
          </label>
        </div>

        <div className="generator-upload-row">
          <label>
            Upload quiz JSON
            <input type="file" accept=".json,application/json" onChange={handleFileUpload} />
          </label>
        </div>

        <label className="generator-code-label">
          Code context (optional)
          <textarea
            rows={4}
            value={generator.contextCode}
            onChange={(e) => setGenerator((prev) => ({ ...prev, contextCode: e.target.value }))}
            placeholder="Auto-filled from the Explain editor. Paste or edit code for code-specific questions."
          />
        </label>

        <div className="generator-actions">
          <button onClick={generateQuizWithAI} disabled={busyGenerating} className="qm-btn generate">
            {busyGenerating ? "Generating..." : "Generate Quiz with AI"}
          </button>
          {generateError && <span className="generator-error">{generateError}</span>}
        </div>
      </section>

      {!quiz && (
        <section className="quiz-card">
          <h4>No quiz loaded</h4>
          <p>Generate with AI, upload JSON, or open Instructor Editor and add questions manually.</p>
        </section>
      )}

      {mode === "editor" && quiz && (
        <section className="quiz-card">
          <div className="quiz-meta">
            <input
              value={quiz.title}
              onChange={(e) => setQuiz({ ...quiz, title: e.target.value })}
              className="title-input"
            />
            <textarea
              value={quiz.description}
              onChange={(e) => setQuiz({ ...quiz, description: e.target.value })}
              className="desc-input"
            />
          </div>

          <div className="question-actions">
            <button onClick={() => addQuestion("mcq")} className="qm-btn small">Add MCQ</button>
            <button onClick={() => addQuestion("text")} className="qm-btn small">Add Text</button>
            <button onClick={() => addQuestion("code")} className="qm-btn small">Add Code</button>
            <button onClick={exportQuizDefinition} className="qm-btn small ghost">Download Quiz Sheet</button>
            <button onClick={exportQuizDoc} className="qm-btn small ghost">Download DOC</button>
          </div>

          <div className="question-list">
            {quiz.questions.map((q, i) => (
              <article key={q.id} className="question-item">
                <div className="question-top">
                  <strong>{`${i + 1}. ${q.type.toUpperCase()}`}</strong>
                  <div className="question-controls">
                    <select
                      value={q.level}
                      onChange={(e) => setQuestionLevel(q, e.target.value as QuestionLevel)}
                    >
                      <option value="easy">easy</option>
                      <option value="medium">medium</option>
                      <option value="hard">hard</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={q.points}
                      onChange={(e) => updateQuestion({ ...q, points: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } as Question)}
                      className="points-input"
                    />
                    <button onClick={() => removeQuestion(q.id)} className="qm-btn ghost small">Remove</button>
                  </div>
                </div>

                <input
                  value={q.q}
                  onChange={(e) => updateQuestion({ ...q, q: e.target.value } as Question)}
                  className="question-input"
                />

                {q.type === "mcq" && (
                  <div className="mcq-grid">
                    {q.options.map((opt, idx) => (
                      <div key={idx} className="mcq-row">
                        <input
                          value={opt}
                          onChange={(e) => {
                            const options = [...q.options];
                            options[idx] = e.target.value;
                            updateQuestion({ ...q, options } as MCQ);
                          }}
                        />
                        <label>
                          <input
                            type="radio"
                            checked={q.correctIndex === idx}
                            onChange={() => updateQuestion({ ...q, correctIndex: idx } as MCQ)}
                          />
                          Correct
                        </label>
                      </div>
                    ))}
                  </div>
                )}

                {q.type === "text" && (
                  <input
                    placeholder="keywords (comma separated)"
                    value={q.keywords?.join(",") || ""}
                    onChange={(e) => {
                      const keywords = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                      updateQuestion({ ...q, keywords } as TextQ);
                    }}
                  />
                )}

                {q.type === "code" && (
                  <div className="code-edit-stack">
                    <textarea
                      rows={4}
                      placeholder="starter code"
                      value={q.starterCode || ""}
                      onChange={(e) => updateQuestion({ ...q, starterCode: e.target.value } as CodeQ)}
                    />
                    <input
                      placeholder="expected key points (comma separated)"
                      value={q.expectedKeyPoints?.join(",") || ""}
                      onChange={(e) => {
                        const expectedKeyPoints = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                        updateQuestion({ ...q, expectedKeyPoints } as CodeQ);
                      }}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {mode === "take" && quiz && (
        <section className="quiz-card" ref={takeSectionRef as any}>
          <h4>{quiz.title}</h4>
          <p>{quiz.description}</p>
          {quiz.questions.length === 0 && (
            <p>No questions in this quiz yet. Open Instructor Editor to add questions.</p>
          )}

          <div className="proctor-bar">
            <label>
              <input
                type="checkbox"
                checked={proctorEnabled}
                disabled={proctorActive}
                onChange={(e) => setProctorEnabled(e.target.checked)}
              />
              Enable proctored mode
            </label>
            {proctorEnabled && !proctorActive && (
              <button className="qm-btn small" onClick={startProctoredAttempt}>Start Proctored Attempt</button>
            )}
            {proctorActive && <strong>Proctored attempt active (locked)</strong>}
            <span>{`Time: ${formatDuration(timeElapsed)}`}</span>
            <span>{`Warnings: ${proctorWarnings}`}</span>
          </div>
          {proctorPendingStart && (
            <p className="generator-error">Click "Start Proctored Attempt" to begin. Quiz inputs stay locked until started.</p>
          )}

          <div className="question-list">
            {quiz.questions.map((q) => (
              <article key={q.id} className="question-item">
                <div className="question-meta">
                  <span className={`level-badge ${q.level}`}>{q.level}</span>
                  <span>{`${q.points} pts`}</span>
                </div>
                <strong>{q.q}</strong>

                {q.type === "mcq" && (
                  <div className="answers-stack">
                    {q.options.map((opt, idx) => (
                      <label key={idx} className="answer-row">
                        <input
                          type="radio"
                          name={q.id}
                          checked={(answers[q.id]?.value as number | null) === idx}
                          disabled={proctorPendingStart}
                          onChange={() => setAnswer(q.id, idx, "mcq")}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}

                {q.type === "text" && (
                  <textarea
                    rows={4}
                    value={(answers[q.id]?.value as string) || ""}
                    disabled={proctorPendingStart}
                    onChange={(e) => setAnswer(q.id, e.target.value, "text")}
                  />
                )}

                {q.type === "code" && (
                  <div className="code-answer-wrap">
                    {q.starterCode && <pre>{q.starterCode}</pre>}
                    <textarea
                      rows={7}
                      className="code-answer"
                      value={(answers[q.id]?.value as string) || ""}
                      disabled={proctorPendingStart}
                      onChange={(e) => setAnswer(q.id, e.target.value, "code")}
                      placeholder="Write your code answer here"
                    />
                  </div>
                )}
              </article>
            ))}
          </div>

          <button onClick={grade} className="qm-btn generate" disabled={grading || proctorPendingStart}>
            {grading ? "Grading..." : "Submit and Grade"}
          </button>
        </section>
      )}

      {mode === "results" && quiz && (
        <section className="quiz-card">
          <h4>{`Results: ${quiz.title}`}</h4>
          <p className="score-pill">{`Score: ${score ?? 0}%`}</p>
          {scoreBreakdown && (
            <p>{`Points: ${scoreBreakdown.score}/${scoreBreakdown.total}`}</p>
          )}
          <div className="question-actions">
            <button onClick={resetForRetry} className="qm-btn small">Retry Quiz</button>
          </div>

          <div className="proctor-result">
            <strong>Proctor Summary</strong>
            <span>{proctorEnabled ? "Enabled" : "Disabled"}</span>
            <span>{`Warnings: ${proctorWarnings}`}</span>
          </div>

          <div className="question-list">
            {quiz.questions.map((q) => {
              const a = answers[q.id];
              const answerDisplay = q.type === "mcq"
                ? (q.options[(a?.value as number) ?? -1] ?? "(no answer)")
                : (a?.value ?? "(no answer)");

              return (
                <article key={q.id} className="question-item">
                  <div className="question-meta">
                    <span className={`level-badge ${q.level}`}>{q.level}</span>
                    <span>{`${q.points} pts`}</span>
                  </div>
                  <strong>{q.q}</strong>
                  <div>{`Your answer: ${answerDisplay}`}</div>
                  {answerFeedback[q.id] && (
                    <>
                      <div>{`Correct answer: ${answerFeedback[q.id].correct}`}</div>
                      <div>{`Explanation: ${answerFeedback[q.id].explanation}`}</div>
                    </>
                  )}
                  <div className={`result-line ${a?.correct === true ? "ok" : a?.correct === false ? "bad" : "pending"}`}>
                    {q.type === "mcq"
                      ? (a?.correct ? `Correct (${a?.pointsAwarded} pts)` : "Incorrect (0 pts)")
                      : (a?.pointsAwarded && a.pointsAwarded > 0 ? `Auto-graded ${a.pointsAwarded} pts` : "Needs manual/AI grading")}
                  </div>
                </article>
              );
            })}
          </div>

          <section className="quiz-card">
            <h4>Previous Attempts</h4>
            {historyLoading && <p>Loading attempt history...</p>}
            {!historyLoading && attemptHistory.length === 0 && <p>No previous attempts for this quiz yet.</p>}
            {!historyLoading && attemptHistory.length > 0 && (
              <div className="plan-list">
                {attemptHistory.map((attempt, idx) => {
                  const prev = attemptHistory[idx + 1];
                  const delta = prev ? attempt.scorePercent - prev.scorePercent : 0;
                  return (
                    <article key={`${attempt.quizId}-${attempt.attemptNumber}`}>
                      <strong>{`Attempt #${attempt.attemptNumber} - ${attempt.scorePercent}%`}</strong>
                      <p>{new Date(attempt.timestamp).toLocaleString()}</p>
                      {idx < attemptHistory.length - 1 && <p>{`Improvement: ${delta >= 0 ? "+" : ""}${delta}%`}</p>}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      )}
    </div>
  );
}

