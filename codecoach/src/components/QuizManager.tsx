import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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

type QuizManagerProps = {
  apiBaseUrl?: string;
  preferredLanguage?: string;
  contextCode?: string;
  authToken?: string | null;
  onAttemptRecorded?: () => void;
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
    questions: questions.length ? questions : [
      {
        id: "q1",
        type: "mcq",
        q: "What does function sum(a, b) return?",
        options: ["a - b", "a + b", "a * b", "b - a"],
        correctIndex: 1,
        level: "easy",
        points: 1
      }
    ]
  };
}

function createSampleQuiz(): Quiz {
  return normalizeQuiz({
    title: "Sample: sum function quiz",
    description: "Small quiz to test the sum example",
    questions: [
      {
        id: "q1",
        type: "mcq",
        q: "What does sum(a, b) return?",
        options: ["a - b", "a + b", "a * b", "b - a"],
        correctIndex: 1,
        points: 1,
        level: "easy"
      },
      {
        id: "q2",
        type: "text",
        q: "Explain in one sentence what sum(a, b) does.",
        points: 2,
        level: "medium",
        keywords: ["add", "sum", "two", "numbers"]
      },
      {
        id: "q3",
        type: "code",
        q: "Write a function multiply(a, b) that returns a * b.",
        points: 3,
        level: "hard",
        starterCode: "function multiply(a, b) {\n  // your code\n}",
        expectedKeyPoints: ["function declaration", "return a * b"]
      }
    ]
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function QuizManager({
  apiBaseUrl = "http://localhost:4000",
  preferredLanguage = "English",
  contextCode = "",
  authToken = null,
  onAttemptRecorded
}: QuizManagerProps) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [mode, setMode] = useState<"editor" | "take" | "results">("editor");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [score, setScore] = useState<number | null>(null);
  const [busyGenerating, setBusyGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [grading, setGrading] = useState(false);

  const [proctorEnabled, setProctorEnabled] = useState(false);
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
    if (!quiz) {
      setQuiz(createSampleQuiz());
    }
  }, []);

  useEffect(() => {
    if (contextCode && contextCode !== generator.contextCode) {
      setGenerator((prev) => ({ ...prev, contextCode }));
    }
  }, [contextCode]);

  useEffect(() => {
    if (mode !== "take") return;

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
  }, [mode, takeStartedAt]);

  useEffect(() => {
    if (mode !== "take" || !proctorEnabled) return;

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
  }, [mode, proctorEnabled]);

  const totalQuestions = useMemo(() => quiz?.questions.length ?? 0, [quiz]);

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
        setMode("editor");
        setAnswers({});
        setScore(null);
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

  async function recordAttempt(scoreValue: number, weakAreas: string[]) {
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
          enabled: proctorEnabled,
          warnings: proctorWarnings,
          events: proctorEvents
        }
      })
    });

    if (proctorEnabled && proctorEvents.length > 0) {
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
    setGrading(true);

    try {
      let total = 0;
      let earned = 0;
      const nextAnswers = { ...answers };
      const weakAreas = new Set<string>();

      quiz.questions.forEach((q) => {
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
          if (correct) earned += pts;
          else weakAreas.add(`mcq-${q.level}`);
          return;
        }

        if (q.type === "text") {
          const answerText = String(a?.value || "").toLowerCase();
          const keywords = q.keywords || [];
          if (!keywords.length) {
            nextAnswers[q.id] = {
              id: q.id,
              type: q.type,
              value: a?.value ?? "",
              correct: null,
              pointsAwarded: 0
            };
            weakAreas.add(`text-${q.level}`);
          } else {
            const matched = keywords.reduce((acc, kw) => acc + (answerText.includes(kw.toLowerCase()) ? 1 : 0), 0);
            const fraction = Math.min(1, matched / Math.max(1, keywords.length));
            const awarded = Math.round(fraction * pts);
            nextAnswers[q.id] = {
              id: q.id,
              type: q.type,
              value: a?.value ?? "",
              correct: awarded === pts,
              pointsAwarded: awarded
            };
            earned += awarded;
            if (awarded < pts) weakAreas.add(`text-${q.level}`);
          }
          return;
        }

        const codeAnswer = String(a?.value || "").toLowerCase();
        const expected = (q.expectedKeyPoints || []).map((x) => x.toLowerCase());
        if (!expected.length) {
          nextAnswers[q.id] = {
            id: q.id,
            type: q.type,
            value: a?.value ?? "",
            correct: null,
            pointsAwarded: 0
          };
          weakAreas.add(`code-${q.level}`);
        } else {
          const matched = expected.reduce((acc, keyPoint) => acc + (codeAnswer.includes(keyPoint) ? 1 : 0), 0);
          const fraction = Math.min(1, matched / Math.max(1, expected.length));
          const awarded = Math.round(fraction * pts);
          nextAnswers[q.id] = {
            id: q.id,
            type: q.type,
            value: a?.value ?? "",
            correct: awarded === pts,
            pointsAwarded: awarded
          };
          earned += awarded;
          if (awarded < pts) weakAreas.add(`code-${q.level}`);
        }
      });

      const scoreValue = total > 0 ? Math.round((earned / total) * 100) : 0;
      setAnswers(nextAnswers);
      setScore(scoreValue);
      setMode("results");

      await recordAttempt(scoreValue, Array.from(weakAreas));
    } finally {
      setGrading(false);
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
      setMode("editor");
      setAnswers({});
      setScore(null);
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
              setAnswers({});
              setScore(null);
              setMode("take");
              setTakeStartedAt(null);
            }}
            className="qm-btn"
          >
            Take Quiz
          </button>
          <button onClick={() => setMode("editor")} className="qm-btn" title="Manual question builder for instructors and custom quiz authors">
            Instructor Editor
          </button>
          <button onClick={grade} className="qm-btn" disabled={grading}>{grading ? "Grading..." : "Grade"}</button>
          <button onClick={exportResults} style={{ marginLeft: 8 }} className="qm-btn ghost">Export</button>
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
        <section className="quiz-card">
          <h4>{quiz.title}</h4>
          <p>{quiz.description}</p>

          <div className="proctor-bar">
            <label>
              <input
                type="checkbox"
                checked={proctorEnabled}
                onChange={(e) => setProctorEnabled(e.target.checked)}
              />
              Proctored attempt mode
            </label>
            <span>{`Time: ${formatDuration(timeElapsed)}`}</span>
            <span>{`Warnings: ${proctorWarnings}`}</span>
          </div>

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
                      onChange={(e) => setAnswer(q.id, e.target.value, "code")}
                      placeholder="Write your code answer here"
                    />
                  </div>
                )}
              </article>
            ))}
          </div>

          <button onClick={grade} className="qm-btn generate" disabled={grading}>{grading ? "Grading..." : "Submit and Grade"}</button>
        </section>
      )}

      {mode === "results" && quiz && (
        <section className="quiz-card">
          <h4>{`Results: ${quiz.title}`}</h4>
          <p className="score-pill">{`Score: ${score ?? 0}%`}</p>

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
                  <div className={`result-line ${a?.correct === true ? "ok" : a?.correct === false ? "bad" : "pending"}`}>
                    {q.type === "mcq"
                      ? (a?.correct ? `Correct (${a?.pointsAwarded} pts)` : "Incorrect (0 pts)")
                      : (a?.pointsAwarded && a.pointsAwarded > 0 ? `Auto-graded ${a.pointsAwarded} pts` : "Needs manual/AI grading")}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
