# Grovyn Core Platform — Walkthrough (Non-Technical)

This guide walks you through the app as if you’re using it for the first time. No technical knowledge needed.

---

## 1. Opening the App

1. Make sure both **backend** and **frontend** are running (see **HOW-TO-RUN.md**).
2. Open your browser and go to: **http://localhost:5173**
3. You’ll see the **Sign in** page.

---

## 2. Signing In (Login)

- **Email:** Enter any email (e.g. `you@company.com`). For this demo it isn’t checked.
- **Role:** Choose who you are:
  - **Admin** — You see everything: all stores, finance, executive summary, all alerts.
  - **Staff** — You see only your store(s), operations, and alerts for your store. No money/revenue screens.
- **Store (only for Staff):** If you chose **Staff**, pick **one store** from the dropdown. That’s “your” store.
- Click **Sign in**.

You’re now inside the platform. What you see next depends on your role.

---

## 3. If You Signed In as **Admin**

### Top bar

- **Left:** “Grovyn Core Platform”
- **Right:** Your role (Admin), number of stores, and **Log out**

### Side menu (left)

You’ll see:

- **Dashboard**
- **Stores**
- **Finance**
- **Alerts**

---

#### **Dashboard** (first screen)

This is your “control room.”

- **“What’s happening”** — One card that sums up:
  - Revenue and margin
  - How many stores are at risk
  - A short list of things that need attention today
  - **“What you should do”** — 3 suggested actions (e.g. review pricing, check a store).

- **Four number cards** — Gross revenue, net revenue, profit, overall margin. Quick health check.

- **Store health** — List of stores with a **green** (healthy), **amber** (at risk), or **red** (critical) label.

- **Critical alerts** — Only the most urgent issues. If you see something here, it’s worth looking at first.

**In short:** You can understand the business in under 30 seconds from this page.

---

#### **Stores**

- Grid of **cards**, one per store.
- Each card shows:
  - Store name
  - Status: **healthy** / **at risk** / **critical**
  - How many alerts exist for that store (if any).
- Click a card to open that store’s **detail page**.

---

#### **Store detail** (when you click a store)

Three **tabs** at the top:

1. **Overview** — Store health, when it was last checked, and any “signals” or issues.
2. **Operations** — Inventory and staff/workforce alerts for that store (e.g. low stock, shortage).
3. **Finance** — Profit and margin for that store, plus any finance-related alerts. (Admin only.)

Use this to answer: *Is this store okay? What’s wrong? What about money?*

---

#### **Finance**

- **Four big numbers:** Gross revenue, net revenue, profit, overall margin (company-wide).
- **Flagged issues** — Only things that need your attention (e.g. margin leakage, negative profit, discount misuse). Each is a card with severity (critical / warning / info) and a short message.
- If there are no flagged issues, you’ll see a “No flagged issues” message.

No spreadsheets — just cards and clear messages.

---

#### **Alerts**

- **Critical** — Needs action soon. Shown at the top.
- **Warnings** — Worth reviewing.
- **Info** — For your awareness.

Each alert has a short message. As Admin you see **all** alerts across all stores.

---

## 4. If You Signed In as **Staff**

### Side menu (left)

You’ll see:

- **Dashboard**
- **Stores**
- **Operations**
- **Alerts**

You will **not** see **Finance**. That’s on purpose — money data is for Admins only.

---

#### **Dashboard**

- **“My store”** — Health of **your** store (the one you chose at login).
- **Alerts for your store** — Only alerts that concern your store.

No revenue, no profit, no margin. You see what you need to run your store, not company finances.

---

#### **Stores**

- You see only **your** store(s). Same card layout: name, status, alert count.
- Click your store to open its detail page.

---

#### **Store detail** (your store)

- **Overview** — Health and issues.
- **Operations** — Inventory and workforce alerts for your store.
- **Finance** tab is **hidden** for Staff. You don’t see it.

---

#### **Operations**

- **Inventory risks** — e.g. low stock, overstock, waste risk.
- **Staff & workforce** — e.g. shortage, overstaffing, productivity.

All of this is about **your** store so you can act on it.

---

#### **Alerts**

- Same layout as Admin (Critical / Warnings / Info).
- You see **only** alerts that relate to **your** store.

---

## 5. Logging Out

- Click **Log out** in the top-right corner.
- You’ll be sent back to the Sign in page. Your session is cleared (nothing is saved in the browser for next time).

---

## 6. Quick “Where do I go?” Guide

| I want to…                          | Go to…        | As…   |
|-------------------------------------|---------------|-------|
| See the big picture                 | Dashboard     | Admin |
| See all stores and their status     | Stores        | Both  |
| Drill into one store                | Stores → click a store | Both  |
| See only money / flagged issues    | Finance       | Admin |
| See what needs action now           | Alerts        | Both  |
| See inventory/workforce issues      | Operations or Store → Operations | Staff |

---

## 7. If Something Doesn’t Work

- **Blank or “can’t connect” page:**  
  Make sure the **backend** is running (`node src/server.js` in the `backend` folder) and the **frontend** is running (`npm run dev` in the `frontend` folder). Then open **http://localhost:5173** again.

- **“Access denied” on a page:**  
  That page isn’t allowed for your role (e.g. Staff can’t open Finance). Use the menu to go to a page you’re allowed to see.

- **No data / “Loading…” forever:**  
  Check that the backend is still running in its terminal and that you’re signed in with the right role and (for Staff) the right store.

You’re not expected to fix code — these steps are just so you know what to check first.

---

**In one sentence:**  
Sign in (Admin or Staff + store), use **Dashboard** to see what’s happening and what to do, use **Stores** and **Alerts** to act, and use **Finance** (Admins only) to see money and flagged issues.
