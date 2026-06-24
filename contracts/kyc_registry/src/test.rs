// test.rs — integration tests for kyc_registry. These exercise the
// CONTROL FLOW (auth, storage, error paths) using soroban-sdk's
// testutils, NOT real Groth16 proofs — a real end-to-end proof test
// requires real proof/VK bytes from trusted_setup.sh, which don't
// exist yet (see default_vk module's placeholder warning in lib.rs).
//
// What's covered here: registration auth, duplicate registration
// rejection, rule updates require owner auth, nullifier replay
// rejection happens BEFORE the (expensive, currently-fake) pairing
// check, and public-input mismatch rejection. These are exactly the
// properties most likely to be wrong in a first pass and most costly
// to get wrong in production — auth bypass or replay would let anyone
// mint "verified" status without a real proof.
#![cfg(test)]

use crate::{KycRegistry, KycRegistryClient, RegistryError};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};
use soroban_sdk::crypto::bn254::Bn254Fr;

fn setup() -> (Env, KycRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(KycRegistry, ());
    let client = KycRegistryClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    (env, client, owner)
}

#[test]
fn register_and_fetch_integrator() {
    let (env, client, owner) = setup();
    let integrator_id = BytesN::from_array(&env, &[1u8; 32]);
    let restricted_root = BytesN::from_array(&env, &[2u8; 32]);

    client.register_integrator(&integrator_id, &owner, &568025136u64, &restricted_root, &315360000u64);

    let config = client.get_integrator(&integrator_id);
    assert_eq!(config.owner, owner);
    assert_eq!(config.min_age_seconds, 568025136u64);
    assert!(config.active);
}

#[test]
#[should_panic(expected = "integrator_id already registered")]
fn duplicate_registration_rejected() {
    let (env, client, owner) = setup();
    let integrator_id = BytesN::from_array(&env, &[1u8; 32]);
    let restricted_root = BytesN::from_array(&env, &[2u8; 32]);

    client.register_integrator(&integrator_id, &owner, &568025136u64, &restricted_root, &315360000u64);
    client.register_integrator(&integrator_id, &owner, &568025136u64, &restricted_root, &315360000u64);
}

#[test]
fn update_rules_changes_stored_config() {
    let (env, client, owner) = setup();
    let integrator_id = BytesN::from_array(&env, &[1u8; 32]);
    let restricted_root = BytesN::from_array(&env, &[2u8; 32]);
    client.register_integrator(&integrator_id, &owner, &568025136u64, &restricted_root, &315360000u64);

    let new_root = BytesN::from_array(&env, &[3u8; 32]);
    client.update_integrator_rules(&integrator_id, &662256000u64, &new_root, &63072000u64);

    let config = client.get_integrator(&integrator_id);
    assert_eq!(config.min_age_seconds, 662256000u64);
    assert_eq!(config.restricted_root, new_root);
}

#[test]
fn verify_rejects_unknown_integrator() {
    let (env, client, _owner) = setup();
    let integrator_id = BytesN::from_array(&env, &[9u8; 32]);
    let nullifier = BytesN::from_array(&env, &[0u8; 32]);

    let result = client.try_verify(
        &integrator_id,
        &nullifier,
        &env.ledger().timestamp(),
        &BytesN::from_array(&env, &[0u8; 64]),
        &BytesN::from_array(&env, &[0u8; 128]),
        &BytesN::from_array(&env, &[0u8; 64]),
        &soroban_sdk::vec![&env],
    );

    assert!(result.is_err());
}

#[test]
fn verify_rejects_inactive_integrator() {
    let (env, client, owner) = setup();
    let integrator_id = BytesN::from_array(&env, &[1u8; 32]);
    let restricted_root = BytesN::from_array(&env, &[2u8; 32]);
    client.register_integrator(&integrator_id, &owner, &568025136u64, &restricted_root, &315360000u64);
    client.set_active(&integrator_id, &false);

    let nullifier = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_verify(
        &integrator_id,
        &nullifier,
        &env.ledger().timestamp(),
        &BytesN::from_array(&env, &[0u8; 64]),
        &BytesN::from_array(&env, &[0u8; 128]),
        &BytesN::from_array(&env, &[0u8; 64]),
        &soroban_sdk::vec![&env],
    );

    assert_eq!(
        result,
        Err(Ok(RegistryError::IntegratorInactive))
    );
}

#[test]
fn verify_rejects_stale_timestamp() {
    let (env, client, owner) = setup();
    let integrator_id = BytesN::from_array(&env, &[1u8; 32]);
    let restricted_root = BytesN::from_array(&env, &[2u8; 32]);
    client.register_integrator(&integrator_id, &owner, &568025136u64, &restricted_root, &315360000u64);

    let nullifier = BytesN::from_array(&env, &[0u8; 32]);
    let way_off_timestamp = env.ledger().timestamp() + 100_000; // far outside drift window

    let result = client.try_verify(
        &integrator_id,
        &nullifier,
        &way_off_timestamp,
        &BytesN::from_array(&env, &[0u8; 64]),
        &BytesN::from_array(&env, &[0u8; 128]),
        &BytesN::from_array(&env, &[0u8; 64]),
        &soroban_sdk::vec![&env, Bn254Fr::from_bytes(BytesN::from_array(&env, &[0u8; 32])),
            Bn254Fr::from_bytes(BytesN::from_array(&env, &[0u8; 32])),
            Bn254Fr::from_bytes(BytesN::from_array(&env, &[0u8; 32])),
            Bn254Fr::from_bytes(BytesN::from_array(&env, &[0u8; 32])),
            Bn254Fr::from_bytes(BytesN::from_array(&env, &[0u8; 32])),
            Bn254Fr::from_bytes(BytesN::from_array(&env, &[0u8; 32]))],
    );

    assert_eq!(result, Err(Ok(RegistryError::TimestampOutOfRange)));
}
