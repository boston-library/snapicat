# Server app (Azure Functions OCLC) — Local Development

This doc covers the **Azure Functions** server in this monorepo. The app lives in **`apps/server`**. Run all commands below from **`apps/server`** (e.g. `cd apps/server` from the repo root).

---

## 1. Environment variables

The server uses **two possible sources** depending on how you run it. Use env in **`apps/server`** only; a root `.env` can cause path and tooling issues.

### Azure Functions (`func start`)

Azure Functions loads variables from **`apps/server/local.settings.json`**, not from `.env`. Copy the example and fill in your values:

```bash
cp apps/server/local.settings.json.example apps/server/local.settings.json
```

Then edit `local.settings.json` and put all secrets and config in the `Values` section:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "OCLC_WSKEY": "your-oclc-wskey",
    "OCLC_SECRET": "your-oclc-secret",
    "AZURE_TENANT_ID": "your-azure-tenant-id",
    "AZURE_CLIENT_ID": "your-azure-client-id"
  }
}
```

Do not commit `local.settings.json`; it is gitignored.

### Standalone FastAPI (`python app.py`)

The standalone server loads **`apps/server/.env`** (via `python-dotenv` in `app.py`). Copy the example and fill in values:

```bash
cp apps/server/.env.example apps/server/.env
```

Then edit `apps/server/.env`. Variables match the table in `.env.example`: `OCLC_WSKEY`, `OCLC_SECRET`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and optionally `CORS_ORIGINS`, `AUTO_RELOAD`, `HOST`, `PORT`. Do not commit `.env`; it is gitignored.

---

## 2. Python Version and grpcio Issues

- **Use Python 3.11** (or 3.10). Do **not** use Python 3.13 or newer.
- Many packages (especially `grpcio` and `grpcio-tools` are required by Azure Functions) do **not** yet support Python 3.13+.
- If you see errors like `Failed building wheel for grpcio` or `No module named 'grpc'`, you are likely using an unsupported Python version.

### How to Set Up Python 3.11

1. Install Python 3.11:
   ```sh
   brew install python@3.11
   ```
2. From the repo root, create and activate a virtual environment in **`apps/server`**:
   ```sh
   cd apps/server
   python3.11 -m venv venv
   source venv/bin/activate
   ```
3. Upgrade pip and install requirements:
   ```sh
   pip install --upgrade pip setuptools wheel
   pip install --force-reinstall --no-cache-dir -r requirements.txt
   ```

---

## 3. Azure Functions Core Tools

- Install Azure Functions Core Tools (if not already):
  ```sh
  npm install -g azure-functions-core-tools@4 --unsafe-perm true
  ```
- Start the function host from **`apps/server`** (where `host.json` and your functions live):
  ```sh
  cd apps/server
  func start --port 8080
  ```
- By default, your functions will be available at `http://localhost:8080/api/<function_name>`

---

## 4. Common Issues and Solutions

### a. grpcio Build Errors
- If you see errors about `grpcio` or `grpcio-tools` failing to build, make sure you are using Python 3.11 or 3.10.
- Try installing with `--force-reinstall --no-cache-dir`.
- Make sure you have Xcode command line tools installed:
  ```sh
  xcode-select --install
  ```

### b. Module Not Found Errors
- If you see `ModuleNotFoundError: No module named 'pydantic_core'`, make sure you:
  - Activated your virtual environment (`source venv/bin/activate`)
  - Installed all requirements (`pip install -r requirements.txt`)

### c. Indentation Errors
- Python is strict about indentation. If you see `IndentationError`, open the file and fix the indentation (use 4 spaces per level).

---

## 5. Testing Your Functions

- Use `curl`, Postman, or any HTTP client to test your endpoints. Example:

```sh
curl -X POST "http://localhost:8080/api/search_books" \
  -H "Content-Type: application/json" \
  -d '{
    "appendSearchQuery": "ti:{}",
    "sortingOrder": "bestMatch",
    "isRefining": true,
    "books": [
      {
        "rowId": 25,
        "ti": "Catalogo general de sellos",
        "au": "Guerra",
        "pl": "Habana",
        "pb": "filatelica",
        "yr": 1969,
        "search_query": "ti:Catalogo general de sellos"
      }
    ]
  }'
```

- The example given above is not using any API CODE via `code` query parameter in this curl command as here localhost was utilized, but if you try to hit a staging/production Azure Functions API then you might need to utilize the query parameter based on your configurations

---

## 6. Summary Table

| Task                        | Command/Action                                      |
|-----------------------------|-----------------------------------------------------|
| Working directory           | `apps/server` (from repo root)                      |
| Activate venv               | `source venv/bin/activate` (inside `apps/server`)   |
| Install requirements        | `pip install -r requirements.txt`                   |
| Start function host         | `func start --port 8080`                            |
| Test endpoint               | `curl ...`                                          |
| Set env variables           | `apps/server/local.settings.json` (not `.env`)      |
| Use Python version          | 3.11 (or 3.10)                                      |

---

## 7. Core logic and architecture

This section describes how the server is built so you can make targeted edits (auth, OCLC integration, APIs).

### 7.0 Folder structure

```
apps/server/
├── src/
│   ├── search_books/
│   │   ├── dto_class.py      # SearchRequestDTO (optional; used by handler)
│   │   └── handler.py
│   ├── generate_xml/
│   │   └── handler.py
│   └── shared/               # Used by handlers (auth, OCLC token, service, constants)
│       ├── auth_token_validation.py
│       ├── constants.py
│       ├── oclc_service.py
│       └── oclc_token_manager.py
├── function_app.py           # Azure Functions v2 entry (must be this filename)
├── app.py                    # Standalone FastAPI server (wraps same handlers)
├── host.json
├── local.settings.json       # (not committed)
└── requirements.txt
```

- **Azure Functions** (`func start`): the host discovers functions from **`function_app.py`** (v2 model). That file registers both HTTP routes and delegates to `src/search_books/handler.py` and `src/generate_xml/handler.py`. The filename must be **`function_app.py`** — the runtime does not support a different name (e.g. `functions.py`).
- **Standalone** (`python app.py`): `app.py` calls `src.search_books.handler.main` and `src.generate_xml.handler.main` directly via a mock `HttpRequest`, so the same `src` handlers run.

### 7.1 Overview

The server exposes two HTTP APIs used by the client:

- **`POST /api/search_books`** — Accepts a list of “books” (criteria objects with fields like ti, au, etc.), builds OCLC search queries, calls the Worldcat Metadata API, and returns brief-bib results (e.g. OCLC number, title, creator) plus remaining API quota.
- **`POST /api/generate_xml`** — Accepts a list of OCLC numbers and a format (`marcxml` or `marc`), fetches each record from OCLC, and returns a single combined MARCXML or MARC file as a download.

Both endpoints **validate the request** using an **Azure AD JWT** (Bearer token). If the token is missing or invalid, the server returns 401. All OCLC calls use a **shared OCLC OAuth token** obtained and cached by `OCLCTokenManager`.

The same logic runs as **Azure Functions** (when using `func start` and `function_app.py`) or as a **FastAPI** app (when using `app.py`), which mounts the same handlers at `/api/search_books` and `/api/generate_xml`.

Application logic lives under **`apps/server/src/`** (handlers and shared code). The root has host/config (`host.json`, `local.settings.json`, `requirements.txt`, `.funcignore`), env examples, the Azure Functions v2 entry (**`function_app.py`**), and the standalone FastAPI app (`app.py`) that calls the same `src` handlers.

### 7.2 Auth: Azure AD JWT validation (`src/shared/auth_token_validation.py`)

- **`validate_token(req)`** reads the `Authorization: Bearer <token>` header and validates the JWT.
- It fetches **JWKS** (public keys) from Azure AD using `AZURE_TENANT_ID` and caches them (`get_jwks()`).
- The token is verified with **PyJWT** for signature, audience (`AZURE_CLIENT_ID`), issuer, and expiry. If valid, it returns the decoded payload; otherwise `None` (and the function returns 401).
- Used by both `search_books` and `generate_xml` before any business logic.

### 7.3 OCLC token manager (`src/shared/oclc_token_manager.py`)

- **`OCLCTokenManager`** is responsible for **OCLC API access tokens** (not Azure AD). It uses `OCLC_WSKEY` and `OCLC_SECRET` from the environment.
- **`get_shared_token()`** returns a valid access token: if the current cached token is still valid (expiry checked with a 5‑minute buffer), it returns that; otherwise it requests a new one via OAuth2 **client_credentials** at `https://oauth.oclc.org/token` with scope `WorldCatMetadataAPI:view_brief_bib WorldCatMetadataAPI:manage_bibs`.
- **`can_make_request()`** returns whether the cached token is valid (used by callers to decide if a request is allowed).
- Retries: up to 3 attempts with backoff when the token request fails. This keeps a **single shared token** for all OCLC requests in the process.

### 7.4 OCLC service (`src/shared/oclc_service.py`)

- **`OCLCService`** takes an `OCLCTokenManager` and performs the actual OCLC API calls.
- **Search flow:**  
  - **`batch_search(criteria_list, append_query, sorting_order, isRefining)`** splits the list into batches (size from `src/shared/constants.BATCH_SIZE`, e.g. 100), and for each batch runs **`_search_single_record`** per item (with bounded concurrency). It returns a list of results and the latest **API usage remaining** (from response header `x-ratelimit-remaining-day`).  
  - **`_search_single_record`** builds the query via **`_build_search_query`** (using criteria + optional `append_query` with placeholders like `ti:{}`), calls `GET .../search/brief-bibs?q=...&orderBy=...` with the Bearer token from the token manager, and parses the response with **`_parse_search_response`**. On 401 it retries (token refresh is handled by the caller/token manager). On 429 (rate limit) it returns a special status so the caller can stop.  
  - **Query building:** Criteria keys map to OCLC index prefixes (e.g. title → `ti`, author → `au`); `append_query` can contain literal field:value pairs or templates. Restricted first-index rules (e.g. `kw:book` first for certain fields) are applied.  
  - **Response parsing:** The first brief record is mapped back to a flat structure with original criteria fields plus “retrieved” fields (e.g. `ti_new`, `oclc_number`), and optional `error` for no-results or API errors.
- **XML flow:**  
  - **`generate_xml(oclc_numbers, format_type)`** fetches each OCLC number from `GET .../manage/bibs/{oclc_number}` with `Accept: application/marcxml+xml` or `application/marc`, then **`_combine_xml`** concatenates the records into one MARCXML collection or MARC file and returns the string.

### 7.5 Constants (`src/shared/constants.py`)

- **OCLC:** `OCLC_API_BASE_URL`, `OCLC_OAUTH_URL`, `OCLC_OAUTH_SCOPE`.
- **Azure AD:** `AZURE_AD_ISSUER_BASE`, `AZURE_AD_DISCOVERY_PATH` (for JWKS).
- **Search:** `BATCH_SIZE` (e.g. 100), `SEARCH_FIELD_MAPPING` (human field names to OCLC index codes), `DEFAULT_HEADERS`, `ERROR_MESSAGES`.

### 7.6 Function entry points

- **`function_app.py`** (root) — Azure Functions v2 entry: registers two HTTP functions (`search_books`, `generate_xml`) and delegates to **`src/search_books/handler.py`** and **`src/generate_xml/handler.py`**. The handlers validate token, parse body (SearchRequestDTO / GenerateXmlRequestDTO), use `OCLCTokenManager` and `OCLCService`, and return JSON or XML as appropriate.

### 7.7 Where to make edits

| Area | Main files |
|------|------------|
| Azure AD JWT validation | `src/shared/auth_token_validation.py` |
| OCLC OAuth token (caching, refresh) | `src/shared/oclc_token_manager.py` |
| OCLC search + XML generation, query building, response parsing | `src/shared/oclc_service.py` |
| URLs, batch size, field mappings, errors | `src/shared/constants.py` |
| Search API request/response shape | `src/search_books/dto_class.py`, `src/search_books/handler.py` |
| Generate XML API request/response | `src/generate_xml/handler.py` |
| Standalone FastAPI app, CORS, routing | Root `app.py` |

---

## 📋 Alternative: Run as Standalone Web Server

A **standalone** entrypoint (e.g. `app.py`) exists in `apps/server`, you can run the same APIs as a standalone web server instead of Azure Functions:

### 1. Run as Standalone Server
```bash
cd apps/server
source venv/bin/activate   # or create venv first (see section 2)

# Install dependencies (includes FastAPI)
pip install -r requirements.txt

# Set environment variables
# Option 1: Export in shell
export OCLC_WSKEY="your-oclc-wskey"
export OCLC_SECRET="your-oclc-secret"
export AZURE_CLIENT_ID="your-azure-client-id"
export AZURE_TENANT_ID="your-azure-tenant-id"
export CORS_ORIGINS="https://your-frontend.com,https://staging.your-app.com,http://localhost:5174"
export HOST="your_host"
export PORT="your_port"
export AUTO_RELOAD="true"

# By default host is set to 0.0.0.0, port is set to 8080 and cors allows all origins if their env variables are not defined
# By default AUTO_RELOAD is set as true for development purposes, set it to "false" for production server
# By default CORS is set to `*`, i.e. if no value added in CORS_ORIGINS for env, then it will allow all origins

# Option 2: Create a .env file in apps/server (recommended)
# The standalone server automatically loads .env files
echo 'OCLC_WSKEY="your-oclc-wskey"' > .env
echo 'OCLC_SECRET="your-oclc-secret"' >> .env
echo 'AZURE_CLIENT_ID="your-azure-client-id"' >> .env
echo 'AZURE_TENANT_ID="your-azure-tenant-id"' >> .env
echo 'CORS_ORIGINS="https://your-frontend.com,https://staging.your-app.com,http://localhost:5174"' >> .env
echo 'HOST="your_host"' >> .env
echo 'PORT="your_port"' >> .env
echo 'AUTO_RELOAD="true"' >> .env

# Run the server (app lives in root app.py)
python app.py

# Or for production:
uvicorn app:app --host 0.0.0.0 --port 8080 --workers 4
```

### 2. Test the APIs
```bash
# Health check
curl http://localhost:8080/health

# Search books (same API as Azure Functions)
curl -X POST http://localhost:8080/api/search_books \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"books": [{"ti:": "The Great Gatsby"}], "sortingOrder": "bestMatch"}'
```

The standalone server uses the **exact same** Azure Functions code - it just wraps them in a FastAPI server. Same logic, same APIs, same Azure AD JWT authentication.

---

## 8. References

- [Client app (apps/client)](./client.md) — run the frontend locally
- [Azure Functions Python Troubleshooting](https://aka.ms/functions-modulenotfound)
- [Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local)
