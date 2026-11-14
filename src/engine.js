// In-memory model of x/ramp + x/fiatoracle + the engine's attestor signers.
// Amounts are integers in the smallest unit (no floats, same rule as the chain).

import { Kind, State, Event, Effect, next, effectFor } from './fsm.js';

export class EngineError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.status = status;
  }
}

export const ATTESTORS = ['A', 'B'];
const OUTCOMES = ['confirmed', 'failed', 'ambiguous'];

export function createStore(paramOverrides = {}) {
  return {
    params: { reserve: 1_000_000, safetyBps: 9500, mintingPaused: false, thresholdWeight: 2, ...paramOverrides },
    balances: new Map(),
    escrow: 0,
    supply: 0,
    shortfall: 0,
    intents: new Map(),
    seq: 0,
    seenCallbacks: new Set(),
    events: [],
  };
}

export function emit(store, type, data = {}) {
  store.events.push({ n: store.events.length + 1, type, ...data });
  if (store.events.length > 200) store.events.shift();
}

const balanceOf = (s, owner) => s.balances.get(owner) ?? 0;
export const mintCap = (s) => Math.floor((s.params.reserve * s.params.safetyBps) / 10000);

export function ledger(store) {
  let sum = store.escrow;
  for (const v of store.balances.values()) sum += v;
  return {
    supply: store.supply,
    escrow: store.escrow,
    shortfall: store.shortfall,
    balances: Object.fromEntries(store.balances),
    mintCap: mintCap(store),
    params: store.params,
    invariantOk: store.supply === sum, // supply must equal balances + escrow
  };
}

export function setParams(store, patch = {}) {
  for (const k of ['reserve', 'safetyBps']) {
    if (patch[k] !== undefined) {
      if (!Number.isSafeInteger(patch[k]) || patch[k] < 0) throw new EngineError('INVALID_PARAM', `${k} must be a non-negative integer`);
      store.params[k] = patch[k];
    }
  }
  if (patch.mintingPaused !== undefined) store.params.mintingPaused = Boolean(patch.mintingPaused);
  emit(store, 'params_updated', { params: store.params });
  return store.params;
}

// Mock only: gives an account demo units (keeps supply consistent).
export function faucet(store, owner, amount) {
  if (typeof owner !== 'string' || !owner) throw new EngineError('INVALID_OWNER', 'owner is required');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new EngineError('INVALID_AMOUNT', 'amount must be a positive integer');
  store.balances.set(owner, balanceOf(store, owner) + amount);
  store.supply += amount;
  emit(store, 'faucet', { owner, amount });
  return { owner, balance: balanceOf(store, owner) };
}

const view = (i) => ({ ...i, attestations: { ...i.attestations }, flags: [...i.flags], history: [...i.history] });

export function getIntent(store, id) {
  const i = store.intents.get(id);
  if (!i) throw new EngineError('NOT_FOUND', `intent ${id} not found`, 404);
  return i;
}

export function createIntent(store, { kind, owner = 'demo-user', amount } = {}) {
  if (kind !== Kind.ON_RAMP && kind !== Kind.OFF_RAMP) throw new EngineError('INVALID_KIND', 'kind must be "on_ramp" or "off_ramp"');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new EngineError('INVALID_AMOUNT', 'amount must be a positive integer (smallest unit)');
  if (typeof owner !== 'string' || !owner) throw new EngineError('INVALID_OWNER', 'owner must be a non-empty string');
  if (kind === Kind.OFF_RAMP) {
    const bal = balanceOf(store, owner);
    if (bal < amount) throw new EngineError('INSUFFICIENT_BALANCE', `balance ${bal} is less than ${amount}`, 409);
    store.balances.set(owner, bal - amount); // lock escrow at creation
    store.escrow += amount;
  }
  const id = `int_${++store.seq}`;
  const intent = { id, kind, owner, amount, state: State.CREATED, attestations: {}, flags: [], history: [{ event: 'CREATE', to: State.CREATED }] };
  store.intents.set(id, intent);
  emit(store, 'ramp_intent_created', { id, kind, amount });
  return view(intent);
}

function assertCanMint(store, amount) {
  if (store.params.mintingPaused) throw new EngineError('MINT_BLOCKED', 'minting is paused by the guardian', 409);
  const cap = mintCap(store);
  if (store.supply + amount > cap) {
    throw new EngineError('MINT_BLOCKED', `mint cap exceeded (cap ${cap}, supply ${store.supply}, requested ${amount})`, 409);
  }
}

// The only place state changes: validate via the FSM, then perform the ledger effect.
function apply(store, intent, event) {
  const to = next(intent.kind, intent.state, event); // throws if illegal
  const effect = effectFor(intent.kind, event);
  if (effect === Effect.MINT) assertCanMint(store, intent.amount);
  switch (effect) {
    case Effect.MINT:
      store.balances.set(intent.owner, balanceOf(store, intent.owner) + intent.amount);
      store.supply += intent.amount;
      break;
    case Effect.BURN:
      store.escrow -= intent.amount;
      store.supply -= intent.amount;
      break;
    case Effect.RELEASE_ESCROW:
      store.escrow -= intent.amount;
      store.balances.set(intent.owner, balanceOf(store, intent.owner) + intent.amount);
      break;
    case Effect.FLAG_REVERSAL: {
      const take = Math.min(balanceOf(store, intent.owner), intent.amount);
      store.balances.set(intent.owner, balanceOf(store, intent.owner) - take);
      store.supply -= take;
      intent.reversalShortfall = intent.amount - take;
      store.shortfall += intent.reversalShortfall;
      break;
    }
    default: break;
  }
  intent.history.push({ event, from: intent.state, to });
  intent.state = to;
  intent.attestations = {}; // a new state starts a new attestation round
  emit(store, 'ramp_state_changed', { id: intent.id, event, state: to });
  return to;
}

const ACTIONS = {
  start: (i) => (i.kind === Kind.ON_RAMP ? Event.REQUEST_FUNDS : Event.START_PAYOUT),
  cancel: () => Event.CANCEL,
  expire: () => Event.EXPIRE,
  mint: () => Event.MINTED,
  reverse: () => Event.REVERSED,
  refund: () => Event.REFUNDED,
};

export function act(store, id, action) {
  const intent = getIntent(store, id);
  const make = ACTIONS[action];
  if (!make) throw new EngineError('UNKNOWN_ACTION', `action must be one of: ${Object.keys(ACTIONS).join(', ')}`, 404);
  apply(store, intent, make(intent));
  return view(intent);
}

function validateAttestation(intent, outcome, amount) {
  if (!OUTCOMES.includes(outcome)) throw new EngineError('INVALID_OUTCOME', `outcome must be one of: ${OUTCOMES.join(', ')}`);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new EngineError('INVALID_AMOUNT', 'amount must be a positive integer');
  if (intent.kind === Kind.ON_RAMP) {
    if (intent.state !== State.AWAITING_FIAT) throw new EngineError('INVALID_STATE', `cannot attest an on-ramp in state ${intent.state}`, 409);
    if (outcome !== 'confirmed') throw new EngineError('INVALID_OUTCOME', 'on-ramp legs resolve by "confirmed" or by expiry', 400);
    if (amount > intent.amount) throw new EngineError('AMOUNT_EXCEEDS_INTENT', `received ${amount} exceeds intent amount ${intent.amount}`, 409);
  } else {
    if (intent.state !== State.PAYOUT_PENDING && intent.state !== State.AMBIGUOUS) {
      throw new EngineError('INVALID_STATE', `cannot attest an off-ramp in state ${intent.state}`, 409);
    }
    if (intent.state === State.AMBIGUOUS && outcome === 'ambiguous') {
      throw new EngineError('INVALID_OUTCOME', 'an ambiguous payout must be resolved as confirmed or failed', 400);
    }
    if (amount !== intent.amount) throw new EngineError('AMOUNT_MISMATCH', `attested ${amount} does not match intent amount ${intent.amount}`, 409);
  }
}

function resolve(store, intent, outcome, amount) {
  const out = { mintBlocked: null };
  if (intent.kind === Kind.ON_RAMP) {
    if (amount < intent.amount) { apply(store, intent, Event.UNDERPAID); return out; }
    apply(store, intent, Event.FIAT_CONFIRMED); // attestation alone never mints...
    try { apply(store, intent, Event.MINTED); } // ...minting is a separate, cap-checked step
    catch (e) {
      if (e instanceof EngineError && e.code === 'MINT_BLOCKED') out.mintBlocked = e.message;
      else throw e;
    }
    return out;
  }
  const wasAmbiguous = intent.state === State.AMBIGUOUS;
  if (outcome === 'confirmed') {
    apply(store, intent, wasAmbiguous ? Event.RESOLVED_PAID : Event.PAYOUT_CONFIRMED);
    apply(store, intent, Event.BURNED);
  } else if (outcome === 'failed') {
    apply(store, intent, wasAmbiguous ? Event.RESOLVED_FAILED : Event.PAYOUT_FAILED);
    apply(store, intent, Event.REFUNDED);
  } else {
    apply(store, intent, Event.PAYOUT_AMBIGUOUS);
  }
  return out;
}

export function attest(store, id, { attestor, outcome, amount } = {}) {
  const intent = getIntent(store, id);
  if (!ATTESTORS.includes(attestor)) throw new EngineError('UNKNOWN_ATTESTOR', `attestor must be one of: ${ATTESTORS.join(', ')}`, 403);
  if (amount === undefined) amount = intent.amount;
  validateAttestation(intent, outcome, amount);

  const existing = intent.attestations[attestor];
  if (existing) {
    if (existing.outcome === outcome && existing.amount === amount) {
      throw new EngineError('DUPLICATE_ATTESTATION', `attestor ${attestor} already attested this round`, 409);
    }
    intent.flags.push(`equivocation:${attestor}`);
    emit(store, 'attestor_equivocation', { id, attestor });
    throw new EngineError('EQUIVOCATION', `attestor ${attestor} sent a conflicting attestation (would be slashed on-chain)`, 409);
  }
  intent.attestations[attestor] = { outcome, amount };
  emit(store, 'ramp_leg_attested', { id, attestor, outcome, amount });

  const entries = Object.values(intent.attestations);
  if (entries.length < store.params.thresholdWeight) {
    return { thresholdReached: false, intent: view(intent) };
  }
  const first = entries[0];
  if (!entries.every((e) => e.outcome === first.outcome && e.amount === first.amount)) {
    if (!intent.flags.includes('disputed')) intent.flags.push('disputed');
    emit(store, 'attestation_disputed', { id });
    return { thresholdReached: false, disputed: true, intent: view(intent) };
  }
  const res = resolve(store, intent, first.outcome, first.amount);
  return { thresholdReached: true, mintBlocked: res.mintBlocked, intent: view(intent) };
}
