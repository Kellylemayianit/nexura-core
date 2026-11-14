import test from 'node:test';
import assert from 'node:assert/strict';
import { next, isTerminal, effectFor, Effect, FsmError } from '../src/fsm.js';
import { createStore, createIntent, act, attest, faucet, ledger } from '../src/engine.js';
import { selfTest, runScenario } from '../src/simulate.js';

test('every scripted scenario passes', () => {
  const r = selfTest();
  const bad = r.results.filter((x) => !x.passed);
  assert.equal(bad.length, 0, JSON.stringify(bad));
});

test('no expire or cancel while off-ramp money is in flight', () => {
  for (const s of ['PAYOUT_PENDING', 'AMBIGUOUS', 'ATTESTED_PAID']) {
    for (const e of ['EXPIRE', 'CANCEL']) assert.throws(() => next('off_ramp', s, e), FsmError);
  }
  assert.throws(() => next('on_ramp', 'ATTESTED', 'EXPIRE'), FsmError);
});

test('ambiguous can only be resolved, never burned or refunded directly', () => {
  for (const e of ['BURNED', 'REFUNDED', 'PAYOUT_CONFIRMED', 'PAYOUT_FAILED']) {
    assert.throws(() => next('off_ramp', 'AMBIGUOUS', e), FsmError);
  }
});

test('kinds do not cross', () => {
  assert.throws(() => next('off_ramp', 'CREATED', 'REQUEST_FUNDS'), FsmError);
  assert.throws(() => next('on_ramp', 'CREATED', 'START_PAYOUT'), FsmError);
});

test('terminal states', () => {
  for (const s of ['EXPIRED', 'REVERSED', 'REFUNDED']) assert.ok(isTerminal('on_ramp', s));
  assert.ok(!isTerminal('on_ramp', 'SETTLED'));
  assert.ok(isTerminal('off_ramp', 'SETTLED'));
});

test('effects match the Go table', () => {
  assert.equal(effectFor('on_ramp', 'MINTED'), Effect.MINT);
  assert.equal(effectFor('off_ramp', 'BURNED'), Effect.BURN);
  assert.equal(effectFor('off_ramp', 'CANCEL'), Effect.RELEASE_ESCROW);
  assert.equal(effectFor('on_ramp', 'REFUNDED'), Effect.NONE);
  assert.equal(effectFor('on_ramp', 'FIAT_CONFIRMED'), Effect.NONE);
});

test('one attestor alone never mints', () => {
  const s = createStore();
  const i = createIntent(s, { kind: 'on_ramp', owner: 'x', amount: 100 });
  act(s, i.id, 'start');
  const r = attest(s, i.id, { attestor: 'A', outcome: 'confirmed', amount: 100 });
  assert.equal(r.thresholdReached, false);
  assert.equal(ledger(s).supply, 0);
});

test('disagreeing attestors dispute instead of minting', () => {
  const s = createStore();
  const i = createIntent(s, { kind: 'on_ramp', owner: 'x', amount: 100 });
  act(s, i.id, 'start');
  attest(s, i.id, { attestor: 'A', outcome: 'confirmed', amount: 100 });
  const r = attest(s, i.id, { attestor: 'B', outcome: 'confirmed', amount: 60 });
  assert.equal(r.disputed, true);
  assert.equal(ledger(s).supply, 0);
});

test('paused minting blocks mint but keeps the attested state', () => {
  const s = createStore({ mintingPaused: true });
  const i = createIntent(s, { kind: 'on_ramp', owner: 'x', amount: 100 });
  act(s, i.id, 'start');
  attest(s, i.id, { attestor: 'A', outcome: 'confirmed', amount: 100 });
  const r = attest(s, i.id, { attestor: 'B', outcome: 'confirmed', amount: 100 });
  assert.equal(r.intent.state, 'ATTESTED');
  assert.ok(r.mintBlocked);
});

test('ledger invariant holds across a mixed sequence', () => {
  const s = createStore();
  faucet(s, 'a', 5000);
  const o = createIntent(s, { kind: 'off_ramp', owner: 'a', amount: 1500 });
  assert.equal(ledger(s).invariantOk, true);
  act(s, o.id, 'start');
  attest(s, o.id, { attestor: 'A', outcome: 'confirmed', amount: 1500 });
  attest(s, o.id, { attestor: 'B', outcome: 'confirmed', amount: 1500 });
  assert.equal(ledger(s).invariantOk, true);
  assert.equal(runScenario('onramp_happy').ledger.invariantOk, true);
});
