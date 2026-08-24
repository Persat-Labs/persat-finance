//! Pass 1 — runtime tests against the real compiled asset whitelist registry.
//!
//! The whitelist is where the collateral policy lives: tBTC and zBTC only,
//! 8 decimals enforced, USDC/USDT treated as $1 with no oracle feed. Policy
//! gates are governance-controlled, so the runtime claims are about *who* may
//! write policy (governance only) and *what* can be written (nothing outside
//! the validated envelope — above all, a custodial wrapped-BTC mint could
//! never sneak in without a visible governance action).
//!
//! # Requires a compiled program
//!
//! Loads `target/deploy/asset_whitelist.so`. CI sets `PERSAT_REQUIRE_PROGRAMS=1`;
//! a missing program is a hard failure, never a silent skip.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::str::FromStr;

/// Path to the compiled program, relative to the contracts workspace root.
const PROGRAM_SO: &str = "target/deploy/asset_whitelist.so";

/// Anchor error codes for [`asset_whitelist::RegistryError`], in declaration
/// order (6000 is Anchor's error-code offset).
mod registry_error {
    pub const INVALID_GOVERNANCE: u32 = 6000;
    pub const UNAUTHORIZED_GOVERNANCE: u32 = 6001;
    pub const INVALID_RISK_PARAMETERS: u32 = 6002;
    pub const MISSING_COLLATERAL_ORACLE: u32 = 6003;
    pub const UNEXPECTED_COLLATERAL_DECIMALS: u32 = 6004;
    pub const UNEXPECTED_LOAN_CURRENCY_ORACLE: u32 = 6005;
    pub const ASSET_REGISTRY_MISMATCH: u32 = 6006;
    pub const ASSET_ALREADY_INACTIVE: u32 = 6007;
    pub const ASSET_ALREADY_ACTIVE: u32 = 6008;
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
                     policy checks silently pass without executing."
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

/// The classic SPL Token program (the mints registered here are classic SPL).
fn token_program_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

/// Pack an SPL mint — see escrow_vault.rs for the layout note.
fn mint_account_data(decimals: u8, supply: u64) -> Vec<u8> {
    let mut data = vec![0u8; 82];
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..36].copy_from_slice(Pubkey::new_unique().as_ref());
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    data
}

/// The canonical tBTC/zBTC risk envelope.
fn risk() -> asset_whitelist::RiskParameters {
    asset_whitelist::RiskParameters {
        max_ltv_bps: 5_000,
        partial_liquidation_ltv_bps: 7_000,
        full_liquidation_ltv_bps: 8_000,
        liquidation_penalty_bps: 500,
        max_partial_liquidation_bps: 2_000,
    }
}

/// Registry fixture: governance, an outsider, and mint factories.
struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,
    governance: Keypair,
    outsider: Keypair,
    registry_pda: Pubkey,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let program_id = Pubkey::new_from_array(asset_whitelist::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let governance = Keypair::new();
        let outsider = Keypair::new();
        for kp in [&governance, &outsider] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }
        let (registry_pda, _) = Pubkey::find_program_address(&[b"asset-registry"], &program_id);
        Self { svm, program_id, payer, governance, outsider, registry_pda }
    }

    /// Write a packed mint account and return its address.
    fn write_mint(&mut self, decimals: u8) -> Pubkey {
        let mint = Keypair::new().pubkey();
        let data = mint_account_data(decimals, 1_000_000_000);
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(
                mint,
                Account { lamports, data, owner: token_program_id(), executable: false, rent_epoch: 0 },
            )
            .unwrap();
        mint
    }

    fn asset_pda(&self, mint: &Pubkey) -> Pubkey {
        let (asset, _) = Pubkey::find_program_address(
            &[b"asset", self.registry_pda.as_ref(), mint.as_ref()],
            &self.program_id,
        );
        asset
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

    fn initialize_registry_with(
        &mut self,
        governance: &Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            asset_whitelist::accounts::InitializeRegistry {
                payer: self.anchor_key(&self.payer.pubkey()),
                registry: self.anchor_key(&self.registry_pda),
                system_program: anchor_lang::system_program::ID,
            },
            asset_whitelist::instruction::InitializeRegistry {
                governance: self.anchor_key(governance),
            },
        );
        self.send(ix, &[])
    }

    fn initialize_registry(&mut self) -> std::result::Result<(), String> {
        let governance = self.governance.pubkey();
        self.initialize_registry_with(&governance)
    }

    fn add_asset_as(
        &mut self,
        who: &Keypair,
        mint: &Pubkey,
        category: asset_whitelist::AssetCategory,
        oracle_feed: &Pubkey,
        risk: &asset_whitelist::RiskParameters,
    ) -> std::result::Result<(), String> {
        let asset = self.asset_pda(mint);
        let ix = self.instruction(
            asset_whitelist::accounts::AddAssetType {
                registry: self.anchor_key(&self.registry_pda),
                governance: self.anchor_key(&who.pubkey()),
                mint: self.anchor_key(mint),
                asset: self.anchor_key(&asset),
                system_program: anchor_lang::system_program::ID,
            },
            asset_whitelist::instruction::AddAssetType {
                category,
                oracle_feed: self.anchor_key(oracle_feed),
                risk: *risk,
            },
        );
        self.send(ix, &[who])
    }

    fn update_asset_as(
        &mut self,
        who: &Keypair,
        mint: &Pubkey,
        oracle_feed: &Pubkey,
        risk: &asset_whitelist::RiskParameters,
    ) -> std::result::Result<(), String> {
        let asset = self.asset_pda(mint);
        let ix = self.instruction(
            asset_whitelist::accounts::UpdateAssetType {
                registry: self.anchor_key(&self.registry_pda),
                governance: self.anchor_key(&who.pubkey()),
                asset: self.anchor_key(&asset),
            },
            asset_whitelist::instruction::UpdateAssetType {
                oracle_feed: self.anchor_key(oracle_feed),
                risk: *risk,
            },
        );
        self.send(ix, &[who])
    }

    fn deactivate_as(&mut self, who: &Keypair, mint: &Pubkey) -> std::result::Result<(), String> {
        let asset = self.asset_pda(mint);
        let ix = self.instruction(
            asset_whitelist::accounts::UpdateAssetType {
                registry: self.anchor_key(&self.registry_pda),
                governance: self.anchor_key(&who.pubkey()),
                asset: self.anchor_key(&asset),
            },
            asset_whitelist::instruction::DeactivateAssetType {},
        );
        self.send(ix, &[who])
    }

    fn reactivate_as(&mut self, who: &Keypair, mint: &Pubkey) -> std::result::Result<(), String> {
        let asset = self.asset_pda(mint);
        let ix = self.instruction(
            asset_whitelist::accounts::UpdateAssetType {
                registry: self.anchor_key(&self.registry_pda),
                governance: self.anchor_key(&who.pubkey()),
                asset: self.anchor_key(&asset),
            },
            asset_whitelist::instruction::ReactivateAssetType {},
        );
        self.send(ix, &[who])
    }

    fn read_registry(&self) -> asset_whitelist::AssetRegistry {
        let account = self.svm.get_account(&self.registry_pda).expect("registry exists");
        asset_whitelist::AssetRegistry::try_deserialize(&mut account.data.as_slice())
            .expect("registry deserializes")
    }

    fn read_asset(&self, mint: &Pubkey) -> asset_whitelist::AssetRecord {
        let account = self.svm.get_account(&self.asset_pda(mint)).expect("asset exists");
        asset_whitelist::AssetRecord::try_deserialize(&mut account.data.as_slice())
            .expect("asset deserializes")
    }
}

// ---------------------------------------------------------------------------
// Initialization and governance
// ---------------------------------------------------------------------------

#[test]
fn the_registry_starts_empty_under_its_governance() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();

    let registry = fixture.read_registry();
    assert_eq!(registry.governance.to_bytes(), fixture.governance.pubkey().to_bytes());
    assert_eq!(registry.asset_count, 0);

    fixture.svm.expire_blockhash();
    let result = fixture.initialize_registry();
    assert!(result.is_err(), "the registry singleton cannot be recreated");
}

#[test]
fn the_registry_rejects_default_governance() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let result = fixture.initialize_registry_with(&Pubkey::default());
    assert_failed_with(&result, registry_error::INVALID_GOVERNANCE);
}

#[test]
fn only_governance_can_write_asset_policy() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(8);
    let feed = Pubkey::new_unique();

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.add_asset_as(
        &outsider,
        &mint,
        asset_whitelist::AssetCategory::Collateral,
        &feed,
        &risk(),
    );
    assert_failed_with(&result, registry_error::UNAUTHORIZED_GOVERNANCE);

    let governance = fixture.governance.insecure_clone();
    fixture
        .add_asset_as(
            &governance,
            &mint,
            asset_whitelist::AssetCategory::Collateral,
            &feed,
            &risk(),
        )
        .expect("governance writes policy");

    // Governance is also the only door for every later mutation.
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.update_asset_as(&outsider, &mint, &feed, &risk());
    assert_failed_with(&result, registry_error::UNAUTHORIZED_GOVERNANCE);
    let result = fixture.deactivate_as(&outsider, &mint);
    assert_failed_with(&result, registry_error::UNAUTHORIZED_GOVERNANCE);

    let registry = fixture.read_registry();
    assert_eq!(registry.asset_count, 1);
}

// ---------------------------------------------------------------------------
// The asset policy envelope
// ---------------------------------------------------------------------------

#[test]
fn a_compliant_collateral_asset_registers_with_its_risk_record() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(8);
    let feed = Pubkey::new_unique();

    let governance = fixture.governance.insecure_clone();
    fixture
        .add_asset_as(&governance, &mint, asset_whitelist::AssetCategory::Collateral, &feed, &risk())
        .unwrap();

    let asset = fixture.read_asset(&mint);
    assert_eq!(asset.mint.to_bytes(), mint.to_bytes());
    assert_eq!(asset.category, asset_whitelist::AssetCategory::Collateral);
    assert_eq!(asset.oracle_feed.to_bytes(), feed.to_bytes());
    assert_eq!(asset.decimals, 8);
    assert!(asset.active);
    assert!(asset.is_accepted(asset_whitelist::AssetCategory::Collateral));
    assert!(!asset.is_accepted(asset_whitelist::AssetCategory::LoanCurrency));
}

#[test]
fn a_compliant_loan_currency_registers_without_an_oracle_feed() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(6);

    let governance = fixture.governance.insecure_clone();
    fixture
        .add_asset_as(
            &governance,
            &mint,
            asset_whitelist::AssetCategory::LoanCurrency,
            &Pubkey::default(),
            &risk(),
        )
        .unwrap();

    let asset = fixture.read_asset(&mint);
    assert_eq!(asset.decimals, 6);
    assert!(asset.is_accepted(asset_whitelist::AssetCategory::LoanCurrency));
    assert!(!asset.is_accepted(asset_whitelist::AssetCategory::Collateral));
}

#[test]
fn collateral_requires_an_oracle_feed() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(8);

    let governance = fixture.governance.insecure_clone();
    let result = fixture.add_asset_as(
        &governance,
        &mint,
        asset_whitelist::AssetCategory::Collateral,
        &Pubkey::default(),
        &risk(),
    );
    assert_failed_with(&result, registry_error::MISSING_COLLATERAL_ORACLE);
}

#[test]
fn a_loan_currency_must_not_carry_an_oracle_feed() {
    // The documented single-oracle assumption: USDC/USDT are exactly $1 in the
    // MVP, so a loan currency with a price feed would break the invariant that
    // no de-peg is modeled.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(6);
    let feed = Pubkey::new_unique();

    let governance = fixture.governance.insecure_clone();
    let result = fixture.add_asset_as(
        &governance,
        &mint,
        asset_whitelist::AssetCategory::LoanCurrency,
        &feed,
        &risk(),
    );
    assert_failed_with(&result, registry_error::UNEXPECTED_LOAN_CURRENCY_ORACLE);
}

#[test]
fn collateral_must_be_eight_decimal_btc_precision() {
    // Risk parameters are calibrated against the 8-decimal precision of tBTC
    // and zBTC. A 6-decimal "bitcoin-shaped" mint is a different asset.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(6);
    let feed = Pubkey::new_unique();

    let governance = fixture.governance.insecure_clone();
    let result = fixture.add_asset_as(
        &governance,
        &mint,
        asset_whitelist::AssetCategory::Collateral,
        &feed,
        &risk(),
    );
    assert_failed_with(&result, registry_error::UNEXPECTED_COLLATERAL_DECIMALS);
}

#[test]
fn risk_parameters_outside_the_protocol_envelope_are_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let feed = Pubkey::new_unique();
    let governance = fixture.governance.insecure_clone();

    // Above the 50% protocol ceiling.
    let mut over_ceiling = risk();
    over_ceiling.max_ltv_bps = 5_001;
    let mint = fixture.write_mint(8);
    let result = fixture.add_asset_as(
        &governance,
        &mint,
        asset_whitelist::AssetCategory::Collateral,
        &feed,
        &over_ceiling,
    );
    assert_failed_with(&result, registry_error::INVALID_RISK_PARAMETERS);

    // Thresholds out of order: partial before max.
    let mut unordered = risk();
    unordered.partial_liquidation_ltv_bps = 4_000;
    let mint = fixture.write_mint(8);
    let result = fixture.add_asset_as(
        &governance,
        &mint,
        asset_whitelist::AssetCategory::Collateral,
        &feed,
        &unordered,
    );
    assert_failed_with(&result, registry_error::INVALID_RISK_PARAMETERS);

    // An uncapped partial liquidation would let one missed payment drain a
    // whole position.
    let mut uncapped = risk();
    uncapped.max_partial_liquidation_bps = 0;
    let mint = fixture.write_mint(8);
    let result = fixture.add_asset_as(
        &governance,
        &mint,
        asset_whitelist::AssetCategory::Collateral,
        &feed,
        &uncapped,
    );
    assert_failed_with(&result, registry_error::INVALID_RISK_PARAMETERS);

    // And a penalty above 100% is not a penalty, it's confiscation.
    let mut confiscatory = risk();
    confiscatory.liquidation_penalty_bps = 10_001;
    let mint = fixture.write_mint(8);
    let result = fixture.add_asset_as(
        &governance,
        &mint,
        asset_whitelist::AssetCategory::Collateral,
        &feed,
        &confiscatory,
    );
    assert_failed_with(&result, registry_error::INVALID_RISK_PARAMETERS);
}

#[test]
fn policy_is_revalidated_on_update_not_just_on_creation() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(8);
    let feed = Pubkey::new_unique();
    let governance = fixture.governance.insecure_clone();
    fixture
        .add_asset_as(&governance, &mint, asset_whitelist::AssetCategory::Collateral, &feed, &risk())
        .unwrap();

    // A governance update cannot raise the LTV ceiling either: the policy
    // check runs on every write, not only at registration time.
    let mut bad = risk();
    bad.max_ltv_bps = 6_000;
    let result = fixture.update_asset_as(&governance, &mint, &feed, &bad);
    assert_failed_with(&result, registry_error::INVALID_RISK_PARAMETERS);

    // Updates within the envelope apply.
    let mut tightened = risk();
    tightened.max_ltv_bps = 4_000;
    fixture.svm.expire_blockhash();
    fixture.update_asset_as(&governance, &mint, &feed, &tightened).unwrap();
    assert_eq!(fixture.read_asset(&mint).risk.max_ltv_bps, 4_000);
}

// ---------------------------------------------------------------------------
// Deactivation semantics
// ---------------------------------------------------------------------------

#[test]
fn deactivation_suspends_new_use_without_erasing_the_record() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(8);
    let feed = Pubkey::new_unique();
    let governance = fixture.governance.insecure_clone();
    fixture
        .add_asset_as(&governance, &mint, asset_whitelist::AssetCategory::Collateral, &feed, &risk())
        .unwrap();

    fixture.deactivate_as(&governance, &mint).expect("governance deactivates");
    let asset = fixture.read_asset(&mint);
    assert!(!asset.active, "record suspended");
    assert!(!asset.is_accepted(asset_whitelist::AssetCategory::Collateral));

    // Double deactivation is a no-op attempt, not a state change.
    fixture.svm.expire_blockhash();
    let result = fixture.deactivate_as(&governance, &mint);
    assert_failed_with(&result, registry_error::ASSET_ALREADY_INACTIVE);

    fixture.reactivate_as(&governance, &mint).expect("governance reactivates");
    assert!(fixture.read_asset(&mint).active);

    fixture.svm.expire_blockhash();
    let result = fixture.reactivate_as(&governance, &mint);
    assert_failed_with(&result, registry_error::ASSET_ALREADY_ACTIVE);
}

#[test]
fn a_forged_asset_record_is_rejected() {
    // A byte-perfect copy of a real asset record at a non-PDA address: the
    // seeds constraint re-derives the record's address from the registry and
    // mint keys and refuses the impostor.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let mint = fixture.write_mint(8);
    let feed = Pubkey::new_unique();
    let governance = fixture.governance.insecure_clone();
    fixture
        .add_asset_as(&governance, &mint, asset_whitelist::AssetCategory::Collateral, &feed, &risk())
        .unwrap();

    let real = fixture.svm.get_account(&fixture.asset_pda(&mint)).unwrap();
    let forgery = Keypair::new().pubkey();
    fixture
        .svm
        .set_account(
            forgery,
            Account {
                lamports: real.lamports,
                data: real.data.clone(),
                owner: fixture.program_id,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = fixture.instruction(
        asset_whitelist::accounts::UpdateAssetType {
            registry: fixture.anchor_key(&fixture.registry_pda),
            governance: fixture.anchor_key(&governance.pubkey()),
            asset: fixture.anchor_key(&forgery),
        },
        asset_whitelist::instruction::UpdateAssetType {
            oracle_feed: fixture.anchor_key(&feed),
            risk: risk(),
        },
    );
    let result = fixture.send(ix, &[&governance]);
    assert!(result.is_err(), "a forged asset record must not pass the seeds check");
}
