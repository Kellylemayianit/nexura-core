package types

import "testing"

func run(t *testing.T, k Kind, start State, evs []Event, want State) {
	t.Helper()
	s := start
	for _, ev := range evs {
		var err error
		s, err = Next(k, s, ev)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if s != want {
		t.Fatalf("got %s want %s", s, want)
	}
}

func TestOnRampHappyPath(t *testing.T) {
	run(t, KindOnRamp, StateCreated,
		[]Event{EvRequestFunds, EvFiatConfirmed, EvMinted}, StateSettled)
}

func TestOnRampUnderpaidRefund(t *testing.T) {
	run(t, KindOnRamp, StateCreated,
		[]Event{EvRequestFunds, EvUnderpaid, EvRefunded}, StateRefunded)
}

func TestOnRampReversalAfterCredit(t *testing.T) {
	run(t, KindOnRamp, StateCreated,
		[]Event{EvRequestFunds, EvFiatConfirmed, EvMinted, EvReversed}, StateReversed)
}

func TestOnRampQuarantineRelease(t *testing.T) {
	run(t, KindOnRamp, StateCreated,
		[]Event{EvRequestFunds, EvFiatConfirmed, EvQuarantine, EvReleaseQuarantine, EvMinted}, StateSettled)
}

func TestOnRampQuarantineReject(t *testing.T) {
	run(t, KindOnRamp, StateCreated,
		[]Event{EvRequestFunds, EvFiatConfirmed, EvQuarantine, EvRejectQuarantine}, StateRefunded)
}

func TestOffRampHappyPath(t *testing.T) {
	run(t, KindOffRamp, StateCreated,
		[]Event{EvStartPayout, EvPayoutConfirmed, EvBurned}, StateSettled)
}

func TestOffRampFailureRefunds(t *testing.T) {
	run(t, KindOffRamp, StateCreated,
		[]Event{EvStartPayout, EvPayoutFailed, EvRefunded}, StateRefunded)
}

func TestOffRampAmbiguousResolvedBothWays(t *testing.T) {
	run(t, KindOffRamp, StateCreated,
		[]Event{EvStartPayout, EvPayoutAmbiguous, EvResolvedPaid, EvBurned}, StateSettled)
	run(t, KindOffRamp, StateCreated,
		[]Event{EvStartPayout, EvPayoutAmbiguous, EvResolvedFailed, EvRefunded}, StateRefunded)
}

func TestOffRampEarlyCancelAndExpireReleaseEscrow(t *testing.T) {
	run(t, KindOffRamp, StateCreated, []Event{EvCancel}, StateRefunded)
	run(t, KindOffRamp, StateCreated, []Event{EvExpire}, StateRefunded)
}

// Safety: money may be in flight, so neither expiry nor cancel may move these states.
func TestNoExpireOrCancelWhileMoneyInFlight(t *testing.T) {
	for _, s := range []State{StatePayoutPending, StateAmbiguous, StateAttestedPaid} {
		for _, ev := range []Event{EvExpire, EvCancel} {
			if _, err := Next(KindOffRamp, s, ev); err == nil {
				t.Fatalf("%s + event %d must be rejected", s, ev)
			}
		}
	}
	if _, err := Next(KindOnRamp, StateAttested, EvExpire); err == nil {
		t.Fatal("attested on-ramp must not expire")
	}
}

// Safety: an ambiguous payout can only be resolved, never skipped to burn or refund.
func TestAmbiguousCannotBeBurnedOrRefundedDirectly(t *testing.T) {
	for _, ev := range []Event{EvBurned, EvRefunded, EvPayoutConfirmed, EvPayoutFailed} {
		if _, err := Next(KindOffRamp, StateAmbiguous, ev); err == nil {
			t.Fatalf("ambiguous + event %d must be rejected", ev)
		}
	}
}

func TestKindsDoNotCross(t *testing.T) {
	if _, err := Next(KindOffRamp, StateCreated, EvRequestFunds); err == nil {
		t.Fatal("off-ramp must not accept on-ramp events")
	}
	if _, err := Next(KindOnRamp, StateCreated, EvStartPayout); err == nil {
		t.Fatal("on-ramp must not accept off-ramp events")
	}
}

func TestTerminalStates(t *testing.T) {
	for _, s := range []State{StateExpired, StateReversed, StateRefunded} {
		if !IsTerminal(KindOnRamp, s) {
			t.Fatalf("on-ramp %s should be terminal", s)
		}
	}
	if IsTerminal(KindOnRamp, StateSettled) {
		t.Fatal("on-ramp SETTLED can still be REVERSED")
	}
	if !IsTerminal(KindOffRamp, StateSettled) {
		t.Fatal("off-ramp SETTLED should be terminal")
	}
}

func TestEffects(t *testing.T) {
	cases := []struct {
		k  Kind
		ev Event
		w  Effect
	}{
		{KindOnRamp, EvMinted, EffectMint},
		{KindOffRamp, EvBurned, EffectBurn},
		{KindOffRamp, EvCancel, EffectReleaseEscrow},
		{KindOffRamp, EvExpire, EffectReleaseEscrow},
		{KindOffRamp, EvRefunded, EffectReleaseEscrow},
		{KindOnRamp, EvRefunded, EffectNone}, // fiat is returned off-chain, nothing to release on-chain
		{KindOnRamp, EvReversed, EffectFlagReversal},
		{KindOnRamp, EvFiatConfirmed, EffectNone}, // attestation alone never mints; EvMinted does
	}
	for _, c := range cases {
		if got := EffectFor(c.k, c.ev); got != c.w {
			t.Fatalf("kind=%d ev=%d got %d want %d", c.k, c.ev, got, c.w)
		}
	}
}

// Every state that appears as a target must have a name (guards against typos when extending).
func TestAllStatesNamed(t *testing.T) {
	for _, to := range transitions {
		if _, ok := stateNames[to]; !ok {
			t.Fatalf("state %d has no name", to)
		}
	}
}
