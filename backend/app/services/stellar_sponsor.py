"""
stellar_sponsor.py — submits a verified proof to kyc_registry.verify()
on Soroban, paying the transaction fee from this service's sponsor
account instead of requiring the end user to hold XLM.

HOW SPONSORSHIP ACTUALLY WORKS HERE — read before deploying:
kyc_registry.verify() doesn't require the calling account to BE the
user; it just needs a valid proof + the right arguments, and Soroban
auth only kicks in for functions that call require_auth() (registration
and rule-update calls do; verify() does NOT — check
contracts/kyc_registry/src/lib.rs, verify() has no require_auth call).
That means this is the SIMPLE sponsorship case: the relayer's own
keypair signs and pays for a transaction that calls verify() with
whatever proof bytes the integrator's frontend forwarded.

This is NOT the complex "fee-bump a transaction the user partially
signed" pattern your original KYC Passport project's contract.py sketch
described for mint_sbt-style calls that DO need to run as the user
(e.g. if you later add a function that mints something to the caller's
own address and therefore needs their require_auth). If you add such a
function later, this module's submit_verification() function is NOT
sufficient for it — you'd need real auth-entry construction
(stellar_sdk's authorize_entry helper) the way the original sketch
flagged as unfinished. Don't copy this module's pattern for that case
without revisiting it.
"""
from stellar_sdk import Keypair, TransactionBuilder, Network, SorobanServer, scval
from stellar_sdk.exceptions import PrepareTransactionException
from app.core.config import settings
from loguru import logger
from typing import Optional
from dataclasses import dataclass


def get_soroban_server() -> SorobanServer:
    return SorobanServer(settings.STELLAR_RPC_URL)


def get_network_passphrase() -> str:
    return (
        Network.TESTNET_NETWORK_PASSPHRASE
        if settings.STELLAR_NETWORK == "testnet"
        else Network.PUBLIC_NETWORK_PASSPHRASE
    )


@dataclass
class SubmissionResult:
    success: bool
    tx_hash: Optional[str]
    verified: Optional[bool]  # the contract's own true/false return value, distinct from tx success
    error: Optional[str]


def _bytes32_scval(hex_str: str):
    raw = bytes.fromhex(hex_str.removeprefix("0x"))
    if len(raw) != 32:
        raise ValueError(f"expected 32 bytes, got {len(raw)}")
    return scval.to_bytes(raw)


def _bytesn_scval(hex_str: str, n: int):
    raw = bytes.fromhex(hex_str.removeprefix("0x"))
    if len(raw) != n:
        raise ValueError(f"expected {n} bytes, got {len(raw)}")
    return scval.to_bytes(raw)


def _public_signals_scval(public_signals_hex: list[str]):
    """
    Converts 5 hex-encoded 32-byte field elements into the Vec<Bn254Fr>
    ScVal shape kyc_registry.verify() expects.

    NOT VERIFIED against a live stellar-sdk install from this
    environment — Bn254Fr's exact ScVal constructor in the Python SDK
    (scval module) may differ from what's sketched here. The Rust side
    of this protocol (contracts/kyc_registry) has the same caveat about
    unverified Bn254Fr API surface — see that file's comments. Before
    relying on this in production, build one real test transaction
    against a local Soroban testnet and confirm the encoding round-trips
    correctly; do not assume this function is correct as written.
    """
    raise NotImplementedError(
        "Bn254Fr ScVal encoding not yet verified against a real stellar-sdk "
        "install — see this function's docstring. Implement and test against "
        "a local/testnet Soroban instance before using submit_verification() "
        "for anything beyond initial integration testing."
    )


async def submit_verification(
    integrator_id_hex: str,
    nullifier_hex: str,
    current_timestamp: int,
    proof_a_hex: str,
    proof_b_hex: str,
    proof_c_hex: str,
    public_signals_hex: list[str],
) -> SubmissionResult:
    """
    Submits a proof to kyc_registry.verify(), paying fees from
    SPONSOR_STELLAR_SECRET. Returns SubmissionResult — `success`
    reflects whether the TRANSACTION succeeded (was included on-chain
    without erroring); `verified` reflects the CONTRACT's own boolean
    return value (whether the proof actually checked out). These are
    different things: a transaction can succeed while verify() legitimately
    returns false (e.g. a structurally valid but cryptographically
    invalid proof) — callers (routes_proof.py) must check BOTH fields,
    not just `success`, before treating a user as KYC-verified.
    """
    if not settings.SPONSOR_STELLAR_SECRET:
        return SubmissionResult(
            success=False, tx_hash=None, verified=None,
            error="No sponsor secret configured",
        )

    try:
        server = get_soroban_server()
        sponsor_kp = Keypair.from_secret(settings.SPONSOR_STELLAR_SECRET)
        source = server.load_account(sponsor_kp.public_key)

        args = [
            _bytes32_scval(integrator_id_hex),
            _bytes32_scval(nullifier_hex),
            scval.to_uint64(current_timestamp),
            _bytesn_scval(proof_a_hex, 64),
            _bytesn_scval(proof_b_hex, 128),
            _bytesn_scval(proof_c_hex, 64),
            _public_signals_scval(public_signals_hex),
        ]

        tx = (
            TransactionBuilder(
                source_account=source,
                network_passphrase=get_network_passphrase(),
                base_fee=10_000,
            )
            .add_time_bounds(0, 0)
            .append_invoke_contract_function_op(
                contract_id=settings.KYC_REGISTRY_CONTRACT_ID,
                function_name="verify",
                parameters=args,
            )
            .build()
        )

        prepared = server.prepare_transaction(tx)
        prepared.sign(sponsor_kp)

        send_resp = server.send_transaction(prepared)
        logger.info(f"kyc_registry.verify submitted: {send_resp.hash}")

        # NOTE: send_transaction returns immediately after the tx is
        # accepted into the pending pool, NOT after it's confirmed.
        # routes_proof.py is responsible for polling get_transaction()
        # (or having the caller poll) to learn the actual outcome —
        # this function intentionally doesn't block on confirmation,
        # since that can take several seconds and shouldn't hold open
        # an HTTP request/connection slot while it does.
        return SubmissionResult(
            success=True, tx_hash=send_resp.hash, verified=None,
            error=None,
        )

    except NotImplementedError as e:
        return SubmissionResult(success=False, tx_hash=None, verified=None, error=str(e))
    except (PrepareTransactionException, ValueError) as e:
        logger.error(f"Soroban tx prep/encoding failed: {e}")
        return SubmissionResult(success=False, tx_hash=None, verified=None, error=str(e))
    except Exception as e:
        logger.error(f"verify() submission error: {e}")
        return SubmissionResult(success=False, tx_hash=None, verified=None, error=str(e))


async def poll_transaction_result(tx_hash: str) -> Optional[bool]:
    """
    Polls Soroban RPC for a submitted transaction's outcome and, if
    confirmed, decodes kyc_registry.verify()'s boolean return value.

    NOT YET IMPLEMENTED — depends on the same unverified ScVal decoding
    concerns as _public_signals_scval above. Sketch: call
    server.get_transaction(tx_hash) in a loop with backoff until status
    is no longer PENDING, then scval.from_bool() the result's return
    value if status is SUCCESS.
    """
    raise NotImplementedError(
        "Transaction polling + result decoding not yet implemented — see docstring."
    )