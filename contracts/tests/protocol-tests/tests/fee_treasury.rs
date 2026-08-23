//! Pass 1 — runtime tests against the real compiled fee & treasury program.
//!
//! This program never custodies funds: it quotes the origination-fee split
//! and records a running total. The runtime claims are therefore about who
//! may configure (governance only, within the 5% protocol cap) and who may
//! write into the public counter (the loan program's recorded authority only,
//! so the cumulative figure cannot be inflated by an arbitrary caller).
//!
//! # Requires a compiled program
//!
//! Loads `target/deploy/fee_treasury.so`. CI sets `PERSAT_REQUIRE_PROGRAMS=1`;
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

/// Path to the compiled program, relative to the contracts workspace root.
const PROGRAM_SO: &str = "target/deploy/fee_treasury.so";

/// Anchor error codes for [`fee_treasury::FeeError`], in declaration order
/// (6000 is Anchor's error-code offset).
mod fee_error {
    pub const INVALID_AUTHORITY: u32 = 6000;
    pub const UNAUTHORIZED_GOVERNANCE: u32 = 6001;
    pub const FEE_ABOVE_PROTOCOL_CAP: u32 = 6002;
    pub const FEE_MISMATCH: u32 = 6003;
    pub const UNAUTHORIZED_PROGRAM: u32 = 6005;
}

/// Configuration used across the suite: 0.5% direct, 1% marketplace — below
/// the 2% configured for the MVP and far below the 5% protocol cap.
const DIRECT_BPS: u16 = 50;
const MARKETPLACE_BPS: u16 = 100;
/// $10k principal in 6-decimal atoms.
const PRINCIPAL_ATOMS: u64 = 10_000_000_000;

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
                     checks silently pass without executing."
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

/// Treasury fixture: governance, the loan authority, an outsider, and the
/// singleton config PDA.
struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,
    governance: Keypair,
    loan_authority: Keypair,
    outsider: Keypair,
    treasury: Keypair,
    config_pda: Pubkey,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let program_id = Pubkey::new_from_array(fee_treasury::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let governance = Keypair::new();
        let loan_authority = Keypair::new();
        let outsider = Keypair::new();
        let treasury = Keypair::new();
        for kp in [&governance, &loan_authority, &outsider, &treasury] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }
        let (config_pda, _) = Pubkey::find_program_address(&[b"treasury"], &program_id);
        Self { svm, program_id, payer, governance, loan_authority, outsider, treasury, config_pda }
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
    #[allow(clippy::too_many_arguments)]
    fn initialize_with(
        &mut self,
        governance: &Pubkey,
        treasury: &Pubkey,
        loan_authority: &Pubkey,
        direct_bps: u16,
        marketplace_bps: u16,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            fee_treasury::accounts::InitializeTreasury {
                payer: self.anchor_key(&self.payer.pubkey()),
                config: self.anchor_key(&self.config_pda),
                system_program: anchor_lang::system_program::ID,
            },
            fee_treasury::instruction::InitializeTreasury {
                governance: self.anchor_key(governance),
                treasury: self.anchor_key(treasury),
                loan_authority: self.anchor_key(loan_authority),
                direct_origination_fee_bps: direct_bps,
                marketplace_origination_fee_bps: marketplace_bps,
            },
        );
        self.send(ix, &[])
    }

    fn initialize(&mut self) -> std::result::Result<(), String> {
        let governance = self.governance.pubkey();
        let treasury = self.treasury.pubkey();
        let loan_authority = self.loan_authority.pubkey();
        self.initialize_with(&governance, &treasury, &loan_authority, DIRECT_BPS, MARKETPLACE_BPS)
    }

    fn set_fee_parameters_as(
        &mut self,
        who: &Keypair,
        direct_bps: u16,
        marketplace_bps: u16,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            fee_treasury::accounts::UpdateTreasury {
                config: self.anchor_key(&self.config_pda),
                governance: self.anchor_key(&who.pubkey()),
            },
            fee_treasury::instruction::SetFeeParameters {
                direct_origination_fee_bps: direct_bps,
                marketplace_origination_fee_bps: marketplace_bps,
            },
        );
        self.send(ix, &[who])
    }

    fn set_treasury_as(&mut self, who: &Keypair, treasury: &Pubkey) -> std::result::Result<(), String> {
        let ix = self.instruction(
            fee_treasury::accounts::UpdateTreasury {
                config: self.anchor_key(&self.config_pda),
                governance: self.anchor_key(&who.pubkey()),
            },
            fee_treasury::instruction::SetTreasury { treasury: self.anchor_key(treasury) },
        );
        self.send(ix, &[who])
    }

    fn record_fee_as(
        &mut self,
        who: &Keypair,
        principal_atoms: u64,
        origin: fee_treasury::FeeOrigin,
        reported_fee_atoms: u64,
    ) -> std::result::Result<(), String> {
        self.record_fee_through(who, principal_atoms, origin, reported_fee_atoms, self.config_pda)
    }

    fn record_fee_through(
        &mut self,
        who: &Keypair,
        principal_atoms: u64,
        origin: fee_treasury::FeeOrigin,
        reported_fee_atoms: u64,
        config: Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            fee_treasury::accounts::RecordFee {
                config: self.anchor_key(&config),
                loan_program: self.anchor_key(&who.pubkey()),
            },
            fee_treasury::instruction::RecordOriginationFee {
                principal_atoms,
                origin,
                reported_fee_atoms,
            },
        );
        self.send(ix, &[who])
    }

    fn read_config(&self) -> fee_treasury::TreasuryConfig {
        let account = self.svm.get_account(&self.config_pda).expect("config exists");
        fee_treasury::TreasuryConfig::try_deserialize(&mut account.data.as_slice())
            .expect("config deserializes")
    }
}

// ---------------------------------------------------------------------------
// Initialization and governance
// ---------------------------------------------------------------------------

#[test]
fn the_treasury_records_its_configuration() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let config = fixture.read_config();
    assert_eq!(config.governance.to_bytes(), fixture.governance.pubkey().to_bytes());
    assert_eq!(config.treasury.to_bytes(), fixture.treasury.pubkey().to_bytes());
    assert_eq!(config.loan_authority.to_bytes(), fixture.loan_authority.pubkey().to_bytes());
    assert_eq!(config.direct_origination_fee_bps, DIRECT_BPS);
    assert_eq!(config.marketplace_origination_fee_bps, MARKETPLACE_BPS);
    assert_eq!(config.total_collected_atoms, 0);

    fixture.svm.expire_blockhash();
    let result = fixture.initialize();
    assert!(result.is_err(), "the treasury singleton cannot be recreated");
}

#[test]
fn initialization_rejects_default_authorities_and_above_cap_fees() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let governance = fixture.governance.pubkey();
    let treasury = fixture.treasury.pubkey();
    let loan = fixture.loan_authority.pubkey();
    let default = Pubkey::default();

    let result = fixture.initialize_with(&default, &treasury, &loan, DIRECT_BPS, MARKETPLACE_BPS);
    assert_failed_with(&result, fee_error::INVALID_AUTHORITY);
    let result = fixture.initialize_with(&governance, &default, &loan, DIRECT_BPS, MARKETPLACE_BPS);
    assert_failed_with(&result, fee_error::INVALID_AUTHORITY);
    let result = fixture.initialize_with(&governance, &treasury, &default, DIRECT_BPS, MARKETPLACE_BPS);
    assert_failed_with(&result, fee_error::INVALID_AUTHORITY);

    // One basis point over the 5% protocol cap is rejected even at setup.
    let result = fixture.initialize_with(&governance, &treasury, &loan, 501, MARKETPLACE_BPS);
    assert_failed_with(&result, fee_error::FEE_ABOVE_PROTOCOL_CAP);
    let result = fixture.initialize_with(&governance, &treasury, &loan, DIRECT_BPS, 501);
    assert_failed_with(&result, fee_error::FEE_ABOVE_PROTOCOL_CAP);
}

#[test]
fn only_governance_can_change_fee_parameters_and_never_above_the_cap() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.set_fee_parameters_as(&outsider, DIRECT_BPS, MARKETPLACE_BPS);
    assert_failed_with(&result, fee_error::UNAUTHORIZED_GOVERNANCE);

    // Governance is powerful but not unbounded: the 5% cap is not a
    // governance parameter, so no governance action can raise above it.
    let governance = fixture.governance.insecure_clone();
    let result = fixture.set_fee_parameters_as(&governance, 501, MARKETPLACE_BPS);
    assert_failed_with(&result, fee_error::FEE_ABOVE_PROTOCOL_CAP);

    fixture.set_fee_parameters_as(&governance, 100, 150).expect("within-cap change applies");
    let config = fixture.read_config();
    assert_eq!(config.direct_origination_fee_bps, 100);
    assert_eq!(config.marketplace_origination_fee_bps, 150);
}

#[test]
fn only_governance_can_move_the_treasury_destination() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let outsider = fixture.outsider.insecure_clone();
    let new_treasury = Keypair::new().pubkey();
    let result = fixture.set_treasury_as(&outsider, &new_treasury);
    assert_failed_with(&result, fee_error::UNAUTHORIZED_GOVERNANCE);

    let governance = fixture.governance.insecure_clone();
    let result = fixture.set_treasury_as(&governance, &Pubkey::default());
    assert_failed_with(&result, fee_error::INVALID_AUTHORITY);

    fixture.set_treasury_as(&governance, &new_treasury).expect("governance moves destination");
    assert_eq!(fixture.read_config().treasury.to_bytes(), new_treasury.to_bytes());
}

// ---------------------------------------------------------------------------
// The fee record
// ---------------------------------------------------------------------------

#[test]
fn the_loan_authority_records_fees_and_the_total_accumulates() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    // $10k at 50bps direct = $50.00 exactly.
    let loan = fixture.loan_authority.insecure_clone();
    fixture
        .record_fee_as(&loan, PRINCIPAL_ATOMS, fee_treasury::FeeOrigin::Direct, 50_000_000)
        .expect("an exactly correct direct fee records");

    // $10k at 100bps marketplace = $100.00 exactly.
    fixture
        .record_fee_as(&loan, PRINCIPAL_ATOMS, fee_treasury::FeeOrigin::Marketplace, 100_000_000)
        .expect("an exactly correct marketplace fee records");

    assert_eq!(fixture.read_config().total_collected_atoms, 150_000_000);
}

#[test]
fn a_misreported_fee_is_rejected_even_from_the_loan_authority() {
    // The amount is recomputed against the configured schedule: a caller
    // cannot over- or under-report, even with the right key.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let loan = fixture.loan_authority.insecure_clone();

    // One atom low.
    let result = fixture.record_fee_as(&loan, PRINCIPAL_ATOMS, fee_treasury::FeeOrigin::Direct, 49_999_999);
    assert_failed_with(&result, fee_error::FEE_MISMATCH);
    // One atom high.
    let result = fixture.record_fee_as(&loan, PRINCIPAL_ATOMS, fee_treasury::FeeOrigin::Direct, 50_000_001);
    assert_failed_with(&result, fee_error::FEE_MISMATCH);
    // The marketplace amount reported under the direct origin.
    let result =
        fixture.record_fee_as(&loan, PRINCIPAL_ATOMS, fee_treasury::FeeOrigin::Direct, 100_000_000);
    assert_failed_with(&result, fee_error::FEE_MISMATCH);

    assert_eq!(fixture.read_config().total_collected_atoms, 0, "nothing recorded");
}

#[test]
fn only_the_loan_authority_may_record() {
    // The fee counter is the public accounting of what the protocol earned.
    // Any wallet replaying self-consistent math could otherwise inflate it.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let outsider = fixture.outsider.insecure_clone();
    let result =
        fixture.record_fee_as(&outsider, PRINCIPAL_ATOMS, fee_treasury::FeeOrigin::Direct, 50_000_000);
    assert_failed_with(&result, fee_error::UNAUTHORIZED_PROGRAM);

    // Governance is not the loan program either: roles do not blur.
    let governance = fixture.governance.insecure_clone();
    let result =
        fixture.record_fee_as(&governance, PRINCIPAL_ATOMS, fee_treasury::FeeOrigin::Direct, 50_000_000);
    assert_failed_with(&result, fee_error::UNAUTHORIZED_PROGRAM);

    assert_eq!(fixture.read_config().total_collected_atoms, 0);
}

#[test]
fn a_forged_treasury_config_is_rejected() {
    // A byte-perfect copy of the real config at a non-PDA address: the seeds
    // constraint re-derives the singleton address and refuses the impostor.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let real = fixture.svm.get_account(&fixture.config_pda).unwrap();
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

    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.record_fee_through(
        &loan,
        PRINCIPAL_ATOMS,
        fee_treasury::FeeOrigin::Direct,
        50_000_000,
        forgery,
    );
    assert!(result.is_err(), "a forged config must not pass the seeds check");
    assert_eq!(fixture.read_config().total_collected_atoms, 0);
}
