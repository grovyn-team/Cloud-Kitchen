# Deploying Grovyn Autopilot

Production setup: **frontend on Netlify**, **backend on Vercel**. Use env vars for all secrets and URLs; never commit `.env` (see `.gitignore`).

---

## 1. Backend (Vercel)

### Local

- Copy `backend/.env.example` to `backend/.env` and set values if needed.
- From repo root: `cd backend && npm install && npm run dev` (runs on port 3001).

### Deploy to Vercel

1. **Connect repo**  
   In Vercel, import the repo and set the **root directory** to `backend`.

2. **Build & output**  
   - **Build Command:** leave empty or `npm install`  
   - **Output Directory:** leave empty (serverless)  
   - **Install Command:** `npm install`

3. **Environment variables** (Vercel project → Settings → Environment Variables):

   | Name         | Value                    | Notes                    |
   | ------------ | ------------------------ | ------------------------- |
   | `NODE_ENV`   | `production`             | Recommended               |
   | `CORS_ORIGIN` | `https://your-app.netlify.app` | Your Netlify frontend URL |

   Add **Production** (and Preview if you use it). No `PORT` needed; Vercel sets it.

4. **Deploy**  
   Deploy the backend. Note the URL (e.g. `https://grovyn-autopilot-api.vercel.app`). You’ll use it as the frontend API base.

---

## 2. Frontend (Netlify)

### Local

- Copy `frontend/.env.example` to `frontend/.env`. For local dev you can leave `VITE_API_BASE_URL` empty (Vite proxies `/api` to `http://localhost:3001`).
- From repo root: `cd frontend && npm install && npm run dev` (runs on port 5173).

### Deploy to Netlify

1. **Connect repo**  
   In Netlify, import the repo and set the **base directory** to `frontend` (or use the root and set build settings below).

2. **Build settings** (if base directory is repo root):
   - **Base directory:** `frontend`
   - **Build command:** `npm run build`
   - **Publish directory:** `frontend/dist`

   If you set Netlify’s base to `frontend`, the built-in `netlify.toml` uses `publish = "dist"` and `command = "npm run build"`.

3. **Environment variables** (Netlify → Site settings → Environment variables):

   | Name                 | Value                              | Notes              |
   | -------------------- | ---------------------------------- | ------------------ |
   | `VITE_API_BASE_URL`  | `https://your-backend.vercel.app`  | Backend URL above  |

   Redeploy after adding so the build picks up the variable.

4. **Deploy**  
   Deploy the frontend. Then set the backend’s `CORS_ORIGIN` to this Netlify URL (e.g. `https://your-site.netlify.app`) and redeploy the backend if needed.

---

## 3. Security checklist

- **Never commit** `.env`, `.env.local`, or any file with secrets. They are in `.gitignore`.
- **Commit** `.env.example` (no real secrets; only variable names and placeholders).
- **CORS:** In production, set `CORS_ORIGIN` on the backend to your exact Netlify origin(s).
- **HTTPS:** Use HTTPS for both frontend and backend in production.

---

## 4. Optional: copy `.env.example` to `.env`

Locally you can copy the examples and fill in values:

```bash
# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
```

Then edit `backend/.env` and `frontend/.env` with real values. These files are gitignored.
