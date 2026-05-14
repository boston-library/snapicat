# Deployment

This document describes how to deploy the snAPIcat client and server. It is split into:

- **Microsoft Azure + GitHub Actions** — Step-by-step use of the included workflows that build and deploy to Azure (Storage static website and Function App), with placeholders and environment variables instead of organization-specific names.
- **Alternate Deployment** — Basic guidance for building and deploying without Azure or GitHub Actions (e.g. other CI, manual deploy, other hosts).

For the role of each Azure component (Storage, Front Door, Function App, Entra ID), see [Infrastructure](./infrastructure.md).

---

## CODEOWNERS and branch protection (who approves PRs to main)

This section explains how **CODEOWNERS** and **branch protection** work together so you know when approval from @KeithGillette is required.

### What CODEOWNERS does (and does not do)

- **CODEOWNERS** (`.github/CODEOWNERS`) only **assigns** “owners” to paths in the repo. It does **not** by itself block or allow any merges.
- In this repo, the file contains: **`@KeithGillette`** & **`@bts-ssingh`**
  - The **`*`** means **every file** in the repository is owned by @KeithGillette.
  - So he is the code owner for **all** paths (not only `.github/` or any subset).

### When is approval required?

- **Only when branch protection is set up for that branch.**  
  GitHub can require “review from Code Owners” **per branch**:
  - **Every PR whose *base* branch is `main`** must get an approval from the code owner(s) of the **files changed in that PR**.
  - Because we use `@KeithGillette` & `@bts-ssingh` as the owners of this repository, so **every PR into main** needs approval from one of them (once branch protection is enabled).

### If you run this repo on your own infrastructure

If you deploy this codebase on your own EC2, Azure, or other host and use your own CI/CD or review process:

- You can **replace** `.github/CODEOWNERS` with your own (your team’s usernames and paths), or
- **Delete** `.github/CODEOWNERS` in your fork/copy if you do not want owner-based review.

Branch protection and CODEOWNERS are repo settings; they are independent of your workflows. Adjust or remove them to match your own policy.

---

## 1. Microsoft Azure + GitHub Actions

The repository includes GitHub Actions workflows that build the client and server and deploy them to Azure. They use **OIDC** (OpenID Connect) to authenticate to Azure from GitHub, so no long-lived Azure secrets are stored in the repo.

### 1.1 Triggers and environments

| Event | Condition | GitHub environment |
|-------|-----------|---------------------|
| Pull request **closed** | PR was **merged** and base branch is **develop** | `develop` |
| Pull request **closed** | PR was **merged** and base branch is **main** | `production` |

Workflow files:

- [`.github/workflows/deploy-client.yml`](../.github/workflows/deploy-client.yml) — client
- [`.github/workflows/deploy-server.yml`](../.github/workflows/deploy-server.yml) — server

Configure **develop** and **production** environments in the repo (Settings → Environments). You can use different Azure resources per environment (e.g. different Storage accounts and Function Apps) by setting different variables per environment.

### 1.2 Client deployment (Azure Storage static website)

**What the workflow does:**

1. Checkout repo, set up Node.js, run `yarn install` and `yarn build` in **`apps/client`**.
2. Inject **build-time** env: `VITE_*` variables from the GitHub **environment** variables and **secrets** (see table below).
3. Log in to Azure using OIDC (federated credential).
4. **Delete** existing blobs in the storage account’s `$web` container, then **upload** the contents of `apps/client/dist` to `$web` (overwrite).

**GitHub configuration (client):**

- **Federated credential (OIDC):** Create the Entra ID app registration, federated credential, and Azure RBAC assignment as in [Infrastructure — GitHub Actions and Azure (OIDC)](./infrastructure.md#4-github-actions-and-azure-oidc). You need this app’s **Application (client) ID**, plus **Directory (tenant) ID** and **Subscription ID** for the workflows.
- **Environment variables and secrets** for the client workflow:

| Name | Type | Purpose |
|------|------|---------|
| `STORAGE_ACCOUNT_NAME` | Variable | Target Azure Storage account name (e.g. snapicat). |
| `APP_TITLE` | Variable | Injected as `VITE_APP_TITLE` at build (e.g. "snAPIcat"). |
| `APP_NAME` | Variable | Injected as `VITE_APP_NAME` at build (e.g. app name shown on Login page). |
| `BATCH_SIZE` | Variable | Injected as `VITE_BATCH_SIZE`. |
| `API_BASE_URL` | Variable | Injected as `VITE_API_BASE_URL` (e.g. `https://<AZURE_FUNCTION_APP_NAME>.azurewebsites.net/api`). |
| `AZURE_TENANT_ID` | Variable | Entra tenant ID; also used for OIDC and `VITE_AZURE_FE_APP_TENANT_ID`. |
| `AZURE_FE_APP_CLIENT_ID` | Variable | Frontend Entra app client ID → `VITE_AZURE_FE_APP_CLIENT_ID`. |
| `AZURE_BE_APP_CLIENT_ID` | Variable | Backend Entra app client ID → `VITE_AZURE_BE_APP_CLIENT_ID`. |
| `AZURE_GITHUB_APP_CLIENT_ID` | Variable | OIDC: client ID of the Entra app used for the GitHub federated credential. |
| `AZURE_SUBSCRIPTION_ID` | Variable | OIDC: Azure subscription ID. |
| `API_CODE` | Secret | Optional. When set, injected as **`VITE_API_CODE`** so the built client sends `?code=...` on API requests (matches Azure Functions **`AuthLevel.FUNCTION`**). Get the value from **Azure Portal → your Function App → App keys → Host keys → default** (or a function-specific key); store it only in GitHub. See [Infrastructure — Server hosting (function key)](./infrastructure.md#21-microsoft-azure). |

Set these per environment (develop vs production) if you use separate Storage accounts or API URLs per environment.

### 1.3 Server deployment (Azure Function App)

**What the workflow does:**

**Build job:**

1. Checkout repo, set up Python 3.12.
2. Install dependencies from **`apps/server/requirements.txt`** into the runner and into **`apps/server/.python_packages/lib/site-packages`** so they are included in the zip.
3. From **`apps/server`**, create **`functionapp.zip`** (excludes `.git`, `.vscode`, `__pycache__`, `*.pyc`, `local.settings.json`).
4. Upload the zip as a workflow artifact.

**Deploy job:**

1. Download the artifact.
2. Log in to Azure with OIDC.
3. Deploy the zip to the Azure Function App using **Azure/functions-action** (`app-name` from variables).

Application settings (OCLC keys, Entra client/tenant IDs) are **not** in the zip; configure them in the Function App (Configuration → Application settings) in the Azure portal.

**GitHub configuration (server):**

| Name | Type | Purpose |
|------|------|---------|
| `AZURE_FUNCTION_APP_NAME` | Variable | Target Function App name (e.g. your chosen name). |
| `AZURE_GITHUB_APP_CLIENT_ID` | Variable | OIDC client ID. |
| `AZURE_TENANT_ID` | Variable | OIDC tenant ID. |
| `AZURE_SUBSCRIPTION_ID` | Variable | OIDC subscription ID. |

### 1.4 Post-deployment and one-time setup (Azure)

- **Azure resources:** Ensure you have a Storage Account with static website hosting and a Function App on Python 3.12. For Storage and Front Door/custom domain, see [Infrastructure — Client hosting](./infrastructure.md#1-client-hosting-static-website). For the Function App, app settings, CORS, and the HTTP **function key** used as `API_CODE`, see [Infrastructure — Server hosting (API)](./infrastructure.md#2-server-hosting-api).
- **Custom domain and CORS:** If you use a custom domain for the client (e.g. `https://snapicat.yourdomain.org`):
  1. **Client:** In the Storage Account, complete Front Door/CDN and domain association and DNS CNAME as in [Infrastructure](./infrastructure.md#11-microsoft-azure).
  2. **Server:** In the Function App, **API → CORS**, add the client origin(s) (e.g. `https://snapicat.yourdomain.org`).
  3. **Entra ID:** In the **frontend** app registration, **Authentication**, add the custom domain URL as a **Single-page application** redirect URI.
- **Branch strategy:** Use **develop** for staging and **main** for production, or align branches with your environments via the workflow conditions and environment variables.

---

## 2. Alternate deployment

If you are **not** using Microsoft Azure or GitHub Actions, you can still build and deploy the client and server yourself.

### 2.1 Client

- **Build:** From the repo root, run `cd apps/client && yarn install && yarn build`. The output is in **`apps/client/dist`**.
- **Environment:** Set all **`VITE_*`** variables (see `apps/client/.env.example`) **at build time**. The built files embed these values.
- **Deploy:** Upload the **contents** of `apps/client/dist` to your static host (Netlify, Vercel, S3, your own web server, etc.). See [Infrastructure – Alternate Hosting](./infrastructure.md#12-alternate-hosting) for options.
- **CI:** You can use any CI (GitLab CI, Jenkins, Bitbucket Pipelines, etc.): checkout repo, run the build with env vars set (from your CI’s secret/store), then upload or push the `dist` output to your host using that platform’s method.

### 2.2 Server

- **Dependencies:** `cd apps/server && pip install -r requirements.txt` (prefer a virtual environment).
- **Configuration:** Set environment variables as in `apps/server/.env.example` (`OCLC_WSKEY`, `OCLC_SECRET`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `CORS_ORIGINS`, `HOST`, `PORT`). For Azure Functions you would use `local.settings.json` or the portal; for the standalone app use a `.env` file or your host’s env configuration.
- **Run:** For a **non-Azure** host, run the FastAPI app: e.g. `cd apps/server && uvicorn app:app --host 0.0.0.0 --port 8080`. See [Server](./server.md).
- **Deploy:** Copy the `apps/server` directory (or build a Docker image) to your VPS, container platform, or PaaS (Railway, Fly.io, etc.). Ensure the chosen port is open and CORS is set to your client origin(s).
- **CI:** Any CI can run tests, build a Docker image, or push the code to your server; no GitHub Actions or Azure OIDC required.

### 2.3 Identity and secrets

- **Entra ID:** If you keep using Microsoft Entra ID (Azure AD), register the two apps and set redirect URIs and CORS as in [Infrastructure](./infrastructure.md#31-microsoft-azure-entra-id). Use your actual client URLs (from your alternate host) in redirect URIs and CORS.
- **Secrets:** Store OCLC keys and any API secrets in your platform’s secret store (e.g. CI secrets, host env vars, Kubernetes secrets) and never commit them.

---

## 3. Summary

| Area | Microsoft Azure + GitHub Actions | Alternate deployment |
|------|----------------------------------|----------------------|
| **Client** | Workflow builds `apps/client`, uploads to Storage `$web`; vars from GitHub env/secrets | Build locally or in your CI; upload `apps/client/dist` to your static host; set `VITE_*` at build time |
| **Server** | Workflow zips `apps/server`, deploys to Function App via OIDC; app settings in Azure | Run `app.py` (FastAPI) on your host; set env vars; deploy via your CI or manually |
| **Docs** | [Infrastructure — client](./infrastructure.md#1-client-hosting-static-website), [Infrastructure — server](./infrastructure.md#2-server-hosting-api), [Infrastructure — Entra](./infrastructure.md#31-microsoft-azure-entra-id), [Infrastructure — GitHub OIDC](./infrastructure.md#4-github-actions-and-azure-oidc) | [Infrastructure — Alternate Hosting](./infrastructure.md#12-alternate-hosting), [Infrastructure — Alternate server](./infrastructure.md#22-alternate-hosting) |
