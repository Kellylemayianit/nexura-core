# gateway

Zero-dependency HTTP simulation of the Nexura ramp logic. No real money, no real chain.
`src/fsm.js` mirrors `x/ramp/types/fsm.go` at the repo root.

Deploy and verify: see `../docs/DEPLOYMENT.md` (set Root Directory to `gateway`).

Try first: `GET /v1/selftest`, `GET /v1/scenarios`, `GET /v1/simulate/onramp_happy`, `GET /v1/fsm`.
Set `API_KEY` in the host's environment; send it as `x-api-key` (or `?key=` for quick browser checks).

State is in memory and can reset on serverless hosts; `/v1/simulate/*` and `/v1/selftest` are stateless.
Tests (Node 20+): `npm test`.
