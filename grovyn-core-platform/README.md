# Grovyn Core Platform

Foundational platform for a large-scale cloud kitchen operating system. **Milestone 1** delivers a monorepo structure, Core Data Service with unified models, deterministic seeded data, and versioned internal APIs.

## Structure

```
grovyn-core-platform/
├── backend/          # Core Data Service (Node.js + Express)
│   └── src/
│       ├── config/   # Central config (port, seed options)
│       ├── models/   # City, Store, Brand, SKU, Customer, Order (plain JS)
│       ├── services/ # Data access layer (in-memory; seeded at boot)
│       ├── routes/   # Request/response only; v1 under /api/v1
│       ├── seed/     # Deterministic synthetic data generator
│       ├── utils/    # Reserved for future helpers
│       ├── app.js
│       └── server.js
├── frontend/         # React + Vite (placeholder only in M1)
│   └── src/
│       ├── main.jsx
│       └── App.jsx
└── README.md
```

## Data Models (Core Contract)

| Entity   | Key fields |
|----------|------------|
| **City** | id, name, country, timezone |
| **Store**| id, cityId, name, status (active/paused/maintenance), operatingHours |
| **Brand**| id, storeId, name, commissionRate |
| **SKU**  | id, brandId, name, price, cost |
| **Customer** | id, phone, createdAt |
| **Order**| id, storeId, brandId, customerId, totalAmount, commissionAmount, createdAt |

Relationships are explicit: Store → City, Brand → Store, SKU → Brand, Order → Store/Brand/Customer.

## Seeded Data (Deterministic)

On backend start, the seed runs with a **fixed random seed** so every run and every API call returns the same data:

- 2 cities  
- 3 stores per city (6 stores)  
- 2 brands per store (12 brands)  
- ~30 SKUs per brand (~360 SKUs)  
- ~4,000 customers  
- ~5,000 orders  

Data is stored **in memory** for this milestone (no database).

## Internal API (v1)

All endpoints are under **`/api/v1/`**. Response shape: `{ data: [...], meta: { count } }` (pagination can be added later).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Service status and timestamp |
| GET | `/api/v1/cities` | All cities |
| GET | `/api/v1/stores` | All stores |
| GET | `/api/v1/brands` | All brands |
| GET | `/api/v1/skus` | All SKUs |
| GET | `/api/v1/customers` | All customers |
| GET | `/api/v1/orders` | All orders |

Use **Postman** (or any HTTP client) to hit `http://localhost:3000/api/v1/...` once the backend is running.

## Running the platform

### Backend

```bash
cd backend
npm install
npm start
```

Server runs on **port 3000** (override with `PORT`). On boot it logs seed counts and exits with code 1 if seed generation fails.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on **port 5173** and shows: **Grovyn Core Platform Initialized**. No dashboards or logic in M1.

## Acceptance criteria (M1)

- [x] Backend starts without errors  
- [x] Seeded data is generated deterministically (fixed seed)  
- [x] All `/api/v1/*` endpoints return valid JSON with `data` and `meta`  
- [x] Health endpoint works  
- [x] APIs testable via Postman  
- [x] Frontend boots with placeholder screen  
- [x] Clear separation: routes → services → data; seed isolated in `/seed`  

## What is not in this milestone

- Authentication  
- UI dashboards or business logic  
- AI  
- Database or external APIs  
- Business rules  

This milestone is **structure + data only**, built so future modules (orders, inventory, staff, finance, AI) can plug in without refactoring the foundation.
