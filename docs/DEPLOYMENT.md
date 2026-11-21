# Deployment guide

Everything here works from a browser. Nothing needs to be installed on your PC.

## 0. What runs where

| Piece | Folder | Where it runs |
|---|---|---|
| Ramp logic simulation (API) | `gateway/` | **Vercel** or **Cloudflare Workers** |
| Automated tests | `.github/workflows/` | **GitHub Actions** (free cloud runners) |
| Hub chain (Go) | repo root | GitHub Actions for build/boot tests now; a VPS or validator servers later |

Vercel and Workers cannot run the chain: they run short request handlers, and a blockchain node is a
long-running process with disk storage.

## 1. Put the repo on GitHub

Use the repo you already made: `Kellylemayianit/nexura-core` (keep it **Private**).

1. Unzip `nexura-core-monorepo.zip`. You get one folder, `nexura-core/`.
2. Open the folder. **Show hidden files** first (Linux Mint file manager: press `Ctrl+H`), otherwise the
   `.github` and `.gitignore` entries are invisible and won't upload.
3. On your repo page: **Add file -> Upload files**. Drag in everything inside the folder
   (`.github`, `docs`, `gateway`, `proto`, `scripts`, `x`, `.gitignore`, `README.md`).
   If the browser limits one upload to about 100 files, upload in two batches (e.g. `gateway` first).
4. Commit directly to `main`.
5. If an old copy of the earlier kit files exists, the new upload overwrites same-named files.
   Delete leftovers you no longer need from the GitHub UI.

**If `.github` won't upload:** use **Add file -> Create new file**, type `.github/workflows/ci.yml` as the
filename (typing `/` makes folders), paste the contents of that file, commit. Repeat for `chain-smoke.yml`.

## 2. Check the automatic tests

Repo page -> **Actions** tab. After your commit, `ci` runs two jobs:

- **gateway-tests:** should go green. If red, open it and send me the log.
- **ramp-state-machine-go:** the first time the Go code is ever compiled. If red, it's usually a small
  syntax slip; open the job, copy the error text to me and I'll fix it.

The yellow dot means running, green tick passed, red cross failed.

## 3. Deploy the gateway

Both hosts must be told the app lives in the `gateway` folder (**Root Directory = `gateway`**).
Pick one first; you can do both later.

### Option A: Vercel
1. vercel.com -> **Add New -> Project** -> import `nexura-core` from GitHub (grant access to that repo).
2. **Root Directory:** click Edit, choose `gateway`.
3. **Framework Preset:** Other. Leave build and output settings empty.
4. **Environment Variables:** add `API_KEY` with a long random value (e.g. 32+ random characters). Save it somewhere safe.
5. **Deploy.** `gateway/vercel.json` sends every path to `api/index.js`.

### Option B: Cloudflare Workers
1. dash.cloudflare.com -> **Workers & Pages -> Create -> Import a repository** -> `nexura-core`.
2. In the build settings set **Root directory** to `gateway`. It reads `wrangler.jsonc` (entry `src/worker.js`).
   Accept the default deploy command.
3. After the first deploy: Worker -> **Settings -> Variables and Secrets** -> add secret `API_KEY`. Redeploy.

(Dashboard labels change over time; if a field has moved, look for "root directory" in build settings.)

## 4. Verify the deployment

Replace `HOST` and `KEY`:

| URL | Expect |
|---|---|
| `https://HOST/` | JSON with the endpoint list |
| `https://HOST/v1/selftest?key=KEY` | `"failed": 0` and `"total": 13` |
| `https://HOST/v1/simulate/offramp_ambiguous_then_paid?key=KEY` | step trace ending in `SETTLED`, with one rejected step |
| `https://HOST/v1/fsm?key=KEY` | table of allowed transitions |
| `https://HOST/v1/selftest` (no key) | `401 UNAUTHORIZED` |

For anything other than quick browser checks, send the key as a header instead of `?key=`:
`curl -H "x-api-key: KEY" https://HOST/v1/selftest`

## 5. Boot the chain in the cloud (no editor, no downloads)

Repo -> **Actions -> chain-smoke -> Run workflow**.

It installs Go and Ignite on GitHub's machines, scaffolds the Hub chain around your files, builds it,
starts one node and prints the latest block height. A block height above 0 means a chain is producing blocks.
Download the `chain-log` artifact from the run page to read the full log.

This workflow is experimental (written without being able to run Ignite). If it fails, send me the log of the
failing step. Expect one or two rounds of fixes; that's normal for a first scaffold.

## 6. Secrets: the rules
- Never commit keys, tokens, `.env`, `.dev.vars` (the `.gitignore` already blocks them).
- App secrets live in Vercel or Cloudflare settings. CI secrets live in repo Settings -> Secrets and variables -> Actions.
- If a secret is ever committed, treat it as leaked: rotate it, don't just delete the file.
- Keep the repo Private.

## 7. Before pointing Safaricom Daraja at it
The callback route `/v1/callbacks/daraja/stk` is open (Daraja can't send custom headers) and only logs.
Before real callbacks: add a secret path token (e.g. `/v1/callbacks/daraja/stk/<random>`), verify and
de-duplicate every callback, confirm with a transaction-status query, and only then pass to the engine.
Never credit anything from the callback body alone.

## 8. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Vercel build says no entrypoint | Root Directory isn't `gateway`. |
| Every URL returns 404 on Vercel | `vercel.json` missing from `gateway/`, or Root Directory wrong. |
| 401 on every call | Missing or wrong key. Use `?key=` or the `x-api-key` header. |
| Stateful endpoints forget intents | Serverless instances restart; use `/v1/simulate/*` and `/v1/selftest` for reliable checks. |
| `.github` folder missing after upload | Hidden folder wasn't selected; use the Create new file route in step 1. |
| `ramp-state-machine-go` red | Open the job, send me the first compile error. |
| `chain-smoke` red at "Scaffold" | Ignite flags differ by version; send the error and I'll adjust `scripts/01-scaffold.sh`. |

## 9. What's next
1. Get `ci` green and `selftest` returning `failed: 0` on your deployed URL.
2. Get a block height from `chain-smoke`.
3. Build `x/fiatoracle` (see `docs/BUILD.md`, Phase 3), tested through Actions.
4. Build the Daraja sandbox adapter in TypeScript.
