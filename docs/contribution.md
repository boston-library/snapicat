# Contributing

Thanks for considering contributing to Snapicat. This document covers branch naming, commit messages, pull requests, and code style (Biome) so contributions stay consistent and easy to review.

---

## 1. Branch naming

Create a branch from **`develop`** (or from `main` for hotfixes, see below) using one of these prefixes:

| Prefix      | Use for |
|------------|---------|
| `feat/`    | New features (e.g. `feat/export-csv`, `feat/advanced-filters`) |
| `enhance/` | Improvements to existing behavior or UX (e.g. `enhance/table-pagination`, `enhance/error-messages`) |
| `fix/`     | Bug fixes (e.g. `fix/search-timeout`, `fix/login-redirect`) |
| `hotfix/`  | Urgent fixes for production (e.g. `hotfix/auth-crash`, `hotfix/api-500`) |
| `refactor/`| Code refactors without changing behavior (e.g. `refactor/auth-context`, `refactor/api-layer`) |
| `chore/`   | Tooling, config, deps, docs (e.g. `chore/deps-update`, `chore/readme-typos`) |

**Examples**

- `feat/custom-column-order`
- `enhance/processed-page-loading`
- `fix/oclc-rate-limit-handling`
- `hotfix/missing-env-check`
- `refactor/use-search-books`
- `chore/biome-ignore-dist`

Use kebab-case after the prefix. For hotfixes that must go straight to production, branch from `main`, then merge back into `develop` after.

---

## 2. Commit messages

Follow **Conventional Commits** style. Start the subject line with a prefix that matches your branch type (and keep the subject in imperative, lowercase after the prefix).

| Prefix     | Use for |
|------------|---------|
| `feat:`    | New feature |
| `enhance:` | Enhancement or improvement |
| `fix:`     | Bug fix |
| `hotfix:`  | Urgent production fix |
| `refactor:`| Refactor (no behavior change) |
| `chore:`   | Maintenance (deps, config, scripts) |
| `docs:`    | Documentation only |
| `style:`   | Formatting, whitespace (no logic change) |
| `test:`    | Adding or updating tests |
| `perf:`    | Performance improvement |
| `build:`   | Build system or CI changes |
| `ci:`      | CI configuration only |

**Format**

```
<prefix>: <short subject in imperative, ~50 chars>

Optional body and/or bullet list.
Optional: Fixes #123.
```

**Examples**

- `feat: add export to CSV on processed page`
- `enhance: show batch progress in search UI`
- `fix: prevent double submit on process button`
- `hotfix: guard against missing OCLC response`
- `refactor: extract search config into shared module`
- `chore: bump axios to 1.13.2`
- `docs: update deployment env vars table`
- `style: apply Biome format to authContext`

Keep the subject line concise; add a body when you need to explain *why* or list multiple changes. Reference issues when applicable (e.g. `Fixes #45`, `Relates to PROJ-123`).

---

## 3. Pull requests

### 3.1 Target branch

- **Normal work:** Open the PR against **`develop`**.
- **Hotfix for production:** Open the PR against **`main`**, then merge `main` back into `develop` so both stay in sync.

### 3.2 Title

Use a clear, descriptive title that reflects the change. Prefer the same prefix as your branch/commits when it helps:

- `feat: Add CSV export on Processed page`
- `fix: Search timeout when batch size is large`
- `Enhance table column resize behavior`

### 3.3 Description

In the PR description include:

- **What** changed (and which app: client vs server if not obvious).
- **Why** (problem, user need, or goal).
- **How** to verify (short steps or link to QA notes).
- **Screenshots or logs** when they clarify behavior (e.g. UI change, new error handling).

For **bug fixes**, also add:

- A short summary of the bug.
- A **link** to the issue (GitHub issue, Jira ticket, or similar), e.g.  
  `Fixes #42` or `Bug: [PROJ-123](https://jira.example.com/browse/PROJ-123)`.

Templates (e.g. GitHub PR template) can ask for “Issue/ticket link” and “Steps to test”; use them if the repo has one.

### 3.4 Checks before submitting

- Branch is up to date with the target branch (rebase or merge as agreed).
- **Client code:** Lint and format pass (see [§4 Biome](#4-biome-setup-client)).
- No unrelated changes (only commits that belong to the PR).
- Self-review (and, if applicable, a quick run of the app) done.

---

## 4. Biome setup (client)

The **client** (`apps/client`) uses [Biome](https://biomejs.dev/) for linting and formatting. All client contributions must follow the project’s Biome config so CI and local checks stay green.

### 4.1 Commands (from repo root or `apps/client`)

From **`apps/client`**:

| Command        | Description |
|----------------|-------------|
| `yarn lint`    | Run Biome linter and apply safe fixes (`biome lint --write .`) |
| `yarn format`  | Format code (`biome format --write .`) |
| `yarn check`   | Lint + format + organize imports with unsafe fixes (`biome check --write --unsafe .`) |
| `yarn ci`      | CI mode: lint and format **without** writing (fails if something would change) |

Run these before committing and before opening a PR. CI uses `yarn ci` in `apps/client`; if that fails, the PR will not pass checks.

### 4.2 When to run what

- **Before every commit (client):** Run `yarn format` and `yarn lint` (or `yarn check` once) in `apps/client`.
- **Before opening a PR:** Run `yarn ci` in `apps/client` to ensure there are no lint/format issues.

Config lives in **`apps/client/biome.json`** (formatter, linter rules, VCS default branch `develop`). Do not change the shared rules in that file without discussion in an issue or PR.

---

## 5. Summary

| Item | Rule |
|------|------|
| Branch from | `develop` (or `main` for hotfixes) |
| Branch names | `feat/`, `enhance/`, `fix/`, `hotfix/`, `refactor/`, `chore/` + kebab-case |
| Commits | Conventional prefix (`feat:`, `fix:`, etc.), imperative subject, optional body and issue ref |
| PR target | `develop` (or `main` for hotfixes) |
| PR content | Clear title, description (what/why/how to verify), and for bugs: link to issue/ticket |
| Client code | Use Biome: `yarn lint`, `yarn format`, and `yarn ci` in `apps/client` before pushing |

If something here is unclear or you want to extend the conventions (e.g. new branch prefix), open an issue or suggest it in a PR so we can align with the rest of the project.
