# Infrastructure

This document describes hosting and identity for snAPIcat. For **each part of the setup** we provide:

- **Microsoft Azure** — Step-by-step guidance for running the app on Azure (Storage, Front Door, Function App, Entra ID), using placeholders and environment variables instead of organization-specific names.
- **Alternate Hosting** — Basic guidance for using the code on other platforms (non-Azure, non–GitHub Actions).

Use the Azure sections if you are on Azure; use the Alternate Hosting sections if you prefer a different provider or self-hosting.

---

## 1. Client hosting (static website)

### 1.1 Microsoft Azure

The client is a static site (HTML, JS, CSS) built from `apps/client`. On Azure it is typically hosted in a **Storage Account** static website, optionally behind **Front Door / CDN** for a custom domain and HTTPS.

| Component | Role |
|-----------|------|
| **Azure Storage Account** | Hosts the built files in the **`$web`** container. Enable **Static website** on the storage account. |
| **Azure Front Door / CDN** | Optional. Use when you want a custom domain (e.g. `https://snapicat.yourdomain.org`) and managed HTTPS. |

**Step-by-step (Azure):**

1. **Storage Account**  
   Create a storage account (e.g. name it with a generic value like `<STORAGE_ACCOUNT_NAME>`). Enable **Static website** and note the primary endpoint (e.g. `https://<STORAGE_ACCOUNT_NAME>.z.web.core.windows.net/`). The deployment pipeline (or manual upload) will put the contents of `apps/client/dist` into the `$web` container.

2. **Custom domain (optional)**  
   - In the Storage Account go to **Security + networking → Front Door and CDN**. Create a **Profile** and **Endpoint**; set the **origin** to the static website endpoint. Copy the **endpoint hostname** (e.g. `something-xxx.z01.azurefd.net`).  
   - Go to **Settings → Domains → Add a domain**. Enter your custom domain (e.g. `snapicat.yourdomain.org`).  
   - **Validation:** Add the **TXT** record Azure shows in your DNS; wait until the domain state is **Approved**.  
   - **Association:** Use **Associate** to link the domain to the Front Door endpoint and the default rule.  
   - In your DNS, add a **CNAME** record: **Name** = subdomain (e.g. `snapicat`), **Target** = the Front Door endpoint hostname from step 1.

3. **Build-time configuration**  
   The client needs `VITE_*` variables at **build** time (see [deployment](./deployment.md) and [client](./client.md)). Set `VITE_API_BASE_URL` to your backend API base URL (e.g. your Azure Function App URL or alternate server URL), `VITE_BATCH_SIZE` to the amount of records should be searched in 1 API call, and more variables, kindly check [.env.example](../apps/client/.env.example).

### 1.2 Alternate Hosting

You can host the client on **any static hosting** that serves the output of `apps/client` after build:

- **Netlify / Vercel / Cloudflare Pages:** Connect the repo, set the **build command** to `cd apps/client && yarn install && yarn build`, set the **publish directory** to `apps/client/dist`. Configure **environment variables** for `VITE_*` (see `apps/client/.env.example`) in the host’s dashboard so they are available at build time.
- **AWS S3 + CloudFront:** Build locally (or via CI) with `cd apps/client && yarn build`, then upload the contents of `apps/client/dist` to an S3 bucket and serve via CloudFront. Use the same `VITE_*` vars when building.
- **Your own server (nginx, Apache, etc.):** Build the client, then serve the `apps/client/dist` directory as a static site. Ensure the server sends `index.html` for client-side routes (e.g. SPA fallback).

In all cases, set **`VITE_API_BASE_URL`** (and other `VITE_*` vars) so the app points to your backend. If you use **Microsoft Entra ID (Azure AD)** for auth, you still need the Entra app registrations and redirect URIs; add your client’s public URL as a redirect URI in Entra.

---

## 2. Server hosting (API)

### 2.1 Microsoft Azure

The server runs the Python backend (OCLC search and XML generation). On Azure it is typically hosted as an **Azure Function App** (consumption or other plan) with the Python runtime.

| Component | Role |
|-----------|------|
| **Azure Function App** | Runs the HTTP-triggered functions `search_books` and `generate_xml` (e.g. `POST /api/search_books`, `POST /api/generate_xml`). |

**Step-by-step (Azure):**

1. **Function App**  
   Create an Azure Function App (e.g. name `<AZURE_FUNCTION_APP_NAME>`), runtime **Python 3.12**. Do **not** use 3.13 or greater (we use packages like `grpcio` and `grpcio-tools` that have compatibility issues on other versions). The deployment pipeline (or manual zip deploy) uploads the contents of `apps/server` (excluding `local.settings.json` and dev artifacts).

2. **Application settings**  
   In the Function App, **Configuration → Application settings**, add at least:
   - `OCLC_WSKEY`, `OCLC_SECRET` (OCLC API credentials)
   - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` (backend Entra app; used for JWT validation)
   - Optionally `CORS_ORIGINS` if you use the standalone FastAPI code path

   Do **not** commit these values; use the portal or secure variable storage.

3. **CORS**  
   In the Function App, open **API → CORS**. Add the **exact** origin(s) of your client (e.g. `https://snapicat.yourdomain.org` or your Storage static website URL). Use `https://` and no trailing slash as required by Azure.

### 2.1.1 Azure Function performance optimization (vNet + memory)

If you run the backend as an Azure Function App and need higher performance (e.g. larger batches, more concurrent requests), you can apply the following Azure-side optimizations. These are **optional** and apply only when you are hosting on Azure Functions.

**Step 1 – Create or choose a virtual network**

- In your Azure subscription, create (or reuse) a **Virtual Network (vNet)** with at least one subnet.

**Step 2 – Create a delegated subnet**

- In the **same vNet**, create a **delegated subnet** and delegate it to `Microsoft.App/environments`.  
  This subnet will be used for integration with your Function App.

**Step 3 – Open Function App networking**

- In the Azure portal, go to your **Function App** → **Networking**.

**Step 4 – Add virtual network integration**

- Under **Virtual network integration**, click the **“Not configured”** (or current) link.
- When prompted, click **“Add Virtual Network Integration”**.

**Step 5 – Select vNet and delegated subnet**

- In the dialog, choose your **subscription**, the **vNet** from step 1, and the **delegated subnet** from step 2.
- Click **Connect**.  
  After this completes, you should see the vNet integration listed for the Function App.

**Step 6 – Increase Function App memory and redundancy**

- In the same Function App, go to **Settings → Scale and Performance**.
- Increase the **instance memory** from **2 GB** to **4 GB**.
- Enable **zone redundancy** (if available in your region and plan).
- Click **Save**.

Once done:

- The Function App runs inside your vNet (useful if you later add private endpoints or need tighter network control).
- Each instance has more memory headroom (4 GB instead of 2 GB), which can improve performance and reduce out-of-memory issues under heavy load.

Apply these optimizations only in the Azure environments where you need the extra performance (e.g. staging/production), not necessarily for local or test deployments.

### 2.2 Alternate Hosting

You can run the server on **any host that can run Python 3.12**:

- **Standalone FastAPI (recommended for non-Azure):** The repo includes `apps/server/app.py`, which runs the same API logic as the Azure Functions. Install dependencies with `pip install -r apps/server/requirements.txt`, set environment variables (see `apps/server/.env.example`: `OCLC_WSKEY`, `OCLC_SECRET`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `CORS_ORIGINS`, `HOST`, `PORT`), then run e.g. `uvicorn app:app --host 0.0.0.0 --port 8080`. See [Server](./server.md) for details.
- **Docker:** Build an image that installs dependencies and runs `uvicorn app:app` (or `gunicorn` + uvicorn workers). Pass the same env vars via your orchestration (e.g. Docker env, Kubernetes secrets).
- **VPS / Railway / Fly.io / similar:** Run the FastAPI app as above; configure env vars and ensure the host allows inbound HTTP/HTTPS on the port you use. Set **CORS** (in `app.py` or via `CORS_ORIGINS`) to your client’s origin(s).

The server validates JWTs using **Entra ID** (Azure AD) by default (tenant ID, client ID, JWKS). If you need a different identity provider, you would need to change the auth logic in `shared/auth_token_validation.py` and the client’s MSAL configuration.

---

## 3. Identity (authentication)

### 3.1 Microsoft Azure (Entra ID)

The app is designed to use **Microsoft Entra ID (Azure AD)** for sign-in and API tokens. Two app registrations are used: one for the **frontend (SPA)** and one for the **backend (API)**.

**Step-by-step (Entra ID):**

1. **Frontend (SPA) app**  
   In **Microsoft Entra ID → App registrations**, create an app (e.g. “snAPIcat Client”). Under **Authentication**, add **Redirect URIs** with type **Single-page application** for every URL where the client runs (e.g. `https://snapicat.yourdomain.org`, `http://localhost:5174` for local dev). Note the **Application (client) ID** and **Directory (tenant) ID** — the client needs these as `VITE_AZURE_FE_APP_CLIENT_ID` and `VITE_AZURE_FE_APP_TENANT_ID`. Define **App roles** (e.g. `MSAL_APP_NAME.Admin`, `MSAL_APP_NAME.User`, `ANY_SPECIFIC_NAME.Role`) and assign them to users/groups; the client and backend use these for authorization.

2. **Backend (API) app**  
   Create a second app (e.g. “snAPIcat API”). Under **Expose an API**, define a scope (e.g. `api://<backend-client-id>/.default`). The frontend will request this scope when calling the API. Note the backend **Application (client) ID** — the Function App (or standalone server) needs it as `AZURE_CLIENT_ID`, and the client needs it as `VITE_AZURE_BE_APP_CLIENT_ID` so MSAL requests a token for this audience.

3. **Token validation**  
   The server uses the backend app’s client ID and tenant ID to validate the JWT (audience, issuer, signature, expiry) via Entra’s JWKS endpoint. No extra Azure steps are required beyond the two app registrations and the env vars above.

### 3.2 Alternate Hosting

The codebase is built around **Entra ID** (MSAL in the client, JWT validation against Entra in the server). To use another identity provider (e.g. Auth0, Keycloak, Okta), you would need to:

- Replace or adapt **MSAL** in the client with the provider’s SDK or OIDC flow.
- Replace or adapt **`shared/auth_token_validation.py`** in the server to validate tokens from that provider (e.g. different JWKS URL, issuer, audience).

This is not documented step-by-step here; treat it as a code-level change rather than a hosting configuration change.

---

## 4. How the pieces connect

- **Browser** loads the client from your chosen host (Azure Storage/Front Door or alternate static host) and runs the React app. MSAL redirects the user to Entra ID for sign-in.
- **Login:** After sign-in, the user is sent back to the client’s redirect URI. The client acquires an access token for the backend API scope (`api://<backend-client-id>/.default`).
- **API calls:** The client sends `Authorization: Bearer <token>` to the server (Azure Function App or alternate host). The server validates the JWT using Entra ID’s JWKS, then runs the business logic (OCLC search, XML generation).
- **OCLC:** The server uses `OCLC_WSKEY` and `OCLC_SECRET` to obtain and use OCLC API tokens; this is independent of the user’s Entra token.

If you use **Alternate Hosting**, the client URL and API URL are whatever you configured; CORS and redirect URIs must match those URLs.

---

## 5. Summary checklist

| Item | Microsoft Azure | Alternate Hosting |
|------|-----------------|-------------------|
| **Client** | Storage Account static website (`$web`); optional Front Door + custom domain | Any static host (Netlify, Vercel, S3+CloudFront, nginx); build from `apps/client`, set `VITE_*` at build time |
| **Server** | Azure Function App; app settings; CORS in portal | Run `app.py` (FastAPI) on VPS, Docker, Railway, etc.; set env vars and CORS |
| **Identity** | Entra ID: two app registrations, redirect URIs, app roles, backend scope | Entra ID supported as-is; other IdPs require code changes |
| **OCLC** | Function App application settings | Server env vars (`OCLC_WSKEY`, `OCLC_SECRET`) |
