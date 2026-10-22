# VoxPilot — AI Voice Sales Bot

A React + Express implementation for the Sankar Group AI Voice Sales Bot assignment. This version uses **Groq for LLM responses and post-call analysis**, browser speech recognition for voice input, and browser speech synthesis for spoken AI replies. Supabase can persist calls and audio across deployments; local JSON/files are used only for development when Supabase credentials are absent.

## What it includes

- Sales dashboard, metrics, call history, search and status filtering.
- Live browser-based voice interaction (Chrome/Edge recommended): speech recognition → Groq response → browser text-to-speech.
- Recording consent before starting.
- Microphone audio recording and playback. **Important limitation:** the browser's built-in speech synthesis is not exposed as an audio stream, so the recording captures microphone audio while the transcript stores both sides. Do not describe this as a mixed recording of both speakers.
- AI-generated summary, requirements, objections, next steps, rationale and one of the six required sales statuses.
- Groq API key kept on the backend.
- Optional Supabase PostgreSQL and Storage persistence for deployment.

The sample product **CloudDesk** and its pricing are fictional demo data. Replace them in `client/src/main.jsx` before presenting if desired.

## Requirements

- Node.js 20+
- A Groq API key from https://console.groq.com/
- Latest Chrome or Edge recommended; microphone permission and speech recognition support are required.
- For persistent public deployment: Supabase project, database table and Storage bucket (instructions below).

## Run locally

From the project root:

```bash
npm install
cp .env.example server/.env
```

Edit `server/.env` and set:

```env
GROQ_API_KEY=your_real_groq_key
GROQ_MODEL=openai/gpt-oss-20b
PORT=8787
CLIENT_ORIGIN=http://localhost:5173
```

Then run:

```bash
npm run dev
```

Open http://localhost:5173. The API is at http://localhost:8787. Never place `GROQ_API_KEY` in the client or commit `.env` files.

## Supabase persistence (needed for reliable deployed call history)

1. Create a free project at https://supabase.com/.
2. Open SQL Editor and run `supabase-schema.sql`.
3. In Storage, create a bucket named `call-recordings` and mark it **public** for this simple assignment demo, so playback URLs work. Public buckets mean anyone with the recording URL may access the audio; only use consented demo audio, not sensitive conversations.
4. In Supabase project settings, copy the project URL and service-role key.
5. Set these **on the backend host only**:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

The service-role key bypasses row-level security and must never be exposed in frontend variables. If Supabase credentials are absent, the app uses local JSON and local disk, which are not durable on most free cloud hosts.

## Deploy for a public link

### 1. Push the project to GitHub

Create a repository and push this folder. Do not commit `.env` or real API keys.

### 2. Deploy the backend on Render

- Create a new **Web Service** from the repository.
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`
- Add environment variables: `GROQ_API_KEY`, `GROQ_MODEL`, `CLIENT_ORIGIN` (your Vercel URL), `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Use the free instance if available for your account/region. Free instances may sleep when idle, so the first request may be slow.
- Copy the deployed API URL.

### 3. Deploy the frontend on Vercel

- Import the same repository.
- Root Directory: `client`
- Framework preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Add environment variable `VITE_API_URL` with the Render API URL (for example `https://your-service.onrender.com`).
- Deploy and copy the Vercel URL.

### 4. Connect CORS

Set Render's `CLIENT_ORIGIN` to the exact Vercel origin (for example `https://your-app.vercel.app`), save the environment variable and redeploy/restart the backend.

### 5. Test the deployed workflow

- Open the public URL in Chrome/Edge and allow microphone access.
- Start a call and accept recording consent.
- Speak; verify the AI response is generated and spoken aloud.
- End the call; verify the summary and status are generated.
- Play the microphone recording and inspect the transcript.
- Refresh the page and verify history remains available from Supabase.
- Test again after the backend has been idle; a free instance may take time to wake up.

## Known limitations and honest test notes

- Web Speech recognition availability, language quality and permission prompts depend on browser and operating system. HTTPS is required for microphone access on a deployed site.
- Speech recognition in some browsers may rely on a browser-vendor service, so the entire voice path is not guaranteed to be offline.
- Recording currently captures the customer's microphone audio, while the AI's spoken response is represented in the saved transcript; the browser SpeechSynthesis API does not expose its generated audio as a MediaStream. A mixed two-sided recording would require a different audio/TTS implementation.
- Free-tier AI usage, database/storage quotas and hosting behavior can change. Free hosting is suitable for a demo, not a guarantee of uninterrupted production service.
- Do not claim the deployment or end-to-end test passed until you have actually tested it with real credentials.
