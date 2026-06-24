pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

// Binds a proof to (this document + this user secret + this integrator),
// so the same physical document cannot mint two "verified" statuses for
// the SAME integrator, without revealing doc_id itself.
//
// integrator_id is included as a PUBLIC input and folded into the hash.
// This is required for the B2B2C model: without it, a single nullifier
// computed from (doc_id, user_secret) alone would be identical across
// every integrator a user proves to, letting two unrelated integrators
// (e.g. a casino and a DeFi protocol) correlate that the same physical
// person used both of them — silently deanonymizing the user across
// apps even though neither learns who they are individually. Folding
// integrator_id in means each integrator sees an unlinkable nullifier
// specific to their own registry namespace.
template Nullifier() {
    signal input doc_id;
    signal input user_secret;
    signal input integrator_id;
    signal output nullifier;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== doc_id;
    hasher.inputs[1] <== user_secret;
    hasher.inputs[2] <== integrator_id;
    nullifier <== hasher.out;
}
