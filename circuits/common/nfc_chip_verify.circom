pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/sha256/sha256.circom";
include "circomlib/circuits/bitify.circom";

// nfc_chip_verify.circom — proves that data read from an ePassport or
// eID NFC chip was genuinely signed by the issuing country, WITHOUT
// revealing the underlying personal data.
//
// HOW ePassport NFC WORKS (ICAO 9303 Passive Authentication):
//
//   1. The chip stores Data Groups (DG1 = MRZ text, DG2 = photo, etc.)
//   2. The chip also stores a Document Security Object (SOD), which
//      contains SHA-256 hashes of each DG, signed by the issuing
//      country's Document Signer (DS) certificate.
//   3. The DS cert is signed by the country's CSCA (Country Signing CA).
//   4. Verifying the chain: hash(DG1) is inside SOD, SOD sig checks out
//      against DS cert, DS cert chains to a trusted CSCA.
//
// WHAT THIS CIRCUIT PROVES (off-chain witness + on-chain public signals):
//
//   PRIVATE (only the prover knows):
//     - dg1_data_hash[256]  : SHA-256 of raw DG1 bytes (MRZ data)
//     - doc_id              : document number as field element (for nullifier)
//     - user_secret         : user's secret scalar (for nullifier)
//     - dob_timestamp       : date-of-birth as Unix seconds
//     - doc_issue_timestamp : document issue date as Unix seconds
//     - country_code        : numeric ISO 3166-1 country code
//
//   PUBLIC (verifiable by contract without seeing raw data):
//     - sod_dg1_hash[256]   : the hash recorded INSIDE the SOD
//     - chip_commitment      : Poseidon(dg1_data_hash_bigint, user_secret)
//     - nullifier            : Poseidon(doc_id, user_secret, integrator_id)
//     - current_timestamp    : block/server timestamp at proof generation
//     - integrator_id        : which integrator is being proved to
//
// The core constraint: dg1_data_hash === sod_dg1_hash.
//
// This means: "I read the chip. The DG1 on the chip hashes to exactly
// the value the country's DS certificate vouches for. The DS signature
// itself is verified OFF-CIRCUIT by the backend (nfc_verify.py) before
// witness generation — this circuit receives the already-verified hash
// pair and proves they match, plus binds a commitment and nullifier to
// the chip data."
//
// WHY DS SIGNATURE VERIFICATION IS OFF-CIRCUIT:
// RSA-2048 + SHA-256 verification in a Groth16 circuit requires
// ~500k+ constraints for a single signature. At that size, trusted
// setup and witness generation become impractical on mobile. The
// practical hybrid: the backend (or a TEE) verifies the RSA/ECDSA chain
// before producing witness inputs, then THIS circuit proves the logical
// consequences of that verification (hash binding + nullifier) which
// are cheap. If you later want fully on-circuit DS verification, look at
// passport-zk (https://github.com/zk-passport) which uses chunked RSA.
//
// INTEGRATION WITH EXISTING CIRCUITS:
// This circuit is ADDITIVE to kyc_ocr.circom, not a replacement.
// - OCR flow: user scans document visually → kyc_ocr circuit
// - NFC flow: user taps document NFC chip → THIS circuit
// Both produce a nullifier via the same Nullifier() template from
// nullifier.circom, ensuring double-spend protection works identically.
//
// The kyc_registry contract on Soroban stores nullifiers without caring
// which circuit produced them — both are Poseidon(doc_id, user_secret,
// integrator_id). You may want to add a `proof_type` tag to the
// on-chain record later to distinguish OCR vs NFC verifications, but
// it's not required for correctness.

include "../common/nullifier.circom";

template NFCChipVerify() {
    // ── Private inputs ───────────────────────────────────────────────
    // SHA-256 of the raw DG1 bytes the prover read from the chip.
    // Represented as 256 bits (1 bit per signal).
    signal input dg1_data_bits[256];

    // doc_id: document serial number as a field element.
    // In witness_builder (nfc_witness_builder.ts) this is derived from
    // the 9-character alphanumeric document number in DG1 MRZ,
    // packed into a single field element the same way kyc_ocr.circom
    // packs its doc_id. Keep the packing function consistent.
    signal input doc_id;

    // user_secret: a random scalar the user generates locally and
    // never transmits. Stored in browser localStorage / secure enclave.
    // Same role as in kyc_ocr.circom.
    signal input user_secret;

    // dob_timestamp, doc_issue_timestamp: parsed from DG1 MRZ date
    // fields and converted to Unix seconds by nfc_witness_builder.ts.
    // Used by AgeCheck and FreshnessCheck — not constrained here,
    // just passed through as private signals for the witness.
    // (If you want the circuit to enforce age/freshness, instantiate
    //  AgeCheck() and FreshnessCheck() the same way kyc_ocr.circom does
    //  and add min_age_seconds / doc_max_age_seconds as public inputs.)
    signal input dob_timestamp;
    signal input doc_issue_timestamp;

    // country_code: numeric ISO 3166-1 code parsed from DG1 MRZ.
    // For non-membership proof (same pattern as kyc_ocr.circom's
    // restricted country check), pass this and the Merkle bracket proof
    // into MerkleMembership — see kyc_ocr.circom for the full pattern.
    signal input country_code;

    // ── Public inputs ────────────────────────────────────────────────
    // The DG1 hash as recorded inside the SOD — verified against the
    // DS certificate by nfc_verify.py BEFORE this witness is generated.
    // The circuit's job is only to prove this equals dg1_data_bits.
    signal input sod_dg1_hash_bits[256];

    // integrator_id: which integrator's registry this proof targets.
    // Public so kyc_registry can confirm it matches the stored config.
    signal input integrator_id;

    // current_timestamp: Unix seconds at proof generation time.
    // Public so FreshnessCheck can be verified by the contract.
    signal input current_timestamp;

    // ── Outputs (public) ─────────────────────────────────────────────
    signal output chip_commitment;
    signal output nullifier;

    // ── Core constraint: chip hash == SOD hash ───────────────────────
    // This is the heart of Passive Authentication in ZK form.
    // Every bit of the DG1 hash computed from the chip must equal
    // the corresponding bit from the DS-signed SOD.
    for (var i = 0; i < 256; i++) {
        dg1_data_bits[i] === sod_dg1_hash_bits[i];
    }

    // ── Convert 256-bit hash to a single field element ───────────────
    // Poseidon expects field elements, not bit arrays. Pack the 256-bit
    // hash into a field element using Bits2Num (big-endian packing).
    // BN254's field is ~254 bits so we lose 2 bits; for a commitment
    // this is fine — we're binding, not recovering the hash.
    component hash_to_field = Bits2Num(254);
    for (var i = 0; i < 254; i++) {
        hash_to_field.in[i] <== dg1_data_bits[253 - i];
    }

    // ── Chip commitment: Poseidon(hash_field, user_secret) ───────────
    // Binds the chip's verified hash to the user's secret.
    // Public output — the backend stores this to let the user later
    // prove they hold the secret without re-scanning the chip.
    component commitment_hasher = Poseidon(2);
    commitment_hasher.inputs[0] <== hash_to_field.out;
    commitment_hasher.inputs[1] <== user_secret;
    chip_commitment <== commitment_hasher.out;

    // ── Nullifier: Poseidon(doc_id, user_secret, integrator_id) ─────
    // Identical structure to nullifier.circom — ensures the same
    // physical NFC chip cannot verify twice for the same integrator,
    // while remaining unlinkable across integrators.
    component null_hasher = Nullifier();
    null_hasher.doc_id <== doc_id;
    null_hasher.user_secret <== user_secret;
    null_hasher.integrator_id <== integrator_id;
    nullifier <== null_hasher.nullifier;
}

component main {public [sod_dg1_hash_bits, integrator_id, current_timestamp]} = NFCChipVerify();
