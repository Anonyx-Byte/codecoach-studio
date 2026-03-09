# CodeCoach Studio

CodeCoach Studio is an **AI-powered coding mentor** designed to help students understand programming concepts faster through instant code explanations, AI tutoring, and adaptive practice quizzes.

Instead of waiting for instructor feedback, students can interact with an AI system that analyzes their code, explains logic step-by-step, and generates practice questions to reinforce learning.

---

## 🚀 Live Demo

Try the working prototype here:

👉 https://main.d8cqzw6o7lffj.amplifyapp.com

---

## ✨ Key Features

### AI Code Explanation
Paste code and receive structured explanations including summaries, key concepts, and potential edge cases.

### AI Quiz Generation
Generate programming quizzes based on topic and difficulty level with instant grading and feedback.

### Conversational AI Tutor
Ask questions about your code and receive context-aware explanations.

### Interactive Code Workspace
Built-in Monaco editor allows users to paste and analyze code directly inside the platform.

### Learning Analytics
Track quiz attempts, average scores, and weak topics through a simple analytics dashboard.

### Quiz Studio
Create quizzes using AI or upload custom quiz files for practice or instruction.
Instructors can create custom quizes too.

---

## 🏗 System Architecture

CodeCoach Studio uses a cloud-based architecture powered by AWS services.

```
User
 ↓
AWS Amplify (Frontend Hosting)
 ↓
CloudFront CDN
 ↓
Elastic Beanstalk (Node.js Backend)
 ↓
AI Layer
 ├─ AWS Bedrock (Gemma)
 └─ Groq API
 ↓
Data Layer
 ├─ Amazon DynamoDB
 └─ Amazon ElastiCache (Redis)
```

---

## 🛠 Tech Stack

### Frontend
- React
- TypeScript
- Vite
- Monaco Editor

### Backend
- Node.js
- Express

### AI Models
- AWS Bedrock (Gemma)
- Groq (Llama 3.1)

### Cloud Infrastructure
- AWS Amplify
- AWS Elastic Beanstalk
- Amazon DynamoDB
- Amazon ElastiCache (Redis)
- Amazon S3 
- Amazon CloudWatch

---

## 🎯 Project Goal

CodeCoach Studio explores how AI can improve programming education by providing:

- Instant feedback on code
- Interactive tutoring
- Personalized practice
- Learning progress tracking

The platform demonstrates how modern AI services can help make programming education more accessible and engaging.

---

## 🔮 Future Improvements

- Instructor dashboards for class analytics  
- Global CDN deployment for faster responses  
- Improve caching strategy for faster responses  
- Instructor dashboards with class analytics  
- Collaborative coding sessions 
- LMS integrations (Canvas, Moodle)  
- Better personalized learning paths 
- Leaderboard integration to compete with other peers or users
- Advanced AI tutoring workflows  

---

## 👨‍💻 Built For

AI4Bharat Hackathon 2026

---

## 📬 Contact

For questions or feedback, feel free to reach out through the repository issues or discussions.
