pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";

// Proves current_timestamp - dob_timestamp >= min_age_seconds.
// min_age_seconds is a PUBLIC input — this is what makes the circuit
// reusable across integrators. A crypto-casino requiring 21+ and a
// DeFi protocol requiring 18+ both use this exact same circuit; they
// simply supply a different min_age_seconds value when proving, and
// the verifier contract checks that value against whatever the
// integrator registered for their integrator_id (see kyc_registry).
template AgeCheck() {
    signal input current_timestamp;
    signal input dob_timestamp;
    signal input min_age_seconds;

    signal age_seconds;
    age_seconds <== current_timestamp - dob_timestamp;

    component check = GreaterEqThan(64);
    check.in[0] <== age_seconds;
    check.in[1] <== min_age_seconds;
    check.out === 1;
}
