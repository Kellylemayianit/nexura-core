# nexura-core

Sovereign economic engine for African commerce: a Cosmos SDK hub chain (the L0), the ramp logic that
connects it to local money rails, and a testable HTTP simulation of that logic.

```
nexura-core/
├── gateway/            JavaScript. HTTP simulation of the ramp rules. Deploys to Vercel or Cloudflare Workers.
├── proto/nexura/       Protobuf contracts for x/ramp, x/fiatoracle, x/zoneregistry
├── x/ramp/types/       Go. Ramp intent state machine + tests (pure Go, no downloads needed to test)
├── scripts/            Toolchain setup, chain scaffold, local node, FSM test
├── docs/
│   ├── DEPLOYMENT.md   START HERE: deploy guide (GitHub, CI, Vercel / Cloudflare, cloud chain run)
│   └── BUILD.md        Phase-by-phase build plan for the Hub chain
└── .github/workflows/  ci.yml (every push) and chain-smoke.yml (manual cloud chain boot)
```

## Honest status

| Part | State |
|---|---|
| `gateway/` | Built and tested (19 tests). Not yet deployed by me: your first deploy is the real test. |
| `x/ramp/types/fsm.go` | Written, **not compiled** (no Go toolchain where it was written). CI will run it for you. |
| `proto/` | Written, **not compiled**. Expect small import fixes once wired into the scaffolded chain. |
| Hub chain (app, modules) | **Not scaffolded yet.** Run `chain-smoke` in GitHub Actions, or `scripts/01-scaffold.sh` on a machine with Go. |
| Real provider adapters (Daraja etc.) | Not built. The gateway has only a receive-and-dedupe callback stub. |

Read **docs/DEPLOYMENT.md** next.
