// storage.rs — updated to support NFC proof type alongside OCR.
//
// Changes from original storage.rs:
//   1. IntegratorConfig gains an optional `nfc_vk_override` field.
//      When None, the contract uses DEFAULT_NFC_VK (the shared NFC
//      circuit verification key baked into lib.rs as a constant).
//      When Some(vk), that integrator's NFC proofs are verified against
//      a custom key — useful if they compiled the circuit with custom
//      constraints (e.g. different age floor baked in at compile time).
//
//   2. DataKey::Nullifier now includes a proof_type byte so an OCR
//      nullifier and an NFC nullifier for the same document are stored
//      separately. This prevents a user who proved via NFC from being
//      blocked from also proving via OCR (or vice versa) for the same
//      integrator — they ARE different proofs and both may be legitimate.
//      If your policy is "one proof per document per integrator regardless
//      of method", drop the proof_type from the key and they'll share a
//      nullifier slot.
//
//   3. ProofType enum added — used in both DataKey and the submission log.

use soroban_sdk::{contracttype, Address, Bytes, BytesN};

/// Which circuit produced a given proof. Stored alongside the nullifier
/// so the contract knows which verification key to use.
#[derive(Clone, Copy, PartialEq)]
#[contracttype]
pub enum ProofType {
    /// kyc_ocr.circom — optical character recognition path
    OCR = 0,
    /// nfc_chip_verify.circom — NFC chip Passive Authentication path
    NFC = 1,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Integrator(BytesN<32>),
    /// Nullifier key is scoped to (integrator, nullifier_hash, proof_type).
    /// See storage.rs header note on why proof_type is included.
    Nullifier(BytesN<32>, BytesN<32>, ProofType),
}

#[derive(Clone)]
#[contracttype]
pub struct IntegratorConfig {
    pub owner: Address,

    /// Minimum age in seconds for the OCR path.
    /// The NFC path uses the same value unless you extend this struct
    /// with nfc_min_age_seconds — for MVP they can share.
    pub min_age_seconds: u64,

    /// Root of the Poseidon Merkle tree of restricted (low, high) country
    /// code pairs. The same tree is used for both OCR and NFC paths since
    /// the country code comes from the document's MRZ in both cases.
    pub restricted_root: BytesN<32>,

    pub doc_max_age_seconds: u64,

    pub active: bool,

    /// Optional per-integrator NFC verification key override.
    /// None → use DEFAULT_NFC_VK from lib.rs.
    /// Some(vk_hash) → the integrator registered a custom NFC VK.
    ///
    /// Stored as a BytesN<32> hash of the full VerificationKey struct
    /// rather than the VK itself (too large for cheap persistent storage).
    /// The contract checks this hash against a supplied VK parameter
    /// when processing NFC proofs, same pattern as the OCR DEFAULT_VK.
    ///
    /// IMPLEMENTATION NOTE: if you never need per-integrator NFC VKs
    /// (all integrators share the same compiled NFC circuit), leave this
    /// as None for every integrator and ignore it — the contract just
    /// always uses DEFAULT_NFC_VK.
    pub nfc_vk_hash_override: Option<BytesN<32>>,
}