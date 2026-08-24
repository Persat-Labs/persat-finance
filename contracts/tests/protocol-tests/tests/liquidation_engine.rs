//! Pass 1 — runtime tests against the real compiled liquidation engine.
//!
//! Two properties decide whether this program can be trusted with user
//! collateral:
//!
//! * **It fails closed.** Every evaluation and every liquidation path reads
//!   the BTC/USD price through the oracle adapter's full validation. A stale
//!   price, a price for the wrong feed, a partially Wormhole-verified update,
//!   or a confidence band wider than 2% — each must block the action, because
//!   a liquidation executed on a bad price is irreversible.
//! * **The keeper has no discretion.** The keeper submits a position snapshot;
//!   the engine revalidates its thresholds, revalues the collateral against
//!   the verified price, and refuses anything the rules do not authorize —
//!   including partial liquidation of a position that must be wound down in
//!   full.
//!
//! The price updates are fabricated `PriceUpdateV2` accounts with the exact
//! discriminator, owner, and serialization the Pyth receiver would produce.
//! What cannot be faked in the fixture is what the tests assert: the receiver
//! program identity, the feed id, the verification level, freshness, and the
//! confidence bound are all enforced by the loaded programs at runtime.
//!
//! # Requires compiled programs
//!
//! Loads `target/deploy/liquidation_engine.so` and `target/deploy/price_oracle.so`.
//! CI sets `PERSAT_REQUIRE_PROGRAMS=1`; a missing program is a hard failure,
//! never a silent skip.

use anchor_lang::{AccountDeserialize, AnchorSerialize, Discriminator, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use pyth_solana_receiver_sdk::price_update::{
    get_feed_id_from_hex, PriceFeedMessage, PriceUpdateV2, VerificationLevel,
};
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

/// Paths to the compiled programs, relative to the contracts workspace root.
const ENGINE_SO: &str = "target/deploy/liquidation_engine.so";
const ORACLE_SO: &str = "target/deploy/price_oracle.so";

/// The wall time the fixture sets the chain clock to (2027-01-15).
const NOW: i64 = 1_800_000_000;

/// 0.5 BTC posted (8-decimal atoms); at $100k that is $50k of value.
const COLLATERAL_ATOMS: u64 = 50_000_000;
const COLLATERAL_VALUE_ATOMS: u64 = 50_000_000_000;

/// Pyth quote: $100,000.00 with exponent -8, confidence ±$50 (5bps).
const PRICE_MANTISSA: i64 = 10_000_000_000_000;
const PRICE_CONF: u64 = 5_000_000_000;
const PRICE_EXPONENT: i32 = -8;

/// Anchor error codes for [`liquidation_engine::LiquidationError`], in
/// declaration order (6000 is Anchor's error-code offset).
mod liquidation_error {
    pub const INVALID_AUTHORITY: u32 = 6000;
    pub const UNAUTHORIZED_GOVERNANCE: u32 = 6001;
    pub const ENGINE_PAUSED: u32 = 6002;
    pub const STALE_PRICE: u32 = 6003;
    pub const UNAUTHORIZED_ORACLE: u32 = 6004;
    pub const INVALID_THRESHOLDS: u32 = 6005;
    pub const POSITION_NOT_LIQUIDATABLE: u32 = 6007;
    pub const REQUIRES_FULL_LIQUIDATION: u32 = 6008;
    pub const NOTHING_TO_LIQUIDATE: u32 = 6009;
}

/// Locate a compiled program, or `None` if it has not been built.
fn program_bytes(path: &str) -> Option<Vec<u8>> {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest.parent()?.parent()?.join(path);
    std::fs::read(candidate).ok()
}

/// Skip with an explanatory message when a program has not been built.
macro_rules! require_program {
    ($path:expr) => {
        match program_bytes($path) {
            Some(bytes) => bytes,
            None if std::env::var("PERSAT_REQUIRE_PROGRAMS").is_ok() => {
                panic!(
                    "{} not found, but PERSAT_REQUIRE_PROGRAMS is set. The SBF \
                     build must run before the tests, otherwise these fail-closed \
                     checks silently pass without executing.",
                    $path
                );
            }
            None => {
                eprintln!("skipping: {} not found. Run `anchor build --ignore-keys` first.", $path);
                return;
            }
        }
    };
}

fn assert_failed_with(result: &std::result::Result<(), String>, code: u32) {
    match result {
        Ok(()) => panic!("expected failure with Custom({code}), but the transaction succeeded"),
        Err(e) => assert!(
            e.contains(&format!("Custom({code})")),
            "expected Custom({code}); got: {e}"
        ),
    }
}

fn btc_feed_id() -> [u8; 32] {
    get_feed_id_from_hex(price_oracle::BTC_USD_FEED_ID).expect("feed id parses")
}

/// The canonical protocol thresholds (tBTC/zBTC, per devnet.json).
fn position(debt_atoms: u64) -> liquidation_engine::PositionInput {
    liquidation_engine::PositionInput {
        deal_id: [7u8; 16],
        outstanding_debt_atoms: debt_atoms,
        collateral_atoms: COLLATERAL_ATOMS,
        collateral_decimals: 8,
        loan_decimals: 6,
        max_ltv_bps: 5_000,
        partial_liquidation_ltv_bps: 7_000,
        full_liquidation_ltv_bps: 8_000,
    }
}

/// 50% LTV at the fixture price — fully healthy.
fn healthy_position() -> liquidation_engine::PositionInput {
    position(25_000_000_000)
}

/// 75% LTV — past the partial threshold, below the full one.
fn partial_band_position() -> liquidation_engine::PositionInput {
    position(37_500_000_000)
}

/// 85% LTV — past the full-liquidation threshold.
fn full_band_position() -> liquidation_engine::PositionInput {
    position(42_500_000_000)
}

/// An engine + oracle fixture. Both programs are loaded and initialized
/// through their real entrypoints, so the oracle configuration the engine
/// trusts is byte-identical to what the oracle program itself would create.
struct Fixture {
    svm: LiteSVM,
    engine_id: Pubkey,
    oracle_id: Pubkey,
    payer: Keypair,
    governance: Keypair,
    keeper: Keypair,
    outsider: Keypair,
    oracle_pda: Pubkey,
    engine_pda: Pubkey,
}

impl Fixture {
    fn new(engine_bytes: &[u8], oracle_bytes: &[u8]) -> Self {
        let engine_id = Pubkey::new_from_array(liquidation_engine::ID.to_bytes());
        let oracle_id = Pubkey::new_from_array(price_oracle::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(engine_id, engine_bytes);
        svm.add_program(oracle_id, oracle_bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let governance = Keypair::new();
        let keeper = Keypair::new();
        let outsider = Keypair::new();
        for kp in [&governance, &keeper, &outsider] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }

        let (oracle_pda, _) = Pubkey::find_program_address(&[b"oracle"], &oracle_id);
        let (engine_pda, _) = Pubkey::find_program_address(&[b"liquidation-engine"], &engine_id);

        let mut fixture = Self {
            svm,
            engine_id,
            oracle_id,
            payer,
            governance,
            keeper,
            outsider,
            oracle_pda,
            engine_pda,
        };
        fixture.set_time(NOW);
        fixture
    }

    /// Initialize the oracle (60s staleness, 2% confidence bound) and the
    /// engine through their real entrypoints.
    fn full_setup(&mut self) {
        self.initialize_oracle().expect("oracle init");
        let governance = self.governance.pubkey();
        let oracle = self.oracle_pda;
        self.initialize_engine_with(&governance, &oracle).expect("engine init");
    }

    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    fn write_account(&mut self, address: Pubkey, data: Vec<u8>, owner: Pubkey) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(
                address,
                Account { lamports, data, owner, executable: false, rent_epoch: 0 },
            )
            .unwrap();
    }

    fn anchor_key(&self, key: &Pubkey) -> anchor_lang::prelude::Pubkey {
        anchor_lang::prelude::Pubkey::new_from_array(key.to_bytes())
    }

    fn send(
        &mut self,
        program_id: Pubkey,
        ix_data: Vec<u8>,
        accounts: Vec<(Pubkey, bool, bool)>,
        signers: &[&Keypair],
    ) -> std::result::Result<(), String> {
        let instruction = Instruction {
            program_id,
            accounts: accounts
                .into_iter()
                .map(|(pubkey, is_signer, is_writable)| solana_instruction::AccountMeta {
                    pubkey,
                    is_signer,
                    is_writable,
                })
                .collect(),
            data: ix_data,
        };
        let message = Message::new(&[instruction], Some(&self.payer.pubkey()));
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new(&all, message, self.svm.latest_blockhash());
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{e:?}"))
    }

    fn metas<A: ToAccountMetas>(&self, accounts: A) -> Vec<(Pubkey, bool, bool)> {
        accounts
            .to_account_metas(None)
            .into_iter()
            .map(|m| (Pubkey::new_from_array(m.pubkey.to_bytes()), m.is_signer, m.is_writable))
            .collect()
    }

    fn initialize_oracle(&mut self) -> std::result::Result<(), String> {
        let accounts = price_oracle::accounts::InitializeOracle {
            payer: self.anchor_key(&self.payer.pubkey()),
            oracle: self.anchor_key(&self.oracle_pda),
            system_program: anchor_lang::system_program::ID,
        };
        let data = price_oracle::instruction::InitializeOracle {
            governance: self.anchor_key(&self.governance.pubkey()),
            staleness_threshold_seconds: 60,
            max_confidence_bps: 200,
        }
        .data();
        let metas = self.metas(accounts);
        self.send(self.oracle_id, data, metas, &[])
    }

    fn initialize_engine_with(
        &mut self,
        governance: &Pubkey,
        oracle: &Pubkey,
    ) -> std::result::Result<(), String> {
        let accounts = liquidation_engine::accounts::InitializeEngine {
            payer: self.anchor_key(&self.payer.pubkey()),
            engine: self.anchor_key(&self.engine_pda),
            system_program: anchor_lang::system_program::ID,
        };
        let data = liquidation_engine::instruction::InitializeEngine {
            governance: self.anchor_key(governance),
            oracle: self.anchor_key(oracle),
        }
        .data();
        let metas = self.metas(accounts);
        self.send(self.engine_id, data, metas, &[])
    }

    fn set_paused_as(
        &mut self,
        who: &Keypair,
        paused: bool,
    ) -> std::result::Result<(), String> {
        let accounts = liquidation_engine::accounts::UpdateEngine {
            engine: self.anchor_key(&self.engine_pda),
            governance: self.anchor_key(&who.pubkey()),
        };
        let data = liquidation_engine::instruction::SetPaused { paused }.data();
        let metas = self.metas(accounts);
        self.send(self.engine_id, data, metas, &[who])
    }

    /// Fabricate a `PriceUpdateV2` exactly as the Pyth receiver would hold it:
    /// same discriminator, same owner, same borsh serialization.
    #[allow(clippy::too_many_arguments)]
    fn write_price_update(
        &mut self,
        feed_id: [u8; 32],
        mantissa: i64,
        conf: u64,
        publish_time: i64,
        verification_level: VerificationLevel,
    ) -> Pubkey {
        let update = PriceUpdateV2 {
            write_authority: anchor_lang::prelude::Pubkey::new_unique(),
            verification_level,
            price_message: PriceFeedMessage {
                feed_id,
                price: mantissa,
                conf,
                exponent: PRICE_EXPONENT,
                publish_time,
                prev_publish_time: publish_time - 1,
                ema_price: mantissa,
                ema_conf: conf,
            },
            posted_slot: 1,
        };
        let mut data = Vec::with_capacity(256);
        data.extend_from_slice(PriceUpdateV2::DISCRIMINATOR);
        update.serialize(&mut data).expect("price update serializes");
        let address = Keypair::new().pubkey();
        let owner = Pubkey::new_from_array(pyth_solana_receiver_sdk::ID.to_bytes());
        self.write_account(address, data, owner);
        address
    }

    /// A fresh, fully verified BTC/USD update at $100k.
    fn fresh_price_account(&mut self) -> Pubkey {
        self.write_price_update(
            btc_feed_id(),
            PRICE_MANTISSA,
            PRICE_CONF,
            NOW,
            VerificationLevel::Full,
        )
    }

    fn evaluate(
        &mut self,
        position: &liquidation_engine::PositionInput,
        price_update: &Pubkey,
    ) -> std::result::Result<(), String> {
        let accounts = liquidation_engine::accounts::Evaluate {
            engine: self.anchor_key(&self.engine_pda),
            caller: self.anchor_key(&self.outsider.pubkey()),
            oracle: self.anchor_key(&self.oracle_pda),
            price_update: self.anchor_key(price_update),
        };
        let data = liquidation_engine::instruction::Evaluate { position: *position }.data();
        let metas = self.metas(accounts);
        let outsider = self.outsider.insecure_clone();
        self.send(self.engine_id, data, metas, &[&outsider])
    }

    fn evaluate_through(
        &mut self,
        position: &liquidation_engine::PositionInput,
        price_update: &Pubkey,
        oracle: &Pubkey,
    ) -> std::result::Result<(), String> {
        let accounts = liquidation_engine::accounts::Evaluate {
            engine: self.anchor_key(&self.engine_pda),
            caller: self.anchor_key(&self.outsider.pubkey()),
            oracle: self.anchor_key(oracle),
            price_update: self.anchor_key(price_update),
        };
        let data = liquidation_engine::instruction::Evaluate { position: *position }.data();
        let metas = self.metas(accounts);
        let outsider = self.outsider.insecure_clone();
        self.send(self.engine_id, data, metas, &[&outsider])
    }

    fn execute_partial(
        &mut self,
        position: &liquidation_engine::PositionInput,
        price_update: &Pubkey,
        missed_payment_atoms: u64,
        penalty_bps: u16,
        max_partial_bps: u16,
    ) -> std::result::Result<(), String> {
        let accounts = liquidation_engine::accounts::ExecuteLiquidation {
            engine: self.anchor_key(&self.engine_pda),
            keeper: self.anchor_key(&self.keeper.pubkey()),
            oracle: self.anchor_key(&self.oracle_pda),
            price_update: self.anchor_key(price_update),
        };
        let data = liquidation_engine::instruction::ExecutePartialLiquidation {
            position: *position,
            missed_payment_atoms,
            penalty_bps,
            max_partial_bps,
        }
        .data();
        let metas = self.metas(accounts);
        let keeper = self.keeper.insecure_clone();
        self.send(self.engine_id, data, metas, &[&keeper])
    }

    fn execute_full(
        &mut self,
        position: &liquidation_engine::PositionInput,
        price_update: &Pubkey,
        terminal_default: bool,
    ) -> std::result::Result<(), String> {
        let accounts = liquidation_engine::accounts::ExecuteLiquidation {
            engine: self.anchor_key(&self.engine_pda),
            keeper: self.anchor_key(&self.keeper.pubkey()),
            oracle: self.anchor_key(&self.oracle_pda),
            price_update: self.anchor_key(price_update),
        };
        let data = liquidation_engine::instruction::ExecuteFullLiquidation {
            position: *position,
            terminal_default,
        }
        .data();
        let metas = self.metas(accounts);
        let keeper = self.keeper.insecure_clone();
        self.send(self.engine_id, data, metas, &[&keeper])
    }

    fn read_engine(&self) -> liquidation_engine::Engine {
        let account = self.svm.get_account(&self.engine_pda).expect("engine exists");
        liquidation_engine::Engine::try_deserialize(&mut account.data.as_slice())
            .expect("engine deserializes")
    }
}

// ---------------------------------------------------------------------------
// Initialization and governance
// ---------------------------------------------------------------------------

#[test]
fn the_engine_records_its_governance_and_oracle() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let engine = fixture.read_engine();
    assert_eq!(engine.governance.to_bytes(), fixture.governance.pubkey().to_bytes());
    assert_eq!(engine.oracle.to_bytes(), fixture.oracle_pda.to_bytes());
    assert!(!engine.paused, "the engine starts running");
}

#[test]
fn initialization_rejects_default_authorities() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);

    let oracle = fixture.oracle_pda;
    let governance = fixture.governance.pubkey();
    let result = fixture.initialize_engine_with(&Pubkey::default(), &oracle);
    assert_failed_with(&result, liquidation_error::INVALID_AUTHORITY);
    let result = fixture.initialize_engine_with(&governance, &Pubkey::default());
    assert_failed_with(&result, liquidation_error::INVALID_AUTHORITY);
}

#[test]
fn only_governance_can_pause_and_unpause_the_engine() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.set_paused_as(&outsider, true);
    assert_failed_with(&result, liquidation_error::UNAUTHORIZED_GOVERNANCE);
    assert!(!fixture.read_engine().paused);

    let governance = fixture.governance.insecure_clone();
    fixture.set_paused_as(&governance, true).expect("governance pauses");
    assert!(fixture.read_engine().paused);

    let result = fixture.set_paused_as(&outsider, false);
    assert_failed_with(&result, liquidation_error::UNAUTHORIZED_GOVERNANCE);

    fixture.set_paused_as(&governance, false).expect("governance unpauses");
    assert!(!fixture.read_engine().paused);
}

// ---------------------------------------------------------------------------
// Fail-closed price reading — the protocol's central oracle invariant
// ---------------------------------------------------------------------------

#[test]
fn a_fresh_fully_verified_price_supports_evaluation() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let price = fixture.fresh_price_account();
    fixture.evaluate(&healthy_position(), &price).expect("a fresh price evaluates");
}

#[test]
fn a_stale_price_blocks_every_price_dependent_action() {
    // The fail-closed invariant, asserted on all three outward paths. One
    // second past the 60s window is already too old.
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let stale = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        PRICE_CONF,
        NOW - 61,
        VerificationLevel::Full,
    );

    let result = fixture.evaluate(&healthy_position(), &stale);
    assert_failed_with(&result, liquidation_error::STALE_PRICE);
    let result = fixture.execute_partial(&partial_band_position(), &stale, 500_000_000, 500, 2_000);
    assert_failed_with(&result, liquidation_error::STALE_PRICE);
    let result = fixture.execute_full(&full_band_position(), &stale, false);
    assert_failed_with(&result, liquidation_error::STALE_PRICE);
}

#[test]
fn a_price_for_the_wrong_feed_blocks_evaluation() {
    // ETH/USD rather than BTC/USD: a correct-looking account carrying the
    // wrong asset's price must not value anyone's collateral.
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let eth_feed =
        get_feed_id_from_hex("0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace")
            .unwrap();
    let wrong_feed =
        fixture.write_price_update(eth_feed, 300_000_000000, 1_000_000_000, NOW, VerificationLevel::Full);

    let result = fixture.evaluate(&healthy_position(), &wrong_feed);
    assert_failed_with(&result, liquidation_error::STALE_PRICE);
}

#[test]
fn a_partially_wormhole_verified_update_blocks_evaluation() {
    // 13 guardian signatures looks like a quorum but is not a full one. The
    // protocol requires full verification exactly because near-verified is
    // the shape a forged update would take.
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let partial = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        PRICE_CONF,
        NOW,
        VerificationLevel::Partial { num_signatures: 13 },
    );
    let result = fixture.evaluate(&healthy_position(), &partial);
    assert_failed_with(&result, liquidation_error::STALE_PRICE);
}

#[test]
fn an_uncertain_price_blocks_evaluation() {
    // A confidence band of ±5% of the price exceeds the configured 2% bound:
    // when the publishers themselves disagree, the protocol declines to act.
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let uncertain = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        PRICE_MANTISSA as u64 / 20, // 5% confidence band
        NOW,
        VerificationLevel::Full,
    );
    let result = fixture.evaluate(&healthy_position(), &uncertain);
    assert_failed_with(&result, liquidation_error::STALE_PRICE);
}

#[test]
fn a_substitute_oracle_configuration_is_rejected() {
    // A byte-copy of the real, benign oracle configuration at a different
    // address: the engine must decline anything except the one configuration
    // it was initialized with.
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let real = fixture.svm.get_account(&fixture.oracle_pda).unwrap();
    let substitute = Keypair::new().pubkey();
    fixture
        .svm
        .set_account(
            substitute,
            Account {
                lamports: real.lamports,
                data: real.data.clone(),
                owner: real.owner,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let price = fixture.fresh_price_account();
    let result = fixture.evaluate_through(&healthy_position(), &price, &substitute);
    assert_failed_with(&result, liquidation_error::UNAUTHORIZED_ORACLE);
}

#[test]
fn a_paused_engine_refuses_all_work() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();
    let governance = fixture.governance.insecure_clone();
    fixture.set_paused_as(&governance, true).unwrap();

    let price = fixture.fresh_price_account();
    let result = fixture.evaluate(&healthy_position(), &price);
    assert_failed_with(&result, liquidation_error::ENGINE_PAUSED);
    let result = fixture.execute_partial(&partial_band_position(), &price, 500_000_000, 500, 2_000);
    assert_failed_with(&result, liquidation_error::ENGINE_PAUSED);
    let result = fixture.execute_full(&full_band_position(), &price, false);
    assert_failed_with(&result, liquidation_error::ENGINE_PAUSED);
}

// ---------------------------------------------------------------------------
// Liquidation authorization — the keeper has no discretion
// ---------------------------------------------------------------------------

#[test]
fn a_healthy_position_cannot_be_partially_liquidated() {
    // A missed payment alone never authorizes seizure: the position's health
    // must actually be past the partial threshold.
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let price = fixture.fresh_price_account();
    let result = fixture.execute_partial(&healthy_position(), &price, 500_000_000, 500, 2_000);
    assert_failed_with(&result, liquidation_error::POSITION_NOT_LIQUIDATABLE);
}

#[test]
fn a_partial_liquidation_authorized_within_the_cap_succeeds() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    // Cross-check the authorization arithmetic against the shared, fuzzed
    // math: a $500 missed payment plus the 5% penalty is $525 of collateral.
    let seize = persat_core::liquidation::partial_liquidation_amount(
        500_000_000,
        500,
        COLLATERAL_ATOMS,
        COLLATERAL_VALUE_ATOMS,
        2_000,
    )
    .expect("computable");
    assert_eq!(seize, 525_000);
    assert!(seize <= COLLATERAL_ATOMS / 5, "well inside the 20% policy cap");

    let price = fixture.fresh_price_account();
    fixture
        .execute_partial(&partial_band_position(), &price, 500_000_000, 500, 2_000)
        .expect("a compliant partial liquidation is authorized");
}

#[test]
fn a_partial_liquidation_without_a_missed_payment_is_rejected() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let price = fixture.fresh_price_account();
    let result = fixture.execute_partial(&partial_band_position(), &price, 0, 500, 2_000);
    assert_failed_with(&result, liquidation_error::NOTHING_TO_LIQUIDATE);
}

#[test]
fn a_fully_liquidatable_position_must_use_the_full_path() {
    // Whittling an 85% position down one 20% seizure at a time would leave the
    // lender exposed between calls; the full path is mandatory here.
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    let price = fixture.fresh_price_account();
    let result = fixture.execute_partial(&full_band_position(), &price, 500_000_000, 500, 2_000);
    assert_failed_with(&result, liquidation_error::REQUIRES_FULL_LIQUIDATION);
}

#[test]
fn full_liquidation_is_authorized_only_on_threshold_or_terminal_default() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    // A healthy position with no default: nobody can force it closed.
    let price = fixture.fresh_price_account();
    let result = fixture.execute_full(&healthy_position(), &price, false);
    assert_failed_with(&result, liquidation_error::POSITION_NOT_LIQUIDATABLE);

    // The same healthy position *after* a terminal default is wind-down
    // eligible — this is the exhausted-grace-window case.
    fixture.svm.expire_blockhash();
    fixture
        .execute_full(&healthy_position(), &price, true)
        .expect("a terminally defaulted position is fully liquidatable");

    // And a position past the full threshold needs no default at all.
    fixture.svm.expire_blockhash();
    fixture
        .execute_full(&full_band_position(), &price, false)
        .expect("an 85% LTV position is fully liquidatable");
}

#[test]
fn malformed_risk_thresholds_are_rejected_before_any_valuation() {
    let engine_bytes = require_program!(ENGINE_SO);
    let oracle_bytes = require_program!(ORACLE_SO);
    let mut fixture = Fixture::new(&engine_bytes, &oracle_bytes);
    fixture.full_setup();

    // A keeper presenting thresholds that violate the protocol's ordering —
    // here partial equal to max — must not steer the engine.
    let mut malformed = healthy_position();
    malformed.partial_liquidation_ltv_bps = malformed.max_ltv_bps;

    let price = fixture.fresh_price_account();
    let result = fixture.evaluate(&malformed, &price);
    assert_failed_with(&result, liquidation_error::INVALID_THRESHOLDS);
}
