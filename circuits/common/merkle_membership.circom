pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

// Standard Merkle inclusion proof: proves `leaf` is included in a tree
// rooted at `root`, given a sibling path. path_indices[i] = 0 means the
// current node is the LEFT child at level i (sibling is on the right),
// 1 means current node is the RIGHT child (sibling is on the left).
//
// `root` is a PUBLIC input. This is the integrator-specific piece: each
// integrator builds (off-chain, see scripts/build_restricted_tree.js)
// their own tree of restricted-country sorted pairs and registers the
// resulting root with kyc_registry. The circuit doesn't know or care
// whose tree it is — it just checks the supplied bracket sits inside
// whichever root the integrator configured.
template MerkleMembership(levels) {
    signal input leaf;
    signal input root;
    signal input path_elements[levels];
    signal input path_indices[levels]; // each must be 0 or 1

    component hashers[levels];
    component muxLeft[levels];
    component muxRight[levels];

    signal cur[levels + 1];
    cur[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // constrain path_indices[i] to be boolean
        path_indices[i] * (1 - path_indices[i]) === 0;

        muxLeft[i] = Mux1();
        muxLeft[i].c[0] <== cur[i];
        muxLeft[i].c[1] <== path_elements[i];
        muxLeft[i].s <== path_indices[i];

        muxRight[i] = Mux1();
        muxRight[i].c[0] <== path_elements[i];
        muxRight[i].c[1] <== cur[i];
        muxRight[i].s <== path_indices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxLeft[i].out;
        hashers[i].inputs[1] <== muxRight[i].out;

        cur[i + 1] <== hashers[i].out;
    }

    cur[levels] === root;
}
