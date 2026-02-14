# How to Run Grovyn Core Platform

## What You Need

- **Node.js** installed on your computer (download from [nodejs.org](https://nodejs.org) if you don’t have it).
- A terminal or command prompt (e.g. PowerShell on Windows, Terminal on Mac).

---

## Step 1: Start the Backend (the “engine”)

The backend is the part that holds your data and does the calculations. It must be running first.

1. Open a terminal/command prompt.
2. Go into the backend folder:
   ```bash
   cd backend
   ```
   (If you’re already in the project folder, use the path that gets you to the `backend` folder.)
3. Install dependencies (only needed once, or when something changes):
   ```bash
   npm install
   ```
4. Start the backend:
   ```bash
   node src/server.js
   ```
5. When you see something like “Server listening on port 3000” (or similar), the backend is running. **Leave this window open.**

---

## Step 2: Start the Frontend (what you see in the browser)

The frontend is the website you click around in. You run it in a **second** terminal window.

1. Open a **new** terminal/command prompt (keep the backend one open).
2. Go into the frontend folder:
   ```bash
   cd frontend
   ```
3. Install dependencies (only needed once):
   ```bash
   npm install
   ```
4. Start the frontend:
   ```bash
   npm run dev
   ```
5. When it says something like “Local: http://localhost:5173”, open your browser and go to: **http://localhost:5173**

---

## Quick Reference

| What              | Command (from the right folder) |
|-------------------|---------------------------------|
| Start backend     | `cd backend` then `node src/server.js` |
| Start frontend    | `cd frontend` then `npm run dev` |
| Open the app      | In browser: **http://localhost:5173** |

- **Backend** = one terminal, leave it running.
- **Frontend** = second terminal, leave it running.
- **Browser** = go to http://localhost:5173 to use the app.

To stop: in each terminal press **Ctrl+C**.

---

## Troubleshooting

### "EADDRINUSE: address already in use :::3000"

Port 3000 is already in use (often by another backend instance).

- **Fix 1:** Close any other terminal where the backend is running. Use only one backend process.
- **Fix 2:** Free the port — in PowerShell run:
  ```powershell
  npx kill-port 3000
  ```
  (from the backend folder, or install once: `npm install -g kill-port`). Then start the backend again.
- **Fix 3:** Run the backend on another port, e.g. 3001:
  - In the backend terminal: `$env:PORT=3001; node src/server.js` (PowerShell).
  - In the frontend folder create a file `.env` with: `VITE_API_BASE_URL=http://localhost:3001`
  - Restart the frontend (`npm run dev`).
