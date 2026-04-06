# CodeCoach AI — Graph-Powered Skill Intelligence Platform
## Design Document

---

## Introduction

**CodeCoach AI** is a graph-powered learning platform that uses TigerGraph knowledge graphs to find WHY students struggle, not just WHAT they got wrong. Unlike traditional tutoring platforms that treat learning as a list, CodeCoach treats it as a graph — enabling root cause analysis, prerequisite gap detection, knowledge debt scoring, and predictive struggle forecasting.

**Tagline:** An AI coding tutor that uses knowledge graphs to find why you're stuck, not just what you got wrong.

**Key Differentiator:** When a student fails a problem, CodeCoach traverses 4 hops through their prerequisite graph, calculates knowledge debt, predicts future struggles, matches them with peers who overcame the same gap, and asks Socratic questions targeting the exact missing concept. No SQL database can do this. Only a graph.

---

## Overview

This design outlines a full-stack AI tutoring platform powered by:

- **TigerGraph Cloud** for knowledge graph operations (GSQL queries, multi-hop traversals, PageRank)
- **LangChain ReAct Agents** for autonomous graph reasoning with tool-based decision making
- **AWS Bedrock / Groq** for AI code explanation, quiz generation, and content creation
- **DynamoDB** for scalable user data, analytics, and quiz attempts
- **Socket.IO + Piston API** for real-time 1v1 coding battles with sandboxed execution
- **Redis** for optional caching and rate limiting (graceful fallback to in-memory)
- **Amazon Polly** for voice synthesis (graceful fallback to browser SpeechSynthesis)

The platform implements 14 core features including AI Code Explainer, Graph-Powered Skill Map, AI Learning Flowchart, Graph AI Chat (ReAct Agent), Smart Quiz Studio, Arena Battle Mode, Knowledge Debt Dashboard, Impostor Syndrome Detection, GNN-Lite Prediction, Socratic Graph Questioning, and more.

---

## Architecture

### High-Level Architecture

```
User (React SPA)
   |
   |-- Google OAuth ---------> Backend (Express)
   |                           |
   |-- Explain Code ---------->|-- callModel (Bedrock/Groq) --> AI Analysis
   |                           |
   |-- Quiz Generate/Grade --->|
   |-- Study Plan/Flashcards ->|
   |                           |
   |-- Graph AI Chat --------->|-- LangChain ReAct Agent
   |                           |   |-- Tool: get_skill_gaps ------> TigerGraph
   |                           |   |-- Tool: get_prereq_chain ----> (skillIntelligence)
   |                           |   |-- Tool: find_similar ---------> (arenaMatchmaking)
   |                           |
   |-- Skill Map ------------->|-- TigerGraph REST API
   |                           |   |-- skillIntelligence query
   |                           |   |-- knowledgeDebt query
   |                           |   |-- tg_pagerank (GDSL)
   |                           |
   |-- Arena Battle ---------->|-- Matchmaker + AI Problem Gen
   |                           |   |-- Piston API (code execution)
   |                           |   |-- TigerGraph (weak_in edge updates)
   |                           |
   |-- Quiz Submit ----------->|-- DynamoDB (attempt record)
   |                               + TigerGraph (weak_in edge upsert)
```


### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript, Vite, vis-network (graph viz), SVG flowcharts, Monaco Editor |
| **Backend** | Node.js + Express.js |
| **AI/LLM** | AWS Bedrock (Gemma) / Groq (LLaMA 3.1 8B Instant), LangChain ReAct agents |
| **Graph DB** | TigerGraph Cloud (GSQL queries, REST API, GDSL PageRank) |
| **Database** | AWS DynamoDB (users, analytics, quiz attempts, badges, arena results) |
| **Code Execution** | Piston API (sandboxed multi-language runner) |
| **Auth** | Google Sign-In (GSI) with JWT |
| **Caching** | Redis (optional, graceful fallback to in-memory) |
| **Voice** | Amazon Polly (graceful fallback to browser SpeechSynthesis) |
| **Real-Time** | Socket.IO for arena collaboration |

---

## Core Features

### 1. AI Code Explainer

**Description:** Paste any code and receive a structured breakdown including summary, responsibilities, edge cases, time/space complexity, and revision flashcards with flip-card UI.

**Implementation:**
- Frontend sends code + language + output language to `/api/explain`
- Backend constructs prompt with structured JSON schema
- AI (Bedrock/Groq) generates explanation
- Backend extracts JSON even if wrapped in markdown fences
- Frontend renders with flip-card flashcards for revision

**Key Components:**
- `buildExplainPrompt()` - Constructs AI prompt with JSON schema
- `tryExtractJson()` - Robust JSON extraction from AI responses
- Rate limiting: 24 requests/minute per IP

---

### 2. Graph-Powered Skill Map

**Description:** Interactive knowledge graph (vis-network) showing concepts, prerequisites, and weak areas. Color-coded nodes by mastery level. AI analysis powered by TigerGraph data.

**Implementation:**
- Frontend requests `/api/graph/skill-map/:studentId`
- Backend queries TigerGraph `skillIntelligence` GSQL query
- Backend normalizes concepts and builds vis-network node/edge structure
- Nodes colored by weakness_score: red (>60), orange (30-60), green (<30)
- Nodes sized proportionally: 20 + (weakness_score / 5)
- Edges show prerequisite dependencies with arrows

**Key Components:**
- `buildSkillIntelligenceResponse()` - Normalizes TigerGraph data
- `normalizeConcepts()` - Handles multiple TigerGraph response formats
- vis-network library for interactive graph rendering

---

### 3. AI Learning Flowchart

**Description:** SVG-rendered study path showing Start → Prerequisites → Practice Checkpoints → Weak Concepts → Mastery Goal. Generated from graph traversal + AI recommendations.

**Implementation:**
- Frontend requests `/api/graph/learning-flowchart`
- Backend queries TigerGraph `skillIntelligence`
- Backend builds 5-phase flowchart from actual graph data (no AI hallucination)
- AI generates specific study recommendations per weak concept (optional enhancement)
- Frontend renders as SVG with positioned nodes and directed edges

**Phases:**
1. Start Here (root cause)
2. Prerequisites (foundation concepts)
3. Practice & Apply (checkpoint)
4. Weak Concepts (what to fix)
5. Mastery Check → Goal

**Key Components:**
- Node positioning with x/y coordinates
- Edge connections showing learning flow
- AI-generated recommendations per concept

---

### 4. Graph AI Chat (LangChain ReAct Agent)

**Description:** Conversational AI mentor that queries TigerGraph in real-time using 3 tools. Shows "Graph-Powered" vs "General AI" badge on each response.

**Implementation:**
- Frontend sends question to `/api/graph/agent-ask`
- Backend invokes LangChain ReAct Agent with Groq LLM
- Agent autonomously decides which TigerGraph tools to call
- Agent executes tools and reasons about results
- Backend returns answer + tools_used + graph_powered flag
- Frontend displays badge based on tool usage

**Tools:**
1. `get_skill_gaps` - Queries skillIntelligence for weak concepts + prerequisites
2. `get_prerequisite_chain` - Returns ordered learning path
3. `find_similar_students` - Queries arenaMatchmaking for peer matches

**Key Components:**
- `createReactAgent()` - LangChain agent with tool-based reasoning
- `AgentExecutor` - Manages agent iterations (max 4)
- Fallback to `callModel` with TigerGraph context if agent fails

---

### 5. Smart Quiz Studio

**Description:** AI-generated quizzes (MCQ + text + code) with configurable topic/difficulty/count. Proctored mode with fullscreen lock, tab-switch detection, copy/paste blocking. AI-assisted grading for descriptive answers.

**Implementation:**
- Frontend configures quiz parameters (topic, difficulty, count, context code)
- Backend generates quiz using `buildQuizPrompt()`
- AI returns structured JSON with 3 question types
- Frontend renders quiz with proctored mode features
- On submit, backend grades and stores in DynamoDB + updates TigerGraph edges
- Frontend shows results with improvement tracking

**Question Types:**
- MCQ: 4 options, correctIndex
- Text: keywords for grading
- Code: starterCode, expectedKeyPoints

**Key Components:**
- `buildQuizPrompt()` - Structured prompt for quiz generation
- `buildGradePrompt()` - AI-assisted grading for text answers
- Proctored mode: fullscreen API, visibility change detection, clipboard blocking


### 6. Arena Battle Mode

**Description:** 1v1 coding contests (student vs student or vs AI opponent). AI generates unique problems tailored to both players' weak concepts from their graph data. Code executed via Piston API, scored on correctness + speed.

**Implementation:**
- Frontend requests `/api/arena/match` with studentId + embedding
- Backend queries TigerGraph `arenaMatchmaking` (4-hop traversal)
- Backend uses cosine similarity (60%) + weakness_score (40%) for matching
- Backend generates unique problem targeting shared_weak_concepts
- Frontend displays problem + countdown timer
- Students submit code to `/api/arena/submit`
- Backend executes via Piston API with 8-second timeout
- Backend scores based on test pass rate + speed bonus
- Backend updates TigerGraph weak_in edges based on performance
- Backend persists results to DynamoDB ArenaResults table

**Scoring Formula:**
```
base_score = (passed_tests / total_tests) * 100
speed_bonus = timeTaken < timeLimit * 0.5 ? 20 : 0
final_score = min(100, base_score + speed_bonus)
```

**Key Components:**
- `findArenaMatch()` - Matchmaking with cosine similarity
- `generateArenaProblem()` - AI problem generation targeting weaknesses
- `runCodeAgainstTestCase()` - Piston API execution
- `updateArenaWeakEdge()` - TigerGraph edge updates

---

### 7. Knowledge Debt Dashboard

**Description:** `knowledgeDebt` query ranks concepts by urgency (error_frequency). Shows total debt score and prioritized study list.

**Implementation:**
- Frontend requests `/api/graph/knowledge-debt/:studentId`
- Backend queries TigerGraph `knowledgeDebt` GSQL query
- Backend calculates total_debt by summing all debt_scores
- Backend classifies debt_level: critical (>200), high (>100), moderate (≤100)
- Backend generates optimal_path by sorting concepts by blocks_count
- Frontend displays with color-coded urgency

**Debt Score Calculation:**
```
debt_score = error_frequency * blocks_count
total_debt = sum(all debt_scores)
```

**Key Components:**
- `knowledgeDebt` GSQL query with @debt_score and @blocks_count accumulators
- Optimal path generation prioritizing blocking concepts

---

### 8. Impostor Syndrome Detection

**Description:** `findImpostors` query identifies students with high quiz scores but many weak fundamentals — flags potential knowledge gaps hiding behind good scores.

**Implementation:**
- Frontend requests `/api/graph/impostors`
- Backend queries TigerGraph `findImpostors` with thresholds
- Backend filters students with avg_quiz_score > 75 AND many weak_in edges
- Frontend displays impostor list with warning indicators

**Use Cases:**
- Instructor dashboards to identify at-risk students
- Personalized intervention triggers
- Early warning system for conceptual gaps

**Key Components:**
- `findImpostors` GSQL query with dual threshold filtering
- Demo mode fallback with hardcoded impostor data

---

### 9. Analytics Dashboard

**Description:** Quiz score trends over time, streak tracking, weak area heatmap, badge collection.

**Implementation:**
- Backend queries DynamoDB Analytics table for user attempts
- Backend computes: totalAttempts, avgScore, scoreTrend, weakTopics, badges
- Backend calculates streaks based on consecutive activity days
- Backend generates detailed analytics: topicAccuracy, weeklyActivity, completionRate, improvementPercentage
- Frontend renders with Chart.js visualizations

**Badges:**
1. First Quiz (1+ attempts)
2. Quiz Explorer (5+ attempts)
3. 5 Day Study Streak (5 consecutive days)
4. 80% Accuracy (avgScore ≥ 80)
5. Improvement Champion (last score - first score ≥ 15)
6. Curious Learner (5+ questions asked)

**Key Components:**
- `computeBadges()` - Badge award logic
- `summarizeAnalytics()` - Core metrics calculation
- `buildDetailedAnalytics()` - Extended metrics with trends

---

### 10. Tutor Voice

**Description:** Floating AI voice panel for quick explanations while coding.

**Implementation:**
- Frontend sends text to `/api/voice/synthesize`
- Backend uses Amazon Polly for TTS
- Backend returns MP3 audio stream
- Frontend plays audio in floating panel
- Graceful fallback to browser SpeechSynthesis if Polly unavailable

**Key Components:**
- Amazon Polly client with configurable voice/language
- Rate limiting: 18 requests/minute per IP
- Browser SpeechSynthesis fallback

---

### 11. Socratic Graph Questioning

**Description:** Instead of giving answers, the AI asks targeted questions based on prerequisite gaps. If stuck on recursion, it asks "What happens to the call stack when a function calls itself?" — question generated by traversing knowledge graph.

**Implementation:**
- Frontend requests `/api/graph/socratic-question` with studentId + problemContext + currentCode
- Backend queries TigerGraph `skillIntelligence`
- Backend identifies weakest prerequisite
- Backend uses AI to generate Socratic question targeting that concept
- Frontend displays question with targeted concept name

**Key Components:**
- Prerequisite sorting by weakness_score
- AI prompt with temperature 0.4 for focused questions
- 2-sentence maximum for conciseness

---

### 12. GNN-Lite Prediction (Graph Message Passing)

**Description:** Inspired by Graph Neural Networks (Kipf & Welling, 2017), weakness signals propagate through prerequisite edges weighted by PageRank centrality to predict which concepts you'll struggle with before attempting them.

**Implementation:**
- Frontend requests `/api/graph/predict/:studentId`
- Backend queries TigerGraph `skillIntelligence` + `tg_pagerank`
- Backend propagates weakness through prerequisite edges
- Backend calculates predicted_difficulty = weakness_score * pagerank_score * 10
- Backend returns top 3 predicted struggles with reasons
- Frontend displays predictions with "will_struggle" flags

**Prediction Formula:**
```
predicted_score = weakness_score * pagerank_centrality * 10
will_struggle = predicted_score < 50
```

**Key Components:**
- PageRank weighting for concept importance
- Multi-hop weakness propagation
- Predictive scoring algorithm

---

### 13. LangChain ReAct Agent (Detailed)

**Description:** Every AI answer is backed by autonomous graph reasoning. The agent (based on Yao et al. 2023 ReAct paper) decides which TigerGraph tool to call, executes it, then answers with real graph data.

**Implementation:**
- Agent uses Thought → Action → Observation loop
- Agent has access to 3 TigerGraph tools
- Agent iterates up to 4 times to gather information
- Agent returns final answer with intermediate steps
- Frontend shows which tools were used for transparency

**ReAct Loop:**
```
1. Thought: "I need to check the student's weak concepts"
2. Action: get_skill_gaps
3. Action Input: {"studentId": "s001"}
4. Observation: "Root cause: Recursion. Weak: Recursion, Trees. Prerequisites: Stack Frames, Base Cases"
5. Thought: "Now I can answer based on their graph data"
6. Final Answer: "You're struggling with recursion because you're missing stack frames..."
```

**Key Components:**
- `createReactAgent()` with custom prompt template
- Tool definitions with Zod schemas
- Intermediate step tracking for explainability

---

### 14. AI vs Student Arena

**Description:** Compete against an AI opponent whose difficulty adapts to your TigerGraph skill level. Beginners get a slower AI, advanced students face a faster one. AI reveals optimal solution after contest with coaching analysis.

**Implementation:**
- Frontend requests `/api/arena/ai-match`
- Backend queries TigerGraph for student skill_level + weak_concepts
- Backend generates problem targeting weaknesses
- Backend pre-generates optimal AI solution
- Backend calculates AI solve time based on skill level
- Student submits to `/api/arena/ai-result`
- Backend compares correctness + speed
- Backend reveals AI solution + coaching analysis

**AI Difficulty Adaptation:**
```
base_time = problem.timeLimit * 60 * 0.6
level_multiplier = skill_level < 50 ? 1.4 : skill_level > 75 ? 0.7 : 1.0
ai_solve_time = base_time * level_multiplier * random(0.9, 1.1)
```

**Winner Determination:**
- User wins: all tests passed AND faster than AI
- Tie: all tests passed BUT slower than AI
- AI wins: not all tests passed

**Key Components:**
- Adaptive AI difficulty calculation
- Pre-generated optimal solutions
- Coaching analysis with 5 sections

