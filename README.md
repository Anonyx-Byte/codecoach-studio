# CodeCoach Studio

An AI-powered interactive coding mentor platform for students learning programming. Get instant code explanations, personalized quizzes, and real-time tutoring in 7 languages.

- It combinescode explanation, doubt-solving, flashcard revision, and quiz practice in one unified studio.
- Instructors and students can generate, upload, or manually create quizzes with instant scoring and optional proctored mode.
## Features

- 🤖 **AI Code Explanations** - Paste code and get structured analysis with flashcards and key points
- 📝 **Smart Quiz Generation** - AI-generated quizzes or upload your own JSON
- 💬 **Interactive Q&A** - Ask follow-up questions with context-aware AI tutor
- 🔊 **Voice Synthesis** - Audio explanations in 7 languages (AWS Polly)
- 📊 **Learning Analytics** - Track progress, scores, and weak areas
- 🔐 **Google Sign-In** - Quick authentication with OAuth
- 🎯 **Proctored Quizzes** - Academic integrity monitoring for assessments
- ⚡ **Code Execution** - Run JavaScript, Python, Java, C++ in isolated sandbox

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, Monaco Editor  
**Backend:** Node.js, Express  
**AI:** AWS Bedrock (Claude 3 Sonnet), AWS Polly  
**Database:** DynamoDB  
**Cache:** Redis

## Deployment

- Frontend: CloudFront + S3
- Backend: ECS Fargate or EC2 with PM2
- Database: DynamoDB
- Cache: ElastiCache Redis
- AI: AWS Bedrock
- Voice: AWS Polly
- Code Execution: AWS Lambda

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/google` - Google OAuth
- `POST /api/explain` - Code explanation
- `POST /api/quiz/generate` - Generate quiz
- `POST /api/ask` - Ask AI tutor
- `POST /api/run` - Execute code
- `GET /api/analytics/dashboard` - User analytics

## Team
CodeClarity
