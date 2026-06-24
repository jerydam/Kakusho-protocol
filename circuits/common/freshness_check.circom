pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";

// Proves current_timestamp - doc_issue_timestamp <= doc_max_age_seconds.
// doc_max_age_seconds is PUBLIC and integrator-configurable — a bank
// might require a document issued within the last 2 years; a casual
// dApp might accept anything issued within 10. Same circuit either way.
template FreshnessCheck() {
    signal input current_timestamp;
    signal input doc_issue_timestamp;
    signal input doc_max_age_seconds;

    signal doc_age_seconds;
    doc_age_seconds <== current_timestamp - doc_issue_timestamp;

    component check = LessEqThan(64);
    check.in[0] <== doc_age_seconds;
    check.in[1] <== doc_max_age_seconds;
    check.out === 1;
}
