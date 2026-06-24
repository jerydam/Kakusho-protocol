use soroban_sdk::{contracttype, Address, BytesN};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Integrator(BytesN<32>),
    Nullifier(BytesN<32>, BytesN<32>),
}

#[derive(Clone)]
#[contracttype]
pub struct IntegratorConfig {
    pub owner: Address,
    pub min_age_seconds: u64,
    pub restricted_root: BytesN<32>,
    pub doc_max_age_seconds: u64,
    pub active: bool,
}
