# Client app - Local Development

This doc covers the **Vite + React** client in this monorepo. The app lives in **`apps/client`**. Run all commands from the repo root with `apps/client` as the working directory, or `cd apps/client` first.

---

## 1. Prerequisites

- **Node.js** 20.x (or LTS)
- **Yarn** (package manager used by the project)

---

## 2. Install and run

From the repository root:

```sh
cd apps/client
yarn install
yarn dev
```

The app will be available at `http://localhost:5174` (or the port configured in vite.config files).

Other scripts:

| Script     | Command        | Description              |
|-----------|----------------|--------------------------|
| Dev server| `yarn dev`     | Start Vite dev server    |
| Build     | `yarn build`   | TypeScript + Vite build  |
| Preview   | `yarn preview` | Preview production build|
| Lint/format| `yarn lint` / `yarn format` | Biome lint and format |

---

## 3. Environment variables

Use a **`.env` in `apps/client`** so Vite loads it from the project root. A single `.env` at the **repository root** can cause issues: Vite’s default `envDir` is the config directory (`apps/client`), so a root `.env` is not loaded unless you change `envDir`, which can be brittle and confuse other tools.

1. Copy the example file:  
   `cp apps/client/.env.example apps/client/.env`  
2. Edit `apps/client/.env` and set the values below. Do not commit `.env`; it is gitignored.

**Client (Vite) variables** in `apps/client/.env`:

| Variable | Purpose |
|----------|---------|
| `VITE_APP_TITLE` | App title used in HTML file (e.g. "My OCLC App") |
| `VITE_APP_NAME`  | App name used to show on Login Page (e.g. "My Library") |
| `VITE_API_BASE_URL` | Backend API base URL (e.g. `http://localhost:8080/api` or your deployed API) |
| `VITE_BATCH_SIZE` | Batch size for API calls |
| `VITE_AZURE_FE_APP_TENANT_ID` | Azure AD tenant ID (frontend) |
| `VITE_AZURE_FE_APP_CLIENT_ID` | Azure AD client ID (frontend MSAL app) |
| `VITE_AZURE_BE_APP_CLIENT_ID` | Azure AD client ID (backend app) |
| `VITE_API_CODE` | Optional. When set, the client appends `?code=<value>` to `/search_books` and `/generate_xml` requests. Use only if your backend (e.g. Azure Functions with function key, or a custom API key) expects a key in the query string; leave unset if you rely solely on JWT Bearer auth. |

---

## 4. Backend

The client talks to the Azure Functions API. For local development, point `VITE_API_BASE_URL` at your local or deployed server. See [Server (apps/server)](./server.md) for running the API locally.

---

## 5. Core logic and architecture

This section describes how the client is built so you can make targeted edits (auth, data, storage, pagination).

### 5.1 Authentication (MSAL + AuthContext)

- **MSAL** (`@azure/msal-react`) is configured in `src/config/msal-instance.ts` and wrapped around the app in `App.tsx` via `MsalProvider`. All auth state and token handling live in **`src/context/authContext.tsx`** (`AuthProvider`, `useAuth`).
- **Login:** `login()` uses `loginRedirect` with scopes `openid`, `profile`, `email`. After redirect, the app acquires an **access token** for the backend API (scope `api://<backend-client-id>/.default`) via `acquireTokenSilent` or `acquireTokenRedirect`.
- **Role check:** The token’s JWT is decoded; the app requires one of roles (e.g. `MSAL_APP_NAME.Admin`, `MSAL_APP_NAME.User` or `ANY_SPECIFIC_NAME.Role`) defined in Azure for this application. If the user has no allowed role, the app clears auth state, preserves column-order localStorage (see below), clears the rest of localStorage, and redirects to `/login`.
- **Token refresh:** `getValidAccessToken(minValidityMs)` is used before API calls (e.g. in `src/lib/api.ts` interceptors) to ensure the token is valid for at least 10 minutes; a background interval runs every minute to refresh when close to expiry.
- **Logout:** We do **not** call `instance.logoutRedirect()`, because that signs the user out of their **Microsoft account** everywhere. Instead, **logout** in `authContext`:
  - Clears React state (user, accessToken).
  - Clears IndexedDB tables used for selection/query state: `checked_rows`, `unchecked_rows`, `recent_queried_successful_rows`.
  - Clears **localStorage** but **restores** theme (`bookops-ui-theme`) and column orders (`adv_unprocessed_columnOrder`, `processed_columnOrder`).
  - Calls `window.location.reload()` so the app restarts without the previous session. The user remains signed in to Microsoft; they can open the app again and sign in to this app specifically.

### 5.2 IndexedDB (Dexie)

The app uses **Dexie** (`src/lib/database.ts`) with a single database `BookOpsDatabase` and several tables:

| Table | Purpose |
|-------|---------|
| **`adv_unprocessed`** | Rows on the **query (home) page**: uploaded Excel data plus OCLC search results (original + retrieved columns). This is the main table for the “search” workflow. |
| **`processedData`** | Rows on the **Processed** page: records that have been “processed” from the query page and are used for MARC/MARCXML generation. |
| **`checked_rows`** | Which row IDs are currently **checked** (selected) per table name. Used to restore checkbox state and “process selected” behavior. |
| **`unchecked_rows`** | Which row IDs are explicitly **unchecked** (so we don’t re-check them when loading). |
| **`recent_queried_successful_rows`** | Row IDs that were successfully queried in the last run; used for UX (e.g. highlighting or batch behavior). |

On **logout**, only `checked_rows`, `unchecked_rows`, and `recent_queried_successful_rows` are cleared; `adv_unprocessed` and `processedData` are left so data persists across “app logouts” until the user clears or resets.

### 5.3 LocalStorage

- **Column order:**  
  - `adv_unprocessed_columnOrder` — order of columns on the **query (home)** table.  
  - `processed_columnOrder` — order of columns on the **Processed** table.  
  Both are preserved on **logout** and when clearing localStorage for role-denied users so the UI layout stays consistent.
- **Theme:** `bookops-ui-theme` (used by the theme provider) is preserved on logout.

Column order is applied in the table components via `sortColumns()` in `src/lib/sort-columns.ts`, which respects “special” columns (e.g. `oclc_number`, `error`, `search_query`, `*_new` pairs) and merges stored order with current data columns.

### 5.4 SessionStorage and URL–pagination sync

- **Page size:** `homePageSize` and `processedPageSize` are stored in **sessionStorage** (values like 10, 25, 50, 100) via `src/lib/session-storage.ts` (`getPageSizeFromStorage`, `savePageSizeToStorage`). They control how many rows per page on the home and processed tables.
- **Last page on home:** `last_page_on_home` is stored in sessionStorage when the user leaves the home page (e.g. to go to Processed). When they come back, the app restores the page number so they land on the same page (better UX).
- **URL sync:** The **Query (home)** and **Processed** pages use `useSearchParams()` (e.g. `?page=2`). Changing page updates the URL with `setSearchParams({ page: ... }, { replace: true })`, and on load the app reads `page` from the URL and validates it against total pages and page size (from sessionStorage). So pagination is **URL-driven** and shareable, and sessionStorage holds page size and “last page on home” for smooth navigation.

### 5.5 Where to make edits

| Area | Main files |
|------|------------|
| Auth, token, logout, roles | `src/context/authContext.tsx`, `src/config/msal-instance.ts` |
| API client, interceptors, errors | `src/lib/api.ts` |
| IndexedDB schema and access | `src/lib/database.ts` |
| Session storage (page size, last page) | `src/lib/session-storage.ts` |
| Column ordering / sort logic | `src/lib/sort-columns.ts` |
| Search (batch, retries, cancellation) | `src/lib/mutations/use-search-books.ts` |
| Generate XML | `src/lib/mutations/use-generate-xml.ts` |
| Query (home) page, table, process flow | `src/pages/Home.tsx`, `src/components/BookDataTable.tsx`, `src/components/ExcelUpload.tsx` |
| Processed page, table, XML download | `src/pages/Processed.tsx`, `src/components/ProcessedDataTable.tsx` |
| Routes, protection | `src/App.tsx`, `src/components/ProtectedRoute.tsx` |
