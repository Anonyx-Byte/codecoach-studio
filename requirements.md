# CodeCoach AI — Graph-Powered Skill Intelligence Platform
## Requirements Document

---

## Definitions

- **System**: The CodeCoach AI full-stack application (React frontend + Node.js backend)
- **Graph_Layer**: TigerGraph Cloud database for knowledge graph operations
- **Database_Layer**: Amazon DynamoDB for user data, analytics, quiz attempts, badges, and arena results
- **Cache_Layer**: Redis (optional, graceful fallback to in-memory)
- **AI_Layer**: AWS Bedrock (Gemma) and Groq (LLaMA 3.1) for code explanation and content generation
- **ReAct_Agent**: LangChain-based autonomous reasoning agent that queries TigerGraph using tools
- **Arena_Module**: Real-time 1v1 coding battle system with Socket.IO and Piston API
- **Auth_Module**: Google Sign-In (GSI) with JWT token-based authentication
- **Voice_Layer**: Amazon Polly for text-to-speech synthesis
- **GSQL**: TigerGraph's graph query language for multi-hop traversals
- **GNN-Lite**: Graph Neural Network-inspired weakness propagation algorithm
- **Knowledge_Debt**: Quantified score of accumulated conceptual gaps
- **Impostor_Detection**: Algorithm identifying high scorers with weak fundamentals

---

# Requirements

## Requirement 1: TigerGraph Knowledge Graph Integration

**User Story:**  
As a student, I want my learning tracked in a knowledge graph so the system can find WHY I'm struggling, not just WHAT I got wrong.

### Acceptance Criteria

1. THE Graph_Layer SHALL use TigerGraph Cloud with GSQL queries for all graph operations.
2. THE System SHALL maintain a graph schema with Student and Concept vertices connected by weak_in and prerequisite edges.
3. THE System SHALL update weak_in edges in real-time after every quiz attempt and arena battle.
4. THE System SHALL implement keep-alive mechanisms to prevent TigerGraph instance hibernation.
5. THE System SHALL gracefully fall back to demo mode if TigerGraph is unavailable.
6. THE System SHALL cache TigerGraph authentication tokens for 6 days.
7. THE System SHALL support multi-hop graph traversals (up to 4 hops for matchmaking).

---

## Requirement 2: GSQL Query Library

**User Story:**  
As a system architect, I want pre-installed GSQL queries so the system can perform complex graph reasoning efficiently.

### Acceptance Criteria

1. THE System SHALL implement skillIntelligence query to traverse Student → weak_in → Concept → reverse_prerequisite → Concept.
2. THE System SHALL implement knowledgeDebt query to rank concepts by error_frequency and calculate total debt score.
3. THE System SHALL implement arenaMatchmaking query to find students with overlapping weaknesses (4-hop traversal).
4. THE System SHALL implement findImpostors query to identify high scorers with many weak fundamentals.
5. THE System SHALL use TigerGraph's built-in tg_pagerank (GDSL) to rank concept importance.
6. THE System SHALL return structured JSON responses from all GSQL queries.
7. THE System SHALL handle query timeouts gracefully (15-second limit).

---

## Requirement 3: LangChain ReAct Agent (Graph AI Chat)

**User Story:**  
As a student, I want an AI mentor that autonomously queries my knowledge graph to give personalized answers.

### Acceptance Criteria

1. THE ReAct_Agent SHALL use LangChain's createReactAgent with Groq LLM backend.
2. THE ReAct_Agent SHALL implement three TigerGraph tools: get_skill_gaps, get_prerequisite_chain, find_similar_students.
3. THE ReAct_Agent SHALL show which tools were used for each response (transparency).
4. THE ReAct_Agent SHALL badge responses as "Graph-Powered" or "General AI" based on tool usage.
5. THE ReAct_Agent SHALL limit iterations to 4 to prevent infinite loops.
6. THE ReAct_Agent SHALL fall back to callModel with TigerGraph context if LangChain fails.
7. THE ReAct_Agent SHALL return intermediate steps for debugging and explainability.

---

## Requirement 4: Root Cause Analysis (Skill Intelligence)

**User Story:**  
As a student, I want to know the root cause of my struggles so I can fix the foundation, not just symptoms.

### Acceptance Criteria

1. THE System SHALL identify weak concepts by querying Student → weak_in edges.
2. THE System SHALL traverse reverse_prerequisite edges to find missing foundational concepts.
3. THE System SHALL return a recommended study order based on prerequisite dependencies.
4. THE System SHALL identify the root cause concept (highest weakness score with most blocking dependencies).
5. THE System SHALL normalize concept data from TigerGraph into consistent JSON format.
6. THE System SHALL provide fallback responses if TigerGraph query fails.
7. THE System SHALL expose /api/graph/skill-intelligence endpoint for frontend consumption.

---

## Requirement 5: Knowledge Debt Scoring

**User Story:**  
As a student, I want to see my total knowledge debt so I can prioritize what to study first.

### Acceptance Criteria

1. THE System SHALL calculate debt_score for each weak concept based on error_frequency and blocks_count.
2. THE System SHALL sum all debt scores to produce a total_debt value.
3. THE System SHALL classify debt_level as "critical" (>200), "high" (>100), or "moderate" (≤100).
4. THE System SHALL generate an optimal_path by sorting concepts by blocks_count (most blocking first).
5. THE System SHALL expose /api/graph/knowledge-debt/:studentId endpoint.
6. THE System SHALL update debt scores in real-time as quiz performance changes.
7. THE System SHALL visualize debt in the frontend dashboard with color-coded urgency.

---

## Requirement 6: GNN-Lite Prediction (Weakness Propagation)

**User Story:**  
As a student, I want to know which concepts I'll struggle with BEFORE attempting them so I can prepare.

### Acceptance Criteria

1. THE System SHALL propagate weakness signals through prerequisite edges weighted by PageRank centrality.
2. THE System SHALL predict future struggle scores for concepts not yet attempted.
3. THE System SHALL combine weakness_score with PageRank score to calculate predicted_difficulty.
4. THE System SHALL return top 3 predicted struggles with reasons.
5. THE System SHALL expose /api/graph/predict/:studentId endpoint.
6. THE System SHALL use tg_pagerank query results for concept importance weighting.
7. THE System SHALL flag concepts with predicted_score < 50 as "will_struggle".

---

## Requirement 7: Socratic Graph Questioning

**User Story:**  
As a student, I want the AI to ask me targeted questions instead of giving answers so I can discover solutions myself.

### Acceptance Criteria

1. THE System SHALL generate Socratic questions based on the student's weakest prerequisite.
2. THE System SHALL use skillIntelligence query results to identify the exact missing concept.
3. THE System SHALL accept problemContext and currentCode as inputs for contextual questions.
4. THE System SHALL limit questions to 2 sentences maximum.
5. THE System SHALL expose /api/graph/socratic-question endpoint.
6. THE System SHALL return the targeted concept name with the question.
7. THE System SHALL use AI temperature 0.4 for consistent, focused questions.

---

## Requirement 8: Interactive Skill Map Visualization

**User Story:**  
As a student, I want to see my knowledge graph visually so I can understand my learning landscape.

### Acceptance Criteria

1. THE System SHALL generate vis-network compatible node/edge data from TigerGraph queries.
2. THE System SHALL color-code nodes by weakness_score: red (>60), orange (30-60), green (<30).
3. THE System SHALL size nodes proportionally to weakness_score (20 + score/5).
4. THE System SHALL draw prerequisite edges with arrows showing dependency direction.
5. THE System SHALL expose /api/graph/skill-map/:studentId endpoint.
6. THE System SHALL return nodes and edges arrays in JSON format.
7. THE System SHALL support frontend graph interactions (zoom, pan, node click).

---

## Requirement 9: AI Learning Flowchart Generation

**User Story:**  
As a student, I want an SVG study path showing the exact order to learn concepts so I don't waste time.

### Acceptance Criteria

1. THE System SHALL generate flowchart nodes from skillIntelligence query results (no AI hallucination).
2. THE System SHALL create 5 phases: Start → Prerequisites → Practice Checkpoint → Weak Concepts → Mastery → Goal.
3. THE System SHALL position nodes using x/y coordinates for SVG rendering.
4. THE System SHALL connect nodes with directed edges showing learning flow.
5. THE System SHALL use AI to generate specific study recommendations per weak concept (optional enhancement).
6. THE System SHALL expose /api/graph/learning-flowchart endpoint.
7. THE System SHALL return nodes, edges, recommendations, and root_cause in JSON.

---

## Requirement 10: Impostor Syndrome Detection

**User Story:**  
As an instructor, I want to identify students with high quiz scores but weak fundamentals so I can intervene early.

### Acceptance Criteria

1. THE System SHALL query findImpostors with configurable quiz_threshold (default 75) and weakness_threshold (default 60).
2. THE System SHALL identify students with avg_quiz_score > threshold AND many weak_in edges.
3. THE System SHALL return impostor list with id, name, quiz_score, and skill_level.
4. THE System SHALL expose /api/graph/impostors endpoint.
5. THE System SHALL provide demo-mode fallback if TigerGraph query fails.
6. THE System SHALL flag impostors in instructor dashboards (future enhancement).
7. THE System SHALL use this data to trigger personalized interventions.

---

## Requirement 11: PageRank Concept Importance

**User Story:**  
As a curriculum designer, I want to know which concepts are most central to the learning graph so I can prioritize them.

### Acceptance Criteria

1. THE System SHALL run tg_pagerank on Concept vertices using prerequisite edges.
2. THE System SHALL return top_k concepts (default 5) sorted by PageRank score.
3. THE System SHALL expose /api/graph/pagerank endpoint.
4. THE System SHALL use PageRank scores in GNN-Lite prediction weighting.
5. THE System SHALL normalize PageRank results into consistent JSON format.
6. THE System SHALL provide demo-mode fallback with hardcoded top concepts.
7. THE System SHALL support configurable top_k parameter.

---

## Requirement 12: Arena Battle Mode (1v1 Coding Contests)

**User Story:**  
As a student, I want to compete in 1v1 coding battles so I can practice under pressure and learn from peers.

### Acceptance Criteria

1. THE Arena_Module SHALL use arenaMatchmaking query to find opponents with overlapping weaknesses.
2. THE Arena_Module SHALL generate unique problems targeting both players' weak concepts using AI.
3. THE Arena_Module SHALL execute code submissions via Piston API with 8-second timeout.
4. THE Arena_Module SHALL score submissions based on test case pass rate + speed bonus.
5. THE Arena_Module SHALL update TigerGraph weak_in edges based on arena performance.
6. THE Arena_Module SHALL persist results to DynamoDB ArenaResults table.
7. THE Arena_Module SHALL support real-time collaboration via Socket.IO.

---

## Requirement 13: AI vs Student Arena

**User Story:**  
As a student, I want to compete against an AI opponent that adapts to my skill level so I can practice anytime.

### Acceptance Criteria

1. THE System SHALL generate AI opponents with difficulty adapted to student's TigerGraph skill_level.
2. THE System SHALL pre-generate optimal AI solutions using callModel.
3. THE System SHALL calculate AI solve time based on problem difficulty and student skill level.
4. THE System SHALL reveal AI solution after contest completion with coaching analysis.
5. THE System SHALL determine winner based on correctness + speed comparison.
6. THE System SHALL expose /api/arena/ai-match and /api/arena/ai-result endpoints.
7. THE System SHALL update TigerGraph edges based on AI arena performance.

---

## Requirement 14: Arena Matchmaking Algorithm

**User Story:**  
As a student, I want to be matched with peers who have similar weaknesses so we can learn together.

### Acceptance Criteria

1. THE System SHALL use cosine similarity on student embeddings for initial matching.
2. THE System SHALL combine cosine similarity (60%) with weakness_score (40%) for final match score.
3. THE System SHALL return shared_weak_concepts array showing overlap.
4. THE System SHALL fall back to demo students if no TigerGraph matches found.
5. THE System SHALL exclude self-matches (student cannot match with themselves).
6. THE System SHALL normalize candidate data from multiple TigerGraph response formats.
7. THE System SHALL expose findArenaMatch function for use in match endpoint.

---

## Requirement 15: Arena Problem Generation

**User Story:**  
As a student, I want unique problems tailored to my weaknesses so every battle teaches me something new.

### Acceptance Criteria

1. THE System SHALL generate problems targeting shared_weak_concepts from matchmaking.
2. THE System SHALL adjust difficulty based on avg_skill_level of matched students.
3. THE System SHALL avoid problems already seen by either student (query QuizAttempts history).
4. THE System SHALL include title, description, examples, constraints, test cases, hints, and optimal approach.
5. THE System SHALL cache generated problems by roomId to prevent regeneration.
6. THE System SHALL use AI temperature 0.7 for creative problem variation.
7. THE System SHALL provide fallback problem if AI generation fails.

---

## Requirement 16: Code Execution via Piston API

**User Story:**  
As a student, I want my code executed safely in a sandbox so I can test solutions without security risks.

### Acceptance Criteria

1. THE System SHALL support 6 languages: JavaScript, Python, Java, C++, TypeScript, Go.
2. THE System SHALL use Piston API (emkc.org) for sandboxed execution.
3. THE System SHALL enforce 3-second execution timeout per test case.
4. THE System SHALL enforce 8-second total request timeout.
5. THE System SHALL compare stdout output with expected results for grading.
6. THE System SHALL handle execution failures gracefully (return empty stdout).
7. THE System SHALL strip markdown fences from AI-generated code before execution.

---

## Requirement 17: Arena Leaderboard

**User Story:**  
As a student, I want to see top performers so I can track my progress and stay motivated.

### Acceptance Criteria

1. THE System SHALL scan ArenaResults table to aggregate student performance.
2. THE System SHALL calculate wins, losses, and avg_score per student.
3. THE System SHALL look up student names from Users table.
4. THE System SHALL sort leaderboard by wins (primary) and avg_score (secondary).
5. THE System SHALL return top 10 students.
6. THE System SHALL expose /api/arena/leaderboard endpoint.
7. THE System SHALL handle missing user data gracefully (use studentId as name).

---

## Requirement 18: Arena Coaching Analysis

**User Story:**  
As a student, I want AI feedback on my arena solution so I can learn from my mistakes.

### Acceptance Criteria

1. THE System SHALL analyze student code, problem, score, and weak concepts using AI.
2. THE System SHALL generate coaching feedback with 5 sections: What You Did Well, Areas for Improvement, Optimal Approach, Pro Tip, Keep Going.
3. THE System SHALL return plain text analysis (not JSON, no code fences).
4. THE System SHALL adapt hint_style based on score: advanced (>70), intermediate (40-70), beginner (<40).
5. THE System SHALL expose /api/arena/analyze endpoint.
6. THE System SHALL use AI temperature 0.5 for balanced creativity and accuracy.
7. THE System SHALL provide fallback encouragement if AI analysis fails.

---

## Requirement 19: DynamoDB Data Layer

**User Story:**  
As a system administrator, I want a scalable NoSQL database for user data and analytics so the system can handle growth.

### Acceptance Criteria

1. THE Database_Layer SHALL use AWS SDK v3 for DynamoDB operations.
2. THE System SHALL maintain 6 tables: Users, Analytics, Sessions, QuizAttempts, UserBadges, ArenaResults.
3. THE System SHALL use on-demand billing mode for automatic scaling.
4. THE System SHALL automatically create missing tables on startup.
5. THE System SHALL use TTL on Sessions table for automatic cleanup.
6. THE System SHALL store nested attributes for user profiles and analytics summaries.
7. THE System SHALL handle table creation failures gracefully.

---

## Requirement 20: AI Code Explanation

**User Story:**  
As a student, I want AI-powered code explanations so I can understand unfamiliar code quickly.

### Acceptance Criteria

1. THE System SHALL accept code snippets with language and output language parameters.
2. THE AI_Layer SHALL generate structured explanations: summary, responsibilities, edge cases, key points, flashcards, transcript, confidence.
3. THE System SHALL support both quick and detailed review modes.
4. THE System SHALL extract JSON from AI responses even if wrapped in markdown.
5. THE System SHALL rate-limit explanation requests (24 per minute per IP).
6. THE System SHALL support multilingual explanations.
7. THE System SHALL provide flip-card UI for flashcards in frontend.

---

## Requirement 21: Smart Quiz Studio

**User Story:**  
As an instructor, I want AI-generated quizzes so I can create practice materials quickly.

### Acceptance Criteria

1. THE System SHALL generate quizzes based on topic, difficulty, question count, and optional context code.
2. THE System SHALL support 3 question types: MCQ, text, code.
3. THE System SHALL support 3 difficulty levels: easy, medium, hard.
4. THE System SHALL validate and normalize quiz JSON structure.
5. THE System SHALL support proctored mode with fullscreen lock, tab-switch detection, copy/paste blocking.
6. THE System SHALL provide AI-assisted grading for descriptive answers.
7. THE System SHALL track attempt history with improvement metrics.

---

## Requirement 22: Learning Analytics and Badges

**User Story:**  
As a student, I want to track my progress so I can see my improvement over time.

### Acceptance Criteria

1. THE System SHALL track quiz attempts with scores, topics, timestamps, and weak areas.
2. THE System SHALL compute analytics: avg_score, weak_topics, score_trend, completion_rate, improvement_percentage.
3. THE System SHALL award 6 badges: First Quiz, Quiz Explorer, 5 Day Streak, 80% Accuracy, Improvement Champion, Curious Learner.
4. THE System SHALL compute study streaks based on consecutive days of activity.
5. THE System SHALL provide detailed analytics: topic_accuracy, weekly_activity, recommended_practice_minutes.
6. THE System SHALL generate personalized study plans based on analytics.
7. THE System SHALL persist badges to UserBadges table.

---

## Requirement 23: Voice Synthesis

**User Story:**  
As a student, I want audio explanations so I can learn while multitasking.

### Acceptance Criteria

1. THE Voice_Layer SHALL use Amazon Polly for text-to-speech synthesis.
2. THE System SHALL support multiple voices and languages.
3. THE System SHALL return audio in MP3 format.
4. THE System SHALL gracefully degrade to browser SpeechSynthesis if Polly unavailable.
5. THE System SHALL rate-limit voice requests (18 per minute per IP).
6. THE System SHALL provide floating voice panel UI in frontend.
7. THE System SHALL support voice explanations for code analysis and quiz feedback.

---

## Requirement 24: Authentication and Security

**User Story:**  
As a developer, I want secure authentication so user credentials are protected.

### Acceptance Criteria

1. THE Auth_Module SHALL use Google Sign-In (GSI) for OAuth authentication.
2. THE Auth_Module SHALL use JWT tokens with HMAC-SHA256 signatures.
3. THE Auth_Module SHALL use bcrypt for password hashing (fallback for email/password auth).
4. THE Auth_Module SHALL enforce token expiration (default 24 hours).
5. THE Auth_Module SHALL use timing-safe comparison for token validation.
6. THE System SHALL enforce HTTPS in production (configurable).
7. THE System SHALL implement CORS with configurable allowed origins.

---

## Requirement 25: Rate Limiting and Abuse Prevention

**User Story:**  
As a system operator, I want rate limiting so the system can prevent abuse and ensure fair usage.

### Acceptance Criteria

1. THE System SHALL implement per-IP rate limiting with in-memory buckets.
2. THE System SHALL enforce different limits per endpoint: auth (40/10min), AI (24/min), run (20/min), voice (18/min), graph (30/min).
3. THE System SHALL return 429 status with Retry-After header when limit exceeded.
4. THE System SHALL use Redis for distributed rate limiting if available.
5. THE System SHALL fall back to in-memory rate limiting if Redis unavailable.
6. THE System SHALL reset rate limit buckets after window expiration.
7. THE System SHALL log rate limit violations for monitoring.

---

## Requirement 26: Health Monitoring

**User Story:**  
As a system operator, I want health endpoints so I can monitor system status.

### Acceptance Criteria

1. THE Health_Endpoint SHALL verify DynamoDB connectivity.
2. THE Health_Endpoint SHALL verify Redis connectivity.
3. THE Health_Endpoint SHALL verify TigerGraph connectivity (ping endpoint).
4. THE Health_Endpoint SHALL report AI provider availability.
5. WHEN dependencies fail, THE Health_Endpoint SHALL return HTTP 503.
6. WHEN the system is healthy, THE endpoint SHALL return HTTP 200.
7. THE Health_Endpoint SHALL expose /api/health with service status breakdown.

---

## Requirement 27: Deployment and Scalability

**User Story:**  
As a system operator, I want the application deployed in a scalable cloud environment.

### Acceptance Criteria

1. THE System SHALL deploy frontend using AWS Amplify or Vercel.
2. THE System SHALL deploy backend using AWS Elastic Beanstalk.
3. THE System SHALL support horizontal scaling via auto-scaling groups.
4. THE System SHALL use CloudFront CDN for frontend asset delivery.
5. THE System SHALL expose environment configuration via environment variables.
6. THE System SHALL gracefully shut down active requests during deployment updates.
7. THE System SHALL use CloudWatch for logging and monitoring.

---

## Requirement 28: Graceful Degradation

**User Story:**  
As a user, I want the system to continue working even if some services are unavailable.

### Acceptance Criteria

1. THE System SHALL continue operating without Redis (fall back to in-memory cache).
2. THE System SHALL continue operating without TigerGraph (fall back to demo mode with hardcoded data).
3. THE System SHALL continue operating without Polly (fall back to browser SpeechSynthesis).
4. THE System SHALL provide meaningful error messages when services are degraded.
5. THE System SHALL log warnings for unavailable services without crashing.
6. THE System SHALL use fallback AI providers (Groq if Bedrock fails, or vice versa).
7. THE System SHALL maintain core functionality (auth, quiz, code 
