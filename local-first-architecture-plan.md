# Local-First Architecture Migration Plan (Odysseus Approach)

This document outlines the architectural transition of Nerdplexity from a split client-server model to a purely static, "Local-First" web application.

## 1. Goal
To create a secure, customizable, and free-to-host static frontend that runs local models and connects securely to OpenRouter without requiring a dedicated Node.js backend or server-side database.

## 2. Architecture Overview

### Current Architecture (Legacy)
- **Frontend:** React/Vite (Hosted on Vercel)
- **Backend:** Node.js/Express (Hosted on Railway)
- **Database:** SQLite (Ephemeral on Railway)
- **LLM Routing:** Handled server-side

### Target Architecture (Local-First)
- **Frontend:** React/Vite (Hosted on Vercel/GitHub Pages)
- **Backend:** Eliminated (Serverless API functions for proxies only)
- **Database:** IndexedDB (Browser-native local storage)
- **LLM Routing:** Client-side fetch requests directly to Ollama or OpenRouter.

## 3. Implementation Steps

### Step 1: Migrate Database to IndexedDB
- Replace the backend SQLite database with `idb` or `dexie.js`.
- Move all chat history, messages, and settings storage to the user's browser.
- Create import/export functions so users can back up their chats.

### Step 2: Direct Local Model Connection (Ollama)
- Move LLM streaming logic from the Node backend to the React frontend using the `AI SDK` or native `fetch`.
- Configure the frontend to connect directly to `http://localhost:11434`.
- *Note:* Users will need to configure Ollama with `OLLAMA_ORIGINS="*"` to allow CORS requests from the web app.

### Step 3: Secure OpenRouter Cloud Connection
- **Option A (BYOK):** Build a Settings UI where users can input their own OpenRouter API keys. Keys are stored locally in IndexedDB/localStorage.
- **Option B (Vercel Edge Proxy):** Create a lightweight Vercel Edge Function (`/api/chat`) that securely injects your free OpenRouter API key into the headers without exposing it to the client.

### Step 4: Host on Custom Domain
- Deploy the static build to Vercel.
- Attach the custom domain (e.g., `app.nerdchat.io`).
- Delete the Railway project to eliminate backend hosting costs and maintenance.

## 4. Security & Privacy Benefits
- **Zero Server Storage:** No user data or chat logs ever touch a remote database. Total privacy.
- **No API Key Leaks:** Users bring their own keys, or keys are safely tucked behind Edge Functions.
- **Free Hosting:** Static sites and Edge Functions fit entirely within Vercel's generous free tier.
