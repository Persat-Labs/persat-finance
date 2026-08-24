//! Pass 1 — runtime tests against the real compiled price oracle adapter.
//!
//! The adapter stores policy, not prices, so its runtime obligations are:
//! validate configuration bounds at initialization, accept only a fresh,
//! fully-verified, BTC/USD update from the real receiver program, and refuse
//! everything else — in the oracle program's own error codes (unlike the
//! liquidation engine, which deliberately collapses every read failure to
//! `StalePrice`; the adapter's direct reader exposes the precise reason).
//!
//! Price fixtures are fabricated `PriceUpdateV2` accounts: exact receiver
//! owner, discriminator, and serialization — while staleness, feed identity,
//! verification level, sign, exponent, and the confidence band all vary under
//! test.
//!
//! # Requires a compiled program
//!
//! Loads `target/deploy/price_oracle.so`. CI sets `PERSAT_REQUIRE_PROGRAMS=1`;
//! a missing program is a hard failure, never a silent skip.

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

/// Path to the compiled program, relative to the contracts workspace root.
const PROGRAM_SO: &str = "target/deploy/price_oracle.so";

/// The wall time the fixture sets the chain clock to (2027-01-15).
const NOW: i64 = 1_800_000_000;

/// Pyth quote: $100,000.00 with exponent -8, confidence ±$50 (5bps).
const PRICE_MANTISSA: i64 = 10_000_000_000_000;
const PRICE_CONF: u64 = 5_000_000_000;
const PRICE_EXPONENT: i32 = -8;

/// Anchor error codes for [`price_oracle::OracleError`], in declaration order
/// (6000 is Anchor's error-code offset).
mod oracle_error {
    pub const INVALID_AUTHORITY: u32 = 6000;
    pub const UNAUTHORIZED_GOVERNANCE: u32 = 6002;
    pub const INVALID_STALENESS_THRESHOLD: u32 = 6003;
    pub const INVALID_CONFIDENCE_BOUND: u32 = 6004;
    pub const ORACLE_PAUSED: u32 = 6005;
    pub const STALE_PRICE: u32 = 6006;
    pub const INSUFFICIENT_VERIFICATION: u32 = 6007;
    pub const INVALID_PRICE: u32 = 6008;
    pub const UNSUPPORTED_EXPONENT: u32 = 6009;
    pub const CONFIDENCE_TOO_WIDE: u32 = 6010;
}

/// Locate the compiled program, or `None` if it has not been built.
fn program_bytes() -> Option<Vec<u8>> {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest.parent()?.parent()?.join(PROGRAM_SO);
    std::fs::read(candidate).ok()
}

/// Skip with an explanatory message when the program has not been built.
macro_rules! require_program {
    () => {
        match program_bytes() {
            Some(bytes) => bytes,
            None if std::env::var("PERSAT_REQUIRE_PROGRAMS").is_ok() => {
                panic!(
                    "{PROGRAM_SO} not found, but PERSAT_REQUIRE_PROGRAMS is set. \
                     The SBF build must run before the tests, otherwise these \
                     fail-closed checks silently pass without executing."
                );
            }
            None => {
                eprintln!(
                    "skipping: {PROGRAM_SO} not found. Run `anchor build --ignore-keys` first."
                );
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

/// Oracle fixture: governance and an outsider, the singleton PDA, and helpers
/// to fabricate receiver-owned price updates.
struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,
    governance: Keypair,
    outsider: Keypair,
    oracle_pda: Pubkey,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let program_id = Pubkey::new_from_array(price_oracle::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let governance = Keypair::new();
        let outsider = Keypair::new();
        for kp in [&governance, &outsider] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }
        let (oracle_pda, _) = Pubkey::find_program_address(&[b"oracle"], &program_id);

        let mut fixture =
            Self { svm, program_id, payer, governance, outsider, oracle_pda };
        fixture.set_time(NOW);
        fixture
    }

    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    fn anchor_key(&self, key: &Pubkey) -> anchor_lang::prelude::Pubkey {
        anchor_lang::prelude::Pubkey::new_from_array(key.to_bytes())
    }

    fn send(
        &mut self,
        instruction: Instruction,
        signers: &[&Keypair],
    ) -> std::result::Result<(), String> {
        let message = Message::new(&[instruction], Some(&self.payer.pubkey()));
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new(&all, message, self.svm.latest_blockhash());
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{e:?}"))
    }

    fn instruction<A: ToAccountMetas, D: InstructionData>(
        &self,
        accounts: A,
        data: D,
    ) -> Instruction {
        let metas = accounts.to_account_metas(None);
        Instruction {
            program_id: self.program_id,
            accounts: metas
                .into_iter()
                .map(|m| solana_instruction::AccountMeta {
                    pubkey: Pubkey::new_from_array(m.pubkey.to_bytes()),
                    is_signer: m.is_signer,
                    is_writable: m.is_writable,
                })
                .collect(),
            data: data.data(),
        }
    }

    /// Initialize with explicit parameters so boundary values are testable.
    fn initialize_with(
        &mut self,
        governance: &Pubkey,
        staleness_seconds: u32,
        max_confidence_bps: u64,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            price_oracle::accounts::InitializeOracle {
                payer: self.anchor_key(&self.payer.pubkey()),
                oracle: self.anchor_key(&self.oracle_pda),
                system_program: anchor_lang::system_program::ID,
            },
            price_oracle::instruction::InitializeOracle {
                governance: self.anchor_key(governance),
                staleness_threshold_seconds: staleness_seconds,
                max_confidence_bps,
            },
        );
        self.send(ix, &[])
    }

    fn initialize(&mut self) -> std::result::Result<(), String> {
        let governance = self.governance.pubkey();
        self.initialize_with(&governance, 60, 200)
    }

    /// Fabricate a receiver-owned price update with full control over every
    /// validated dimension.
    fn write_price_update(
        &mut self,
        feed_id: [u8; 32],
        mantissa: i64,
        conf: u64,
        exponent: i32,
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
                exponent,
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
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(
                address,
                Account { lamports, data, owner, executable: false, rent_epoch: 0 },
            )
            .unwrap();
        address
    }

    fn fresh_price_account(&mut self) -> Pubkey {
        self.write_price_update(
            btc_feed_id(),
            PRICE_MANTISSA,
            PRICE_CONF,
            PRICE_EXPONENT,
            NOW,
            VerificationLevel::Full,
        )
    }

    fn read_btc_usd(&mut self, price_update: &Pubkey) -> std::result::Result<(), String> {
        let ix = self.instruction(
            price_oracle::accounts::ReadPrice {
                oracle: self.anchor_key(&self.oracle_pda),
                price_update: self.anchor_key(price_update),
            },
            price_oracle::instruction::ReadBtcUsd {},
        );
        self.send(ix, &[])
    }

    fn set_paused_as(&mut self, who: &Keypair, paused: bool) -> std::result::Result<(), String> {
        let ix = self.instruction(
            price_oracle::accounts::UpdateOracle {
                oracle: self.anchor_key(&self.oracle_pda),
                governance: self.anchor_key(&who.pubkey()),
            },
            price_oracle::instruction::SetPaused { paused },
        );
        self.send(ix, &[who])
    }

    fn set_staleness_as(&mut self, who: &Keypair, seconds: u32) -> std::result::Result<(), String> {
        let ix = self.instruction(
            price_oracle::accounts::UpdateOracle {
                oracle: self.anchor_key(&self.oracle_pda),
                governance: self.anchor_key(&who.pubkey()),
            },
            price_oracle::instruction::SetStalenessThreshold { seconds },
        );
        self.send(ix, &[who])
    }

    fn read_oracle(&self) -> price_oracle::OracleConfig {
        let account = self.svm.get_account(&self.oracle_pda).expect("oracle exists");
        price_oracle::OracleConfig::try_deserialize(&mut account.data.as_slice())
            .expect("oracle deserializes")
    }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

#[test]
fn the_oracle_records_its_policy_on_initialization() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let oracle = fixture.read_oracle();
    assert_eq!(oracle.governance.to_bytes(), fixture.governance.pubkey().to_bytes());
    assert_eq!(oracle.feed_id, btc_feed_id(), "bound to BTC/USD and nothing else");
    assert_eq!(oracle.staleness_threshold_seconds, 60);
    assert_eq!(oracle.max_confidence_bps, 200);
    assert!(!oracle.paused);
}

#[test]
fn initialization_enforces_its_configuration_bounds() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let governance = fixture.governance.pubkey();

    // Default governance.
    let result = fixture.initialize_with(&Pubkey::default(), 60, 200);
    assert_failed_with(&result, oracle_error::INVALID_AUTHORITY);

    // Staleness below the floor would jam the protocol on network jitter;
    // above the ceiling is not a meaningful price for a volatile asset.
    let result = fixture.initialize_with(&governance, 29, 200);
    assert_failed_with(&result, oracle_error::INVALID_STALENESS_THRESHOLD);
    let result = fixture.initialize_with(&governance, 3_601, 200);
    assert_failed_with(&result, oracle_error::INVALID_STALENESS_THRESHOLD);

    // The confidence bound must be meaningful and must not be loosened
    // beyond 10% even by governance.
    let result = fixture.initialize_with(&governance, 60, 0);
    assert_failed_with(&result, oracle_error::INVALID_CONFIDENCE_BOUND);
    let result = fixture.initialize_with(&governance, 60, 1_001);
    assert_failed_with(&result, oracle_error::INVALID_CONFIDENCE_BOUND);

    // Boundary values on both sides are accepted.
    fixture.svm.expire_blockhash();
    fixture.initialize_with(&governance, 30, 1_000).expect("the tight boundary is valid");
}

// ---------------------------------------------------------------------------
// The fail-closed read
// ---------------------------------------------------------------------------

#[test]
fn a_fresh_fully_verified_update_reads_cleanly() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let price = fixture.fresh_price_account();
    fixture.read_btc_usd(&price).expect("a good update reads");
}

#[test]
fn a_stale_update_is_rejected_exactly_at_the_window_edge() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    // 60 seconds old: exactly at the configured window, still fresh.
    let fresh_edge = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        PRICE_CONF,
        PRICE_EXPONENT,
        NOW - 60,
        VerificationLevel::Full,
    );
    fixture.read_btc_usd(&fresh_edge).expect("at the edge is still fresh");

    // 61 seconds: one second too old.
    let stale = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        PRICE_CONF,
        PRICE_EXPONENT,
        NOW - 61,
        VerificationLevel::Full,
    );
    let result = fixture.read_btc_usd(&stale);
    assert_failed_with(&result, oracle_error::STALE_PRICE);
}

#[test]
fn an_update_for_the_wrong_feed_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let eth_feed =
        get_feed_id_from_hex("0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace")
            .unwrap();
    let wrong = fixture.write_price_update(
        eth_feed,
        300_000_000000,
        1_000_000_000,
        PRICE_EXPONENT,
        NOW,
        VerificationLevel::Full,
    );
    let result = fixture.read_btc_usd(&wrong);
    assert_failed_with(&result, oracle_error::STALE_PRICE);
}

#[test]
fn a_partially_verified_update_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let partial = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        PRICE_CONF,
        PRICE_EXPONENT,
        NOW,
        VerificationLevel::Partial { num_signatures: 13 },
    );
    let result = fixture.read_btc_usd(&partial);
    assert_failed_with(&result, oracle_error::INSUFFICIENT_VERIFICATION);
}

#[test]
fn a_zero_or_negative_price_is_rejected_not_valued_as_cheap_collateral() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    for mantissa in [0i64, -1, i64::MIN] {
        let broken = fixture.write_price_update(
            btc_feed_id(),
            mantissa,
            PRICE_CONF,
            PRICE_EXPONENT,
            NOW,
            VerificationLevel::Full,
        );
        let result = fixture.read_btc_usd(&broken);
        assert_failed_with(&result, oracle_error::INVALID_PRICE);
    }
}

#[test]
fn a_positive_exponent_is_rejected() {
    // The adapter models mantissa * 10^-expo only. A positive exponent would
    // silently scale the price *up*; refuse it rather than mis-price.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let bad = fixture.write_price_update(
        btc_feed_id(),
        100_000,
        50,
        2, // positive exponent
        NOW,
        VerificationLevel::Full,
    );
    let result = fixture.read_btc_usd(&bad);
    assert_failed_with(&result, oracle_error::UNSUPPORTED_EXPONENT);
}

#[test]
fn a_too_wide_confidence_band_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    // The program floors `conf * 10_000 / mantissa` and compares against the
    // 200 bps bound. One bps of this mantissa is a billion confidence atoms,
    // so "2% plus one atom" would still floor to 200 bps; the first
    // rejectable value is a full basis-point granule over the bound.
    let one_bps_in_atoms = PRICE_MANTISSA as u64 / 10_000;
    let inside = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        one_bps_in_atoms * 200, // exactly the 200 bps bound
        PRICE_EXPONENT,
        NOW,
        VerificationLevel::Full,
    );
    fixture.read_btc_usd(&inside).expect("2% is inside the bound");

    let wide = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        one_bps_in_atoms * 201, // 201 bps: one granule over the bound
        PRICE_EXPONENT,
        NOW,
        VerificationLevel::Full,
    );
    let result = fixture.read_btc_usd(&wide);
    assert_failed_with(&result, oracle_error::CONFIDENCE_TOO_WIDE);
}

// ---------------------------------------------------------------------------
// Governance gates
// ---------------------------------------------------------------------------

#[test]
fn only_governance_can_pause_and_a_paused_oracle_blocks_everything() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.set_paused_as(&outsider, true);
    assert_failed_with(&result, oracle_error::UNAUTHORIZED_GOVERNANCE);

    let governance = fixture.governance.insecure_clone();
    fixture.set_paused_as(&governance, true).expect("governance pauses");

    // Even a perfect update must not be read while paused — the kill switch
    // exists for suspected feed problems, and the fail-closed rule is total.
    let price = fixture.fresh_price_account();
    let result = fixture.read_btc_usd(&price);
    assert_failed_with(&result, oracle_error::ORACLE_PAUSED);

    fixture.set_paused_as(&governance, false).expect("governance resumes");
    fixture.svm.expire_blockhash();
    fixture.read_btc_usd(&price).expect("reads resume cleanly");
}

#[test]
fn only_governance_can_change_the_staleness_window() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.set_staleness_as(&outsider, 120);
    assert_failed_with(&result, oracle_error::UNAUTHORIZED_GOVERNANCE);

    let governance = fixture.governance.insecure_clone();
    let result = fixture.set_staleness_as(&governance, 3_601);
    assert_failed_with(&result, oracle_error::INVALID_STALENESS_THRESHOLD);

    fixture.set_staleness_as(&governance, 120).expect("in-range change applies");
    assert_eq!(fixture.read_oracle().staleness_threshold_seconds, 120);

    // The new window governs immediately: a 90-second-old price that used to
    // be stale now reads cleanly.
    let price = fixture.write_price_update(
        btc_feed_id(),
        PRICE_MANTISSA,
        PRICE_CONF,
        PRICE_EXPONENT,
        NOW - 90,
        VerificationLevel::Full,
    );
    fixture.read_btc_usd(&price).expect("inside the widened window");
}
