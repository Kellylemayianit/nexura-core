package types

import "fmt"

// Deterministic ramp intent state machine.
// Pure Go on purpose: no SDK imports, no time, no randomness, no maps iterated for output.
// The keeper calls Next() and then performs the ledger action returned by EffectFor().
// Names are deliberately distinct from the proto-generated IntentState/IntentType types;
// map between them in the keeper (e.g. fromProtoState / toProtoState).

type Kind uint8

const (
	KindOnRamp Kind = iota + 1
	KindOffRamp
)

type State uint8

const (
	StateCreated State = iota + 1
	StateAwaitingFiat
	StateAttested
	StatePayoutPending
	StateAttestedPaid
	StatePayoutFailed
	StateAmbiguous
	StateSettled
	StateExpired
	StateUnderpaid
	StateReversed
	StateRefunded
	StateQuarantined
)

type Event uint8

const (
	EvRequestFunds Event = iota + 1 // on-ramp: engine started the collect leg
	EvFiatConfirmed                 // on-ramp: threshold attestation, fiat received in full
	EvUnderpaid                     // on-ramp: threshold attestation, amount short
	EvMinted                        // on-ramp: units minted
	EvReversed                      // on-ramp: provider reversed after credit
	EvStartPayout                   // off-ramp: engine started the payout leg
	EvPayoutConfirmed               // off-ramp: threshold attestation, payout done
	EvPayoutFailed                  // off-ramp: threshold attestation, payout definitively failed
	EvPayoutAmbiguous               // off-ramp: status unknown; hold, never retry elsewhere
	EvResolvedPaid                  // off-ramp: ambiguity resolved as paid
	EvResolvedFailed                // off-ramp: ambiguity resolved as failed
	EvBurned                        // off-ramp: escrowed units burned
	EvRefunded                      // refund completed (escrow released, or fiat returned off-chain)
	EvCancel                        // owner cancels before any money has moved
	EvExpire                        // TTL elapsed before any money has moved
	EvQuarantine                    // compliance hold before mint
	EvReleaseQuarantine             // compliance cleared
	EvRejectQuarantine              // compliance rejected
)

type Effect uint8

const (
	EffectNone Effect = iota
	EffectMint
	EffectBurn
	EffectReleaseEscrow
	EffectFlagReversal
)

type key struct {
	kind Kind
	from State
	ev   Event
}

var transitions = map[key]State{
	// ---- on-ramp ----
	{KindOnRamp, StateCreated, EvRequestFunds}:        StateAwaitingFiat,
	{KindOnRamp, StateCreated, EvCancel}:              StateExpired,
	{KindOnRamp, StateAwaitingFiat, EvFiatConfirmed}:  StateAttested,
	{KindOnRamp, StateAwaitingFiat, EvUnderpaid}:      StateUnderpaid,
	{KindOnRamp, StateAwaitingFiat, EvExpire}:         StateExpired,
	{KindOnRamp, StateUnderpaid, EvRefunded}:          StateRefunded,
	{KindOnRamp, StateAttested, EvMinted}:             StateSettled,
	{KindOnRamp, StateAttested, EvQuarantine}:         StateQuarantined,
	{KindOnRamp, StateQuarantined, EvReleaseQuarantine}: StateAttested,
	{KindOnRamp, StateQuarantined, EvRejectQuarantine}:  StateRefunded,
	{KindOnRamp, StateSettled, EvReversed}:            StateReversed,

	// ---- off-ramp (escrow is locked when the intent is created) ----
	{KindOffRamp, StateCreated, EvStartPayout}:        StatePayoutPending,
	{KindOffRamp, StateCreated, EvCancel}:             StateRefunded,
	{KindOffRamp, StateCreated, EvExpire}:             StateRefunded,
	{KindOffRamp, StatePayoutPending, EvPayoutConfirmed}: StateAttestedPaid,
	{KindOffRamp, StatePayoutPending, EvPayoutFailed}:    StatePayoutFailed,
	{KindOffRamp, StatePayoutPending, EvPayoutAmbiguous}: StateAmbiguous,
	{KindOffRamp, StateAmbiguous, EvResolvedPaid}:     StateAttestedPaid,
	{KindOffRamp, StateAmbiguous, EvResolvedFailed}:   StatePayoutFailed,
	{KindOffRamp, StateAttestedPaid, EvBurned}:        StateSettled,
	{KindOffRamp, StatePayoutFailed, EvRefunded}:      StateRefunded,
}

// Next returns the next state or an error if the transition is not allowed.
// Notably there is no EvExpire/EvCancel out of PayoutPending or Ambiguous:
// money may be in flight, so only an attestation or a governed resolution can move it.
func Next(k Kind, from State, ev Event) (State, error) {
	to, ok := transitions[key{k, from, ev}]
	if !ok {
		return 0, fmt.Errorf("ramp: invalid transition kind=%d state=%s event=%d", k, from, ev)
	}
	return to, nil
}

// IsTerminal reports whether no further transition exists from this state for this kind.
func IsTerminal(k Kind, s State) bool {
	for kk := range transitions {
		if kk.kind == k && kk.from == s {
			return false
		}
	}
	return true
}

// EffectFor says which ledger action the keeper must perform for an event.
func EffectFor(k Kind, ev Event) Effect {
	switch ev {
	case EvMinted:
		return EffectMint
	case EvBurned:
		return EffectBurn
	case EvReversed:
		return EffectFlagReversal
	case EvCancel, EvExpire, EvRefunded:
		if k == KindOffRamp {
			return EffectReleaseEscrow
		}
	}
	return EffectNone
}

var stateNames = map[State]string{
	StateCreated: "CREATED", StateAwaitingFiat: "AWAITING_FIAT", StateAttested: "ATTESTED",
	StatePayoutPending: "PAYOUT_PENDING", StateAttestedPaid: "ATTESTED_PAID",
	StatePayoutFailed: "PAYOUT_FAILED", StateAmbiguous: "AMBIGUOUS", StateSettled: "SETTLED",
	StateExpired: "EXPIRED", StateUnderpaid: "UNDERPAID", StateReversed: "REVERSED",
	StateRefunded: "REFUNDED", StateQuarantined: "QUARANTINED",
}

func (s State) String() string {
	if n, ok := stateNames[s]; ok {
		return n
	}
	return fmt.Sprintf("UNKNOWN(%d)", uint8(s))
}
