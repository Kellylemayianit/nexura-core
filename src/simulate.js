// Scripted scenarios. Each one runs on a FRESH store, so it is stateless and safe to call on
// serverless hosts. Every step is recorded, including the ones that are SUPPOSED to be rejected.

import { createStore, createIntent, act, attest, setParams, faucet, getIntent, ledger, EngineError } from './engine.js';
import { FsmError } from './fsm.js';

function summ(r) {
  if (!r) return {};
  const i = r.intent ?? r;
  const o = {};
  if (i.state) o.state = i.state;
  if ('thresholdReached' in r) o.thresholdReached = r.thresholdReached;
  if (r.mintBlocked) o.mintBlocked = r.mintBlocked;
  if (r.disputed) o.disputed = true;
  return o;
}

function makeCtx() {
  const s = createStore();
  const trace = [];
  const t = (label, fn) => {
    try {
      const r = fn();
      trace.push({ step: label, ok: true, ...summ(r) });
      return r;
    } catch (e) {
      if (e instanceof EngineError || e instanceof FsmError) {
        trace.push({ step: label, ok: false, rejected: true, error: { code: e.code, message: e.message } });
        return null;
      }
      throw e;
    }
  };
  return { s, trace, t };
}

const both = (c, id, outcome, amount, note = '') => {
  c.t(`attestor A: ${outcome} ${amount}${note}`, () => attest(c.s, id, { attestor: 'A', outcome, amount }));
  c.t(`attestor B: ${outcome} ${amount}${note}`, () => attest(c.s, id, { attestor: 'B', outcome, amount }));
};

const onRamp = (c, amount = 1000) => {
  const i = c.t(`create on-ramp for ${amount}`, () => createIntent(c.s, { kind: 'on_ramp', owner: 'amina', amount }));
  c.t('engine starts collect leg (STK push)', () => act(c.s, i.id, 'start'));
  return i.id;
};

const offRamp = (c, amount = 2000, funded = 5000) => {
  if (funded) c.t(`demo: fund account with ${funded}`, () => faucet(c.s, 'amina', funded));
  const i = c.t(`create off-ramp for ${amount} (escrow locks)`, () => createIntent(c.s, { kind: 'off_ramp', owner: 'amina', amount }));
  if (!i) return null;
  c.t('engine starts payout leg (B2C)', () => act(c.s, i.id, 'start'));
  return i.id;
};

export const SCENARIOS = {
  onramp_happy: {
    desc: 'Deposit confirmed by both attestors, units minted once.',
    expect: 'SETTLED',
    run(c) { const id = onRamp(c); both(c, id, 'confirmed', 1000); return id; },
    check: (s) => s.balances.get('amina') === 1000 && s.supply === 1000,
  },
  onramp_underpaid: {
    desc: 'Customer paid less than requested: no mint, fiat is returned off-chain.',
    expect: 'REFUNDED',
    run(c) { const id = onRamp(c); both(c, id, 'confirmed', 600, ' (short)'); c.t('refund fiat to customer', () => act(c.s, id, 'refund')); return id; },
    check: (s) => (s.balances.get('amina') ?? 0) === 0 && s.supply === 0,
  },
  onramp_duplicate_attestation: {
    desc: 'A repeats the same attestation (duplicate webhook): rejected, no double mint.',
    expect: 'SETTLED',
    run(c) {
      const id = onRamp(c);
      c.t('attestor A: confirmed 1000', () => attest(c.s, id, { attestor: 'A', outcome: 'confirmed', amount: 1000 }));
      c.t('attestor A again (duplicate)', () => attest(c.s, id, { attestor: 'A', outcome: 'confirmed', amount: 1000 }));
      c.t('attestor B: confirmed 1000', () => attest(c.s, id, { attestor: 'B', outcome: 'confirmed', amount: 1000 }));
      return id;
    },
    check: (s) => s.supply === 1000,
  },
  onramp_equivocation: {
    desc: 'A sends a conflicting amount: rejected and flagged (slashable on-chain).',
    expect: 'SETTLED',
    run(c) {
      const id = onRamp(c);
      c.t('attestor A: confirmed 1000', () => attest(c.s, id, { attestor: 'A', outcome: 'confirmed', amount: 1000 }));
      c.t('attestor A: conflicting 500', () => attest(c.s, id, { attestor: 'A', outcome: 'confirmed', amount: 500 }));
      c.t('attestor B: confirmed 1000', () => attest(c.s, id, { attestor: 'B', outcome: 'confirmed', amount: 1000 }));
      return id;
    },
    check: (s, id) => getIntent(s, id).flags.includes('equivocation:A'),
  },
  onramp_expired: {
    desc: 'No payment arrives before the TTL: intent expires, nothing minted.',
    expect: 'EXPIRED',
    run(c) { const id = onRamp(c); c.t('TTL elapsed: expire', () => act(c.s, id, 'expire')); return id; },
    check: (s) => s.supply === 0,
  },
  onramp_mint_blocked_by_cap: {
    desc: 'Attested but reserves are too low: mint blocked until reserves are raised.',
    expect: 'SETTLED',
    run(c) {
      c.t('reserve attestation drops to 500', () => setParams(c.s, { reserve: 500 }));
      const id = onRamp(c);
      both(c, id, 'confirmed', 1000);
      c.t('mint attempt while blocked', () => act(c.s, id, 'mint'));
      c.t('provider attests larger reserve', () => setParams(c.s, { reserve: 1_000_000 }));
      c.t('retry mint', () => act(c.s, id, 'mint'));
      return id;
    },
    check: (s) => s.supply === 1000,
  },
  onramp_reversal_after_credit: {
    desc: 'Provider reverses a payment after credit: units are clawed back.',
    expect: 'REVERSED',
    run(c) { const id = onRamp(c); both(c, id, 'confirmed', 1000); c.t('provider reverses payment', () => act(c.s, id, 'reverse')); return id; },
    check: (s, id) => s.supply === 0 && getIntent(s, id).reversalShortfall === 0,
  },
  offramp_happy: {
    desc: 'Escrow locked, payout confirmed, escrow burned.',
    expect: 'SETTLED',
    run(c) { const id = offRamp(c); both(c, id, 'confirmed', 2000); return id; },
    check: (s) => s.balances.get('amina') === 3000 && s.escrow === 0 && s.supply === 3000,
  },
  offramp_failed_payout_refunds: {
    desc: 'Payout definitively fails: escrow is released back to the user.',
    expect: 'REFUNDED',
    run(c) { const id = offRamp(c); both(c, id, 'failed', 2000); return id; },
    check: (s) => s.balances.get('amina') === 5000 && s.escrow === 0,
  },
  offramp_ambiguous_then_paid: {
    desc: 'Payout status unknown: held, cannot be expired, resolved later as paid.',
    expect: 'SETTLED',
    run(c) {
      const id = offRamp(c);
      both(c, id, 'ambiguous', 2000);
      c.t('try to expire while ambiguous (must be rejected)', () => act(c.s, id, 'expire'));
      both(c, id, 'confirmed', 2000, ' (resolution)');
      return id;
    },
    check: (s) => s.balances.get('amina') === 3000 && s.escrow === 0,
  },
  offramp_ambiguous_then_failed: {
    desc: 'Payout status unknown, later resolved as failed: escrow refunded.',
    expect: 'REFUNDED',
    run(c) { const id = offRamp(c); both(c, id, 'ambiguous', 2000); both(c, id, 'failed', 2000, ' (resolution)'); return id; },
    check: (s) => s.balances.get('amina') === 5000 && s.escrow === 0,
  },
  offramp_expire_while_in_flight_rejected: {
    desc: 'Expiry cannot touch a payout that may already be in flight.',
    expect: 'PAYOUT_PENDING',
    run(c) { const id = offRamp(c); c.t('try to expire during payout (must be rejected)', () => act(c.s, id, 'expire')); return id; },
    check: (s) => s.escrow === 2000,
  },
  offramp_cancel_before_start: {
    desc: 'User cancels before any money moved: escrow released.',
    expect: 'REFUNDED',
    run(c) {
      c.t('demo: fund account with 5000', () => faucet(c.s, 'amina', 5000));
      const i = c.t('create off-ramp for 2000', () => createIntent(c.s, { kind: 'off_ramp', owner: 'amina', amount: 2000 }));
      c.t('cancel before payout starts', () => act(c.s, i.id, 'cancel'));
      return i.id;
    },
    check: (s) => s.balances.get('amina') === 5000 && s.escrow === 0,
  },
  offramp_insufficient_balance: {
    desc: 'Off-ramp for more than the balance is rejected up front.',
    expect: null,
    run(c) { c.t('create off-ramp for 2000 with no funds', () => createIntent(c.s, { kind: 'off_ramp', owner: 'amina', amount: 2000 })); return null; },
    check: (s) => s.escrow === 0,
  },
};

export function runScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new EngineError('UNKNOWN_SCENARIO', `unknown scenario "${name}"`, 404);
  const c = makeCtx();
  const id = sc.run(c);
  const finalState = id ? getIntent(c.s, id).state : null;
  const led = ledger(c.s);
  const passed = finalState === sc.expect && led.invariantOk && sc.check(c.s, id);
  return { scenario: name, description: sc.desc, expected: sc.expect, finalState, passed, steps: c.trace, ledger: led };
}

export const scenarioNames = () => Object.keys(SCENARIOS);

export function selfTest() {
  const results = scenarioNames().map((n) => {
    const r = runScenario(n);
    return { scenario: n, passed: r.passed, expected: r.expected, finalState: r.finalState };
  });
  const failed = results.filter((r) => !r.passed).length;
  return { total: results.length, passed: results.length - failed, failed, results };
}
