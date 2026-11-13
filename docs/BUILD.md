# Nexura Hub: systematic build plan

Companion to **Nexura L0 Specification v0.1**. Each phase has a goal, the work, and an acceptance test. Do not start a phase until the previous one passes.

**Status of this kit:** written in a sandbox with no Go toolchain and no network, so nothing here has been compiled. The proto files and `x/ramp/types/fsm.go` are written to be dropped in; expect to fix small version-specific details (proto imports, Go version) when you first build.

## Layout in this kit

```
scripts/00-setup.sh        toolchain install (Go, Ignite, buf)
scripts/01-scaffold.sh     scaffold chain + 5 modules with Ignite
scripts/02-localnet.sh     single-node testnet
proto/nexura/...           contracts for ramp, fiatoracle, zoneregistry
x/ramp/types/fsm.go        deterministic intent state machine (pure Go)
x/ramp/types/fsm_test.go   tests for the state machine
```

## Phase 0: toolchain
Run `scripts/00-setup.sh`. **Accept:** `go version`, `ignite version`, `buf --version` all print.
Confirm the Go version required by the Cosmos SDK release Ignite selects, and pin it in `GO_VERSION`.

## Phase 1: boot a chain
Run `scripts/01-scaffold.sh`, then `scripts/02-localnet.sh`.
**Accept:** blocks are produced, and `nexurad status` works. Commit this as the baseline (`v0.0.1`).

## Phase 2: contracts and the state machine
1. Copy `proto/nexura/*` over the scaffolded proto files for `ramp`, `fiatoracle`, `zoneregistry` (keep the scaffolded `module`/`genesis` protos if Ignite names differ, but keep the messages here).
2. Regenerate with `ignite generate proto-go` and fix import paths if the SDK version needs `amino/amino.proto` or `cosmos_proto/cosmos.proto` annotations.
3. Copy `x/ramp/types/fsm.go` and `fsm_test.go` into the scaffolded `x/ramp/types/`.
**Accept:** `go test ./x/ramp/types/...` passes. To test the state machine alone, before the chain compiles: `cd x/ramp/types && go test fsm.go fsm_test.go`.

## Phase 3: `x/fiatoracle`
Implement: attestor and provider registries, `MsgAttestLeg` with one-attestation-per-(intent, leg, attestor), weighted threshold check, reserve records, coverage-ratio mint cap, jailing.
**Design refinement vs. spec section 5.4.1:** `MsgAttestLeg` lives in `x/fiatoracle`, which owns attestors. When the threshold is reached it calls a hook on the `x/ramp` keeper (`OnLegAttested(ctx, intentID, outcome, amount)`). This avoids a circular dependency and keeps verification separate from action.
**Accept:** unit tests: duplicate attestation rejected; threshold reached only with enough weight; conflicting attestations flagged as equivocation; stale reserve gives mint cap zero.

## Phase 4: `x/ramp`
Implement `MsgCreateIntent` (lock escrow for off-ramps at creation), the keeper hook from Phase 3, and apply transitions only through `Next()`; perform ledger actions only as dictated by `EffectFor()`. Add an EndBlocker that expires intents, limited by `max_expiries_per_block`. Emit events (`ramp_intent_created`, `ramp_leg_attested`, `ramp_settled`).
**Accept:** end-to-end test with two simulated attestors: on-ramp mints only after the threshold, off-ramp burns only after payout attestation, a failed payout refunds escrow, an ambiguous payout stays held, minting stops when `minting_paused` is set or the cap is exhausted.

## Phase 5: `x/zoneregistry`
Implement apply, verify, status change; gate ramp and (later) pool access by tier, risk class and allowed providers.
**Accept:** an unverified Zone cannot create an intent; limits are enforced per corridor.

## Phase 6: middleware in `app/`
Wire IBC transfer, IBC hooks, packet-forward and rate limiting. **Verify** current module versions first.
**Accept:** two local chains exchange ICS-20 transfers, and a channel hits its rate limit.

## Phase 7: engine mock (separate repo `nexura-engine`)
Float Gateway OpenAPI spec, a mock provider (delays, duplicates, failures, ambiguous results), chain watcher, saga engine, and two attestor signers.
**Accept:** the full ramp loop runs against the local chain with no real money.

## Phase 8: `x/nexuratex` and `x/identitymap`
One constant-product pool first (partner unit against a verified Zone coin), then weighted and stable curves. Identity privacy design (spec section 5.6) must be settled before building `identitymap`.

## Phase 9: first real provider
Needs the provider list and first country from you. Sandbox first, then live with low limits.

## Cross-cutting rules (apply in every phase)
- No floats, no wall-clock time (use block time), no PII, no outbound calls from the chain.
- Every state change goes through the state machine and the keeper, never directly.
- Every privileged message is governance-only or timelocked.
- Every phase ends with tests that cover the failure paths, not only the happy path.

## Inputs I need from you
1. Provider list and the first country.
2. Whether `cKES` is one denom for all providers or one per provider (spec section 19, item 4).
3. Token name and genesis plan (spec section 14.1).
