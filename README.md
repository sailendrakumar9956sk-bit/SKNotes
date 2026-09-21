# SKNotes — Mobile-friendly YouTube Notes App

This is a deploy-ready starter app for SKNotes.

## What it does
- Paste a public YouTube video URL
- Fetches an accessible YouTube transcript/captions
- Uses OpenAI to turn the lecture into exam-oriented notes
- Hindi / Hindi-Hinglish / English
- Class 9-10, Class 11-12, JEE/NEET, General modes
- Download notes as PDF
- Mobile-friendly UI

## Run locally
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run: `npm install`
4. Copy `.env.example` to `.env`
5. Put your OpenAI API key in `.env`
6. Run: `npm start`
7. Open `http://localhost:3000`

## Put it online
Upload this project to a Node.js-compatible hosting service (for example Render, Railway, or another Node host), set the environment variable `OPENAI_API_KEY`, and deploy.

## Important limitation
The transcript package can only retrieve captions/transcripts that are accessible. Some videos have no accessible transcript, are restricted, or block automated access. A production version should add a proper transcription provider and authentication/rate limits.

## Security
Never put the OpenAI API key inside `public/index.html`. Keep it as a server environment variable.
