# requirements.md - CodeCoach Studio

## 1. Project Overview
**Project Name:** CodeCoach Studio  
**Category:** AI-assisted coding education platform  
**Primary Objective:** Help learners understand code in their preferred language, revise quickly, and practice with quizzes in one place.

## 2. Problem Statement
Many students struggle with programming because:
- Explanations are too technical or English-only.
- Practice is not adapted by type or difficulty.
- Learning flow is fragmented across separate tools.

CodeCoach Studio combines explanation, follow-up mentoring, revision, quiz creation, and quiz attempts in a single workflow.

## 3. Target Users
- School/college students learning programming fundamentals.
- Early-career learners preparing for coding interviews.
- Instructors creating personal/custom quizzes for learners.

## 4. Product Goals and Success Criteria
### 4.1 Goals
- Deliver clear multilingual explanations from pasted code.
- Support quiz creation through three paths: AI generation, JSON upload, and Instructor Editor.
- Support optional proctored quiz attempts with behavior logging.
- Keep the complete loop in one app: Explain -> Revise -> Ask -> Quiz -> Score.

### 4.2 Success Metrics
- Explain response latency <= 40s at p95 (client timeout guard).
- Quiz generation latency <= 45s at p95.
- >= 90% successful AI JSON parse/normalization rate.
- Users can complete Explain -> Quiz Attempt -> Score without leaving the app.

## 5. Scope
### 5.1 In Scope
- Monaco code editor + Explain workflow.
- Multilingual explanations.
- Flashcards and key points.
- Tutor voice playback.
- Ask AI mentor panel for follow-up doubts.
- Quiz Studio:
  - AI quiz generation (topic/type/difficulty/count + optional code context)
  - Upload quiz JSON
  - Instructor Editor for manual/custom question authoring
  - Take Quiz mode and local grading
  - Optional proctored mode (warnings/events)
- User auth and profile sync.
- Analytics dashboard and study-plan generation.
- Result export as JSON.
- Dark/Light theme toggle.

### 5.2 Out of Scope (Current Version)
- Live classroom/instructor broadcast mode.
- Remote webcam-based proctoring.

## 6. Functional Requirements
### FR-01 Explain Code
- User shall paste code and request explanation.
- System shall call `/api/explain` with `{ code, outputLanguage, codeLanguage }`.
- System shall show summary, responsibilities, edge cases, suggested unit test, used lines, flashcards, key points, transcript, confidence.

### FR-02 Multilingual Learning
- User shall select explanation language from predefined options.
- System shall return explanation content in selected language.

### FR-03 Tutor Voice
- System shall read the explanation transcript via browser SpeechSynthesis.
- User shall control playback (play, pause/resume, close).

### FR-04 Ask AI Mentor
- User shall ask follow-up questions related to current code.
- System shall call `/api/ask` and return answer + follow-up prompts.

### FR-05 Quiz Creation Options
- User shall be able to:
  - Generate quiz using AI (`/api/quiz/generate`)
  - Upload quiz JSON file
  - Manually create/edit questions in Instructor Editor
- Question types shall support MCQ, Text, and Code.
- Difficulty shall support Easy, Medium, Hard.

### FR-06 Quiz Attempt and Proctoring
- User shall attempt quizzes in Take Quiz mode.
- System shall support optional proctored mode with event warnings.
- System shall record attempt summary and proctor summary for authenticated users.

### FR-07 Grading and Export
- System shall compute score and show per-question result.
- System shall export quiz result JSON.

### FR-08 Backend Health Visibility
- Frontend shall check `/api/health` and show backend status.

### FR-09 Error Handling
- System shall show clear errors for timeout, invalid payload, backend unavailable, upstream AI failure, and malformed AI output.

## 7. Non-Functional Requirements
### NFR-01 Performance
- Health check should respond quickly (<1s in normal conditions).
- Explain and quiz requests should use timeout and abort handling.

### NFR-02 Reliability
- Error responses should follow consistent structure.
- Backend should use JSON extraction + normalization before sending AI-derived data.

### NFR-03 Usability
- UI should be student-friendly, readable, and action-oriented.
- Quiz capabilities (AI generation, upload, Instructor Editor, proctored attempt) should be clearly discoverable.

### NFR-04 Maintainability
- Clear frontend/backend separation.
- Environment-based API configuration.

### NFR-05 Security
- API keys only in backend `.env`.
- No secret exposure in frontend bundle.
- Protected analytics/profile routes require bearer token.

## 8. External Dependencies
- AI API provider (LLM service).
- Browser Web Speech API.
- Monaco Editor.

## 9. Assumptions and Constraints
- Internet connectivity required for AI calls.
- Speech feature depends on browser voice support.
- AI output can vary; normalization and fallback are required.

## 10. Acceptance Criteria
- `requirements.md` and `design.md` exist at repo root.
- `/api/explain` returns structured explanation data.
- `/api/quiz/generate` supports type/difficulty/count and optional context code.
- Quiz Studio supports AI generation, JSON upload, and Instructor Editor.
- Proctored mode toggle works in Take Quiz mode and logs warnings/events.
- Architecture prompt and architecture flowchart docs reflect the current frontend-backend connections.
- Presentation content is aligned with implementation for demo/judging.

## 11. Risks and Mitigation
- **Risk:** LLM returns invalid JSON.  
  **Mitigation:** `tryExtractJson` + quiz normalization + fallback handling.
- **Risk:** Backend unavailable during demo.  
  **Mitigation:** `/api/health` badge + clear error banners.
- **Risk:** Upstream timeout.  
  **Mitigation:** `AbortController` + timeout-based user messaging.

## 12. Submission Deliverables
- GitHub repo containing:
  - `requirements.md`
  - `design.md`
  - source code
  - docs (`docs/codecoach-architecture-flow.md`, `docs/presentation-content.md`)
- Presentation deck (PDF) from organizer template.

## 13. Estimated Implementation Cost
### 13.1 One-Time Build Cost (Development)
- Student/team implementation (self-built): mainly time cost, minimal direct spend.
- Freelance/small agency style build (8-12 weeks): approximately **USD 12,000 to USD 45,000** depending on team size and rates.
- Product-grade implementation with QA/devops depth: approximately **USD 45,000 to USD 120,000**.

### 13.2 Monthly Operating Cost (MVP Scale)
- AI API usage: **USD 20 to USD 300+** (depends on request volume and token usage).
- Backend hosting + storage + monitoring: **USD 15 to USD 120**.
- Domain and misc. tooling: **USD 2 to USD 30**.
- Estimated total monthly run cost: **USD 40 to USD 450+**.

### 13.3 Cost Notes
- Costs vary by active users, prompt length, and quiz/explain usage frequency.
- Proctored mode logging adds storage/events but usually low-to-moderate extra cost at MVP scale.
