// Ramp intent state machine. Mirror of x/ramp/types/fsm.go (the Go version is the source of truth
// for the chain; this copy lets you test the same rules through HTTP endpoints).

export const Kind = Object.freeze({ ON_RAMP: 'on_ramp', OFF_RAMP: 'off_ramp' });

export const State = Object.freeze({
  CREATED: 'CREATED', AWAITING_FIAT: 'AWAITING_FIAT', ATTESTED: 'ATTESTED',
  PAYOUT_PENDING: 'PAYOUT_PENDING', ATTESTED_PAID: 'ATTESTED_PAID', PAYOUT_FAILED: 'PAYOUT_FAILED',
  AMBIGUOUS: 'AMBIGUOUS', SETTLED: 'SETTLED', EXPIRED: 'EXPIRED', UNDERPAID: 'UNDERPAID',
  REVERSED: 'REVERSED', REFUNDED: 'REFUNDED', QUARANTINED: 'QUARANTINED',
});

export const Event = Object.freeze({
  REQUEST_FUNDS: 'REQUEST_FUNDS', FIAT_CONFIRMED: 'FIAT_CONFIRMED', UNDERPAID: 'UNDERPAID',
  MINTED: 'MINTED', REVERSED: 'REVERSED', START_PAYOUT: 'START_PAYOUT',
  PAYOUT_CONFIRMED: 'PAYOUT_CONFIRMED', PAYOUT_FAILED: 'PAYOUT_FAILED',
  PAYOUT_AMBIGUOUS: 'PAYOUT_AMBIGUOUS', RESOLVED_PAID: 'RESOLVED_PAID',
  RESOLVED_FAILED: 'RESOLVED_FAILED', BURNED: 'BURNED', REFUNDED: 'REFUNDED',
  CANCEL: 'CANCEL', EXPIRE: 'EXPIRE', QUARANTINE: 'QUARANTINE',
  RELEASE_QUARANTINE: 'RELEASE_QUARANTINE', REJECT_QUARANTINE: 'REJECT_QUARANTINE',
});

export const Effect = Object.freeze({
  NONE: 'none', MINT: 'mint', BURN: 'burn', RELEASE_ESCROW: 'release_escrow', FLAG_REVERSAL: 'flag_reversal',
});

// [kind, from, event, to]
const TRANSITIONS = [
  // on-ramp
  ['on_ramp', 'CREATED', 'REQUEST_FUNDS', 'AWAITING_FIAT'],
  ['on_ramp', 'CREATED', 'CANCEL', 'EXPIRED'],
  ['on_ramp', 'AWAITING_FIAT', 'FIAT_CONFIRMED', 'ATTESTED'],
  ['on_ramp', 'AWAITING_FIAT', 'UNDERPAID', 'UNDERPAID'],
  ['on_ramp', 'AWAITING_FIAT', 'EXPIRE', 'EXPIRED'],
  ['on_ramp', 'UNDERPAID', 'REFUNDED', 'REFUNDED'],
  ['on_ramp', 'ATTESTED', 'MINTED', 'SETTLED'],
  ['on_ramp', 'ATTESTED', 'QUARANTINE', 'QUARANTINED'],
  ['on_ramp', 'QUARANTINED', 'RELEASE_QUARANTINE', 'ATTESTED'],
  ['on_ramp', 'QUARANTINED', 'REJECT_QUARANTINE', 'REFUNDED'],
  ['on_ramp', 'SETTLED', 'REVERSED', 'REVERSED'],
  // off-ramp (escrow is locked when the intent is created)
  ['off_ramp', 'CREATED', 'START_PAYOUT', 'PAYOUT_PENDING'],
  ['off_ramp', 'CREATED', 'CANCEL', 'REFUNDED'],
  ['off_ramp', 'CREATED', 'EXPIRE', 'REFUNDED'],
  ['off_ramp', 'PAYOUT_PENDING', 'PAYOUT_CONFIRMED', 'ATTESTED_PAID'],
  ['off_ramp', 'PAYOUT_PENDING', 'PAYOUT_FAILED', 'PAYOUT_FAILED'],
  ['off_ramp', 'PAYOUT_PENDING', 'PAYOUT_AMBIGUOUS', 'AMBIGUOUS'],
  ['off_ramp', 'AMBIGUOUS', 'RESOLVED_PAID', 'ATTESTED_PAID'],
  ['off_ramp', 'AMBIGUOUS', 'RESOLVED_FAILED', 'PAYOUT_FAILED'],
  ['off_ramp', 'ATTESTED_PAID', 'BURNED', 'SETTLED'],
  ['off_ramp', 'PAYOUT_FAILED', 'REFUNDED', 'REFUNDED'],
];

const table = new Map(TRANSITIONS.map(([k, f, e, t]) => [`${k}|${f}|${e}`, t]));

export class FsmError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FsmError';
    this.code = 'INVALID_TRANSITION';
    this.status = 409;
  }
}

// Returns the next state, or throws FsmError if the move is not allowed.
// Deliberately no EXPIRE/CANCEL out of PAYOUT_PENDING or AMBIGUOUS: money may be in flight.
export function next(kind, from, event) {
  const to = table.get(`${kind}|${from}|${event}`);
  if (!to) throw new FsmError(`${kind}: event ${event} is not allowed in state ${from}`);
  return to;
}

export function isTerminal(kind, state) {
  return !TRANSITIONS.some(([k, f]) => k === kind && f === state);
}

export function effectFor(kind, event) {
  switch (event) {
    case Event.MINTED: return Effect.MINT;
    case Event.BURNED: return Effect.BURN;
    case Event.REVERSED: return Effect.FLAG_REVERSAL;
    case Event.CANCEL:
    case Event.EXPIRE:
    case Event.REFUNDED:
      return kind === Kind.OFF_RAMP ? Effect.RELEASE_ESCROW : Effect.NONE;
    default: return Effect.NONE;
  }
}

export function transitionsList() {
  return TRANSITIONS.map(([kind, from, event, to]) => ({ kind, from, event, to }));
}
