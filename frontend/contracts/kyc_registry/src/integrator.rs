use crate::storage::{DataKey, IntegratorConfig};
use soroban_sdk::{Address, BytesN, Env};

pub fn register_integrator(
    env: &Env,
    integrator_id: BytesN<32>,
    owner: Address,
    min_age_seconds: u64,
    restricted_root: BytesN<32>,
    doc_max_age_seconds: u64,
) {
    owner.require_auth();
    let key = DataKey::Integrator(integrator_id.clone());
    if env.storage().persistent().has(&key) {
        panic!("integrator_id already registered");
    }
    let config = IntegratorConfig {
        owner,
        min_age_seconds,
        restricted_root,
        doc_max_age_seconds,
        active: true,
    };
    env.storage().persistent().set(&key, &config);
}

pub fn update_integrator_rules(
    env: &Env,
    integrator_id: BytesN<32>,
    min_age_seconds: u64,
    restricted_root: BytesN<32>,
    doc_max_age_seconds: u64,
) {
    let key = DataKey::Integrator(integrator_id);
    let mut config: IntegratorConfig = env
        .storage()
        .persistent()
        .get(&key)
        .expect("integrator not found");
    config.owner.require_auth();
    config.min_age_seconds = min_age_seconds;
    config.restricted_root = restricted_root;
    config.doc_max_age_seconds = doc_max_age_seconds;
    env.storage().persistent().set(&key, &config);
}

pub fn set_active(env: &Env, integrator_id: BytesN<32>, active: bool) {
    let key = DataKey::Integrator(integrator_id);
    let mut config: IntegratorConfig = env
        .storage()
        .persistent()
        .get(&key)
        .expect("integrator not found");
    config.owner.require_auth();
    config.active = active;
    env.storage().persistent().set(&key, &config);
}

pub fn get_integrator(env: &Env, integrator_id: BytesN<32>) -> IntegratorConfig {
    env.storage()
        .persistent()
        .get(&DataKey::Integrator(integrator_id))
        .expect("integrator not found")
}
