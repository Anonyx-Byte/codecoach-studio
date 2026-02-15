# CodeCoach Studio

AI-assisted coding education platform designed to provide structured learning workflows for programming students.

## Core Features

- Structured code explanation engine (JSON-enforced output)
- Multilingual explanations
- Tutor voice narration (Web Speech API)
- Flashcards + key points
- AI quiz generation (difficulty/type controlled)
- Instructor Editor for manual quiz authoring
- JSON quiz upload
- Proctored quiz mode with event logging
- Grading and result export
- Backend health monitoring endpoint

## Architecture

Frontend: React + TypeScript + Vite + Monaco  
Backend: Express + AI API integration  
AI Provider: LLM-based structured completion  

## Learning Workflow

Explain → Revise → Ask → Generate Quiz → Attempt → Score → Reflect

## Repository Structure

- `codecoach/` – Frontend application
- `backend/` – API server
- `requirements.md` – Product requirements
- `design.md` – System architecture and flow documentation

---

Developed for AI for Bharat Hackathon.

