# Snapicat

**Snapicat** is a monorepo for a **Worldcat OCLC** workflow app: upload Excel data, search variables against the OCLC API, and generate MARC/MARCXML for cataloging. It consists of a **Vite + React** frontend and an **Azure Functions** (Python) backend that talk to the [OCLC Worldcat Metadata API](https://developer.api.oclc.org/wc-metadata-v2#/). The backend can also be ran as a web server through utilizing Fastapi via `app.py` file.

## What it does

- **Upload** — Users upload Excel/CSV files; the app parses rows and displays them in a query table.
- **Search** — Rows are sent to the backend in batches; the backend builds OCLC search queries, calls the API, and returns brief-bib data (e.g. OCLC number, title, author). Results are shown alongside original data (including “retrieved” vs “original” columns).
- **Process** — Successful rows can be marked and moved to a “Processed” view. Processed records are stored locally (IndexedDB).
- **Generate XML** — From the Processed page, users can generate MARC or MARCXML for selected OCLC numbers and download a single file.

Authentication is **Azure AD (Microsoft)** via MSAL; the backend validates JWT and uses **OCLC WSKey** credentials to call the Worldcat API.

## Tech stack

| Layer   | Tech |
|--------|------|
| Client | React 19, Vite 7, TypeScript, TanStack Query, MSAL (Azure AD), Dexie (IndexedDB), Tailwind CSS, shadcn-style UI |
| Server | Python 3.11, Azure Functions (or FastAPI standalone), OCLC API (OAuth + search/bibs) |

## Repository structure

| Path           | Description |
|----------------|-------------|
| `apps/client`  | Frontend. Own `package.json` and `node_modules`. |
| `apps/server`  | Backend. Own `venv` and `requirements.txt`. |

No NX or Turborepo; client and server are independent.

## Run locally

### Prerequisites

- **Node.js** 20.x and **Yarn** (for the client)
- **Python 3.11** (for the server; avoid 3.13+ due to grpcio)
- **OCLC WSKey + secret** and **Azure AD** app registration (tenant ID, client IDs for frontend and backend)

### 1. Clone and env

```bash
git clone <repo-url>
cd snapicat
```

Use **per-app** env files to avoid tooling and path issues (Vite and the standalone server each load `.env` from their own directory; a single root `.env` can cause wrong paths or missing variables).

- **Client:** `cd apps/client` then copy `apps/client/.env.example` to `apps/client/.env` and set the `VITE_*` variables (see [docs/client.md](docs/client.md)).
- **Server:**  
  - **Azure Functions:** copy `apps/server/local.settings.json.example` to `apps/server/local.settings.json` and set `OCLC_WSKEY`, `OCLC_SECRET`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, etc. (see [docs/server.md](docs/server.md)).  
  - **Standalone (app.py):** copy `apps/server/.env.example` to `apps/server/.env` and fill in the same variables.

### 2. Client

```bash
cd apps/client
yarn install
yarn dev
```

App runs at **http://localhost:5174** (or the port in `vite.config`). Point `VITE_API_BASE_URL` at your backend (e.g. `http://localhost:8080/api`).

### 3. Server (Azure Functions)

```bash
cd apps/server
python3.11 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
func start --port 8080 --cors http://localhost:5174
```

Functions are at **http://localhost:8080/api/search_books** and **http://localhost:8080/api/generate_xml**.

Alternatively, run the **standalone FastAPI** server (see [docs/server.md](docs/server.md)):

```bash
cd apps/server
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

### 4. Use the app

1. Open the client in the browser and sign in with Azure AD (an account with the required app roles).
2. Upload an Excel file on the home page.
3. Run “Search” to query OCLC; results fill into the table.
4. Process selected rows; they appear on the Processed page.
5. On the Processed page, generate MARC/MARCXML and download.

## Documentation

| Doc | Contents |
|-----|----------|
| [**docs/client.md**](docs/client.md) | Client setup, env vars, **core logic** (MSAL/auth, IndexedDB, storage, pagination), and where to make edits. |
| [**docs/server.md**](docs/server.md) | Server setup (venv, Azure Functions, standalone), **core logic** (OCLC token manager, OCLC service, auth validation, APIs), and where to make edits. |
| [**docs/infrastructure.md**](docs/infrastructure.md) | Azure components (Storage static website, Front Door/CDN, Function App, Entra ID), custom domain flow, and how they connect. |
| [**docs/deployment.md**](docs/deployment.md) | CI/CD (GitHub Actions), triggers and environments, required GitHub vars/secrets, and post-deploy (CORS, custom domain, Entra redirect URIs). |
| [**docs/contribution.md**](docs/contribution.md) | Branch naming, commit messages, PR guidelines, and Biome setup (client). |

Workflows: `.github/workflows/deploy-client.yml` and `.github/workflows/deploy-server.yml`.
