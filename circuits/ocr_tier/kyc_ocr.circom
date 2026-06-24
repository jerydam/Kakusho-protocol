pragma circom 2.1.6;

include "../common/age_check.circom";
include "../common/freshness_check.circom";
include "../common/merkle_membership.circom";
include "../common/nullifier.circom";

// ─────────────────────────────────────────────────────────────────────────
// kyc_ocr.circom — UNIVERSAL B2B2C CIRCUIT (Tier 0 / OCR-attested)
//
// This is the ONE circuit every integrator uses. There is no per-
// integrator circuit variant and no per-integrator verifying key for
// this tier — min_age_seconds, restricted_root, doc_max_age_seconds,
// and integrator_id are all PUBLIC INPUTS supplied at proving time, not
// baked into the circuit. A single Groth16 verifying key (committed in
// kyc_registry's DEFAULT_VK) verifies proofs for every integrator on the
// protocol; the registry contract is what checks a proof's public
// inputs actually match the rules a given integrator registered.
//
// Public signals, in this exact order (kyc_registry depends on it):
//   [0] nullifier               — unique per (document, integrator)
//   [1] current_timestamp       — prover's claimed "now"; registry should
//                                  sanity-check this against ledger time
//   [2] min_age_seconds         — integrator's age floor
//   [3] restricted_root         — integrator's banned-country Merkle root
//   [4] doc_max_age_seconds     — integrator's document-freshness window
//   [5] integrator_id           — which integrator this proof is for
//
// Private inputs come from witness/ocr_witness_builder.ts (browser-side,
// see sdk/src/prover) — dob_timestamp, nationality_code, doc_id,
// doc_issue_timestamp, user_secret, and the Merkle bracket proving
// nationality_code is NOT in the integrator's restricted set.
//
// SECURITY NOTE on current_timestamp: this is supplied by the prover,
// not derived on-chain. A malicious prover could supply a fabricated
// current_timestamp to make an expired/underage document pass. The
// registry contract MUST bound-check this public input against the
// Soroban ledger's actual timestamp (e.g. require it be within some
// small window of env.ledger().timestamp()) before trusting the proof's
// age/freshness conclusions. This circuit only proves internal
// consistency of the relationship between the supplied values — it
// cannot prove current_timestamp itself is honest. See kyc_registry's
// MAX_TIMESTAMP_DRIFT_SECONDS.
// ─────────────────────────────────────────────────────────────────────────

template KycOcr(levels) {
    // ── Public inputs (integrator-configurable rule set) ──
    signal input current_timestamp;
    signal input min_age_seconds;
    signal input restricted_root;
    signal input doc_max_age_seconds;
    signal input integrator_id;

    // ── Private inputs (from OCR witness, never leave the browser) ──
    signal input dob_timestamp;
    signal input nationality_code;
    signal input doc_id;
    signal input doc_issue_timestamp;
    signal input user_secret;

    // Non-membership bracket: low < nationality_code < high, (low,high)
    // is a real adjacent pair from THIS integrator's sorted restricted
    // list, proven via Merkle path against restricted_root above.
    signal input bracket_low;
    signal input bracket_high;
    signal input path_elements[levels];
    signal input path_indices[levels];

    // ── Public output ──
    signal output nullifier;

    // ── Predicate 1: age ──
    component age = AgeCheck();
    age.current_timestamp <== current_timestamp;
    age.dob_timestamp <== dob_timestamp;
    age.min_age_seconds <== min_age_seconds;

    // ── Predicate 2: country exclusion (non-membership via bracket) ──
    component lowCheck = GreaterThan(32);
    lowCheck.in[0] <== nationality_code;
    lowCheck.in[1] <== bracket_low;
    lowCheck.out === 1;

    component highCheck = LessThan(32);
    highCheck.in[0] <== nationality_code;
    highCheck.in[1] <== bracket_high;
    highCheck.out === 1;

    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== bracket_low;
    leafHasher.inputs[1] <== bracket_high;

    component merkle = MerkleMembership(levels);
    merkle.leaf <== leafHasher.out;
    merkle.root <== restricted_root;
    for (var i = 0; i < levels; i++) {
        merkle.path_elements[i] <== path_elements[i];
        merkle.path_indices[i] <== path_indices[i];
    }

    // ── Predicate 3: document freshness ──
    component fresh = FreshnessCheck();
    fresh.current_timestamp <== current_timestamp;
    fresh.doc_issue_timestamp <== doc_issue_timestamp;
    fresh.doc_max_age_seconds <== doc_max_age_seconds;

    // ── Nullifier, domain-separated per integrator ──
    component nf = Nullifier();
    nf.doc_id <== doc_id;
    nf.user_secret <== user_secret;
    nf.integrator_id <== integrator_id;
    nullifier <== nf.nullifier;
}

// 8 levels => up to 256 restricted-country pairs per integrator's tree.
// Bump if an integrator needs a larger restricted list; this is a
// compile-time constant for the WHOLE protocol (changing it requires a
// new trusted setup + new VK + migrating every integrator), so pick a
// number with headroom up front rather than per-integrator.
component main {public [
    current_timestamp, min_age_seconds, restricted_root,
    doc_max_age_seconds, integrator_id
]} = KycOcr(8);
