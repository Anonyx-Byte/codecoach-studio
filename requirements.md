# Requirements Document — CodeCoach Studio

---

## 1. Introduction

CodeCoach Studio is an AI-assisted coding education platform designed to help learners understand, practice, and assess programming concepts through structured explanations, adaptive quizzes, and performance analytics.

The platform integrates the complete learning loop:

**Explain → Revise → Ask → Generate Quiz → Attempt → Score → Review Analytics**

---

## 2. Purpose

This document formally defines the functional and non-functional requirements of CodeCoach Studio in a structured and implementation-aligned format.

---

## 3. System Overview

CodeCoach Studio enables:

- Structured AI-powered code explanations
- Multilingual learning support
- AI-assisted and instructor-created quizzes
- Optional proctored quiz attempts
- Performance tracking and analytics
- Secure authentication and role-based access

### Architecture Overview

- **Frontend:** React + TypeScript
- **Backend:** Node.js + Express
- **AI Layer:** External AI API
- **Datastore:** Local JSON-based persistence

---

## 4. Glossary

| Term | Definition |
|------|------------|
| System | CodeCoach Studio platform |
| Student | User who explains code and attempts quizzes |
| Instructor | User authorized to create/manage quizzes |
| Code Explanation | Structured AI-generated breakdown of code |
| Quiz | Structured assessment (MCQ, Text, Code) |
| Proctored Mode | Quiz mode that logs behavioral events |
| Analytics Dashboard | Learning performance overview |
| AI Service | External AI API used for generation |
| Datastore | Local JSON persistence system |
| Confidence Score | AI-estimated reliability indicator |

---

# 5. Functional Requirements

---

## FR-01: User Authentication

**User Story:**  
As a user, I want secure authentication so that my progress and analytics are personalized.

### Acceptance Criteria

1. WHEN valid credentials are submitted, THE System SHALL authenticate the user and issue a session token.
2. WHEN invalid credentials are submitted, THE System SHALL return an authentication error.
3. WHEN protected routes are accessed, THE System SHALL validate the session token.
4. WHEN a token expires, THE System SHALL require re-authentication.
5. THE System SHALL support role-based access control (Student / Instructor).

---

## FR-02: Structured Code Explanation

**User Story:**  
As a student, I want structured explanations of pasted code so that I can clearly understand program logic.

### Acceptance Criteria

1. WHEN code is submitted, THE System SHALL generate:
   - Summary
   - Responsibilities
   - Edge cases
   - Suggested unit tests
   - Flashcards
   - Key learning points
   - Transcript
   - Confidence score
2. THE System SHALL return explanations in the selected language.
3. THE System SHALL normalize AI responses before returning them.
4. IF the AI Service fails, THE System SHALL return a structured error response.

---

## FR-03: Follow-Up AI Mentor

**User Story:**  
As a student, I want to ask contextual follow-up questions.

### Acceptance Criteria

1. WHEN a follow-up question is submitted, THE System SHALL send relevant context to the AI Service.
2. THE System SHALL support multi-turn interaction.
3. THE System SHALL return answers in the user's selected language.
4. IF the AI Service fails, THE System SHALL return a user-friendly error.

---

## FR-04: AI-Generated Quiz Creation

**User Story:**  
As a student, I want AI-generated quizzes to test my understanding.

### Acceptance Criteria

1. WHEN quiz generation is requested, THE System SHALL generate questions aligned with the explained code.
2. THE System SHALL support difficulty selection (Easy, Medium, Hard).
3. THE System SHALL support question types (MCQ, Text, Code).
4. THE System SHALL validate and normalize AI output.
5. THE System SHALL persist generated quizzes.

---

## FR-05: Manual Quiz Authoring

**User Story:**  
As an instructor, I want to manually create quizzes.

### Acceptance Criteria

1. THE System SHALL validate quiz structure before saving.
2. WHEN JSON quiz is uploaded, THE System SHALL validate format and schema.
3. IF uploaded JSON is invalid, THEN THE System SHALL return validation errors.
4. THE System SHALL restrict quiz editing to Instructor users.

---

## FR-06: Quiz Attempt and Scoring

**User Story:**  
As a student, I want to attempt quizzes and view my score.

### Acceptance Criteria

1. THE System SHALL present quiz questions according to configuration.
2. THE System SHALL validate answer format.
3. WHEN quiz is completed, THE System SHALL calculate score.
4. THE System SHALL store quiz attempt results.
5. THE System SHALL display score and feedback.

---

## FR-07: Proctored Mode

**User Story:**  
As an instructor, I want optional monitoring during quizzes.

### Acceptance Criteria

1. WHEN Proctored Mode is enabled, THE System SHALL log behavioral events.
2. THE System SHALL log tab switches, copy, and paste actions.
3. THE System SHALL store logs securely.
4. WHEN Proctored Mode is disabled, no behavioral logging SHALL occur.

---

## FR-08: Analytics Dashboard

**User Story:**  
As a user, I want to track learning performance.

### Acceptance Criteria

1. THE System SHALL display quiz score trends.
2. THE System SHALL display topic-level performance.
3. THE System SHALL display attempt history.
4. THE System SHALL compute analytics from stored attempt data.
5. Instructor view SHALL show aggregated performance data.

---

## FR-09: Backend Health Monitoring

**User Story:**  
As an administrator, I want system health visibility.

### Acceptance Criteria

1. THE System SHALL expose `/api/health`.
2. THE System SHALL verify datastore accessibility.
3. THE System SHALL verify AI Service connectivity.
4. WHEN healthy, THE System SHALL return HTTP 200.
5. WHEN dependent service fails, THE System SHALL return HTTP 503.

---

# 6. Non-Functional Requirements

## Performance
- Health endpoint response < 1 second under normal conditions.
- AI calls must implement timeout handling.

## Reliability
- AI responses must be normalized before UI rendering.
- Error responses must follow consistent structure.

## Security
- API keys stored only in backend environment.
- No secret exposure in frontend.
- Protected routes require authentication.

## Maintainability
- Clear frontend/backend separation.
- Environment-based configuration.
- Modular architecture.

---

# 7. Submission Compliance

This repository contains:

- `requirements.md`
- `design.md`
- Source code
- Supporting documentation

Documentation generated via structured Spec → Design workflow and aligned with implementation.


