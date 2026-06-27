#![no_std]

// groth16_verifier — same Groth16 pairing-check math as your original
// verifier.rs, generalized in ONE way: the verifying key is a function
// argument (`VerificationKey`), not a module-level hardcoded constant.
//
// Why this changed from your original design: in a single-purpose KYC
// contract, baking the VK in as constants was correct — there was only
// ever one VK. In the B2B2C protocol, kyc_registry needs to verify
// proofs using EITHER the shared DEFAULT_VK (the common case — see
// kyc_registry's lib.rs for where that constant now lives) OR, in the
// future, a per-integrator custom_vk if you outgrow the global-circuit
// model for a specific integrator. Making verify_proof take the VK as
// an argument means this crate doesn't need to change at all when that
// day comes — kyc_registry decides which VK to pass in, this crate just
// checks the pairing equation against whichever one it's given.
//
// This crate is intentionally "dumb" — it knows nothing about
// integrators, nullifiers, or registries. It does exactly one thing:
// Groth16 verification. Keeping it this narrow makes it the easiest
// part of the whole protocol to audit.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    MalformedVerifyingKey = 0,
    PublicInputCountMismatch = 1,
}

#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: Bn254G1Affine,
    pub beta: Bn254G2Affine,
    pub gamma: Bn254G2Affine,
    pub delta: Bn254G2Affine,
    pub ic: Vec<Bn254G1Affine>,
}

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Verifies a Groth16 proof against the supplied verifying key and
    /// public inputs. Returns Ok(true)/Ok(false) for a structurally
    /// valid request; Err only for malformed inputs (e.g. IC length not
    /// matching public input count), which callers should treat as a
    /// hard rejection, never as "proof might still be valid."
    pub fn verify_proof(
        env: Env,
        vk: VerificationKey,
        proof: Proof,
        pub_signals: Vec<Bn254Fr>,
    ) -> Result<bool, Groth16Error> {
        let bn = env.crypto().bn254();

        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(Groth16Error::PublicInputCountMismatch);
        }

        let mut vk_x = vk.ic.get(0).unwrap();
        for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let prod = bn.g1_mul(&v, &s);
            vk_x = bn.g1_add(&vk_x, &prod);
        }

        let neg_a = -proof.a;
        let vp1 = soroban_sdk::vec![&env, neg_a, vk.alpha, vk_x, proof.c];
        let vp2 = soroban_sdk::vec![&env, proof.b, vk.beta, vk.gamma, vk.delta];

        Ok(bn.pairing_check(vp1, vp2))
    }
}

#[cfg(test)]
mod test;
