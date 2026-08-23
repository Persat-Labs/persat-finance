//! Pass 1 — runtime tests against the real compiled loan lifecycle program.
//!
//! The loan program moves the loan currency itself: it disburses principal at
//! activation and pulls repayments from the borrower. Its safety properties —
//! exact-amount enforcement, borrower-only repayment, grace-window-before-
//! default — are enforced by Anchor's account constraints and checked math, so
//! they are proven here against the compiled binary, not asserted from source.
//!
//! Also proven: the liquidation boundary of the loan state machine.
//! `mark_liquidated` accepts only the configured liquidation authority — a
//! wallet that could unilaterally set `FullyLiquidated` on a live loan would
//! brick the borrower's ability to repay and falsely feed the reputation
//! signal. And `flag_default` stays permissionless by design: the chain clock
//! decides overdue, never the reporter, so a malicious reporter learns nothing
//! they could weaponize.
//!
//! # Requires a compiled program
//!
//! LiteSVM loads `target/deploy/loan_lifecycle.so`, produced by `anchor
//! build`. CI sets `PERSAT_REQUIRE_PROGRAMS=1`; a missing program is a hard
//! failure, never a silent skip.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::str::FromStr;

/// Path to the compiled program, relative to the contracts workspace root.
const PROGRAM_SO: &str = "target/deploy/loan_lifecycle.so";

/// Principal: $12,000 USDC in 6-decimal atoms.
const PRINCIPAL_ATOMS: u64 = 12_000_000_000;
/// Origination fee: 2% of principal.
const FEE_ATOMS: u64 = 240_000_000;
/// 10% APR over 6 months: total repayment = principal + $600.
const TOTAL_REPAYMENT_ATOMS: u64 = 12_600_000_000;
/// Exactly one-sixth of the total — 12.6e9 / 6 divides cleanly.
const INSTALLMENT_ATOMS: u64 = 2_100_000_000;
/// 0.4 BTC of collateral recorded on the loan (8-decimal atoms).
const COLLATERAL_ATOMS: u64 = 40_000_000;
/// Wallet starting balances: lender $20k, borrower $5k.
const LENDER_STARTING_ATOMS: u64 = 20_000_000_000;
const BORROWER_STARTING_ATOMS: u64 = 5_000_000_000;

/// 30-day nominal month and 5-day grace, mirrored from the program constants
/// for time-travel arithmetic.
const SECONDS_PER_MONTH: i64 = 30 * 24 * 60 * 60;
const GRACE_PERIOD_SECONDS: i64 = 5 * 24 * 60 * 60;

/// Anchor error codes for [`loan_lifecycle::LoanError`], in declaration order
/// (6000 is Anchor's error-code offset).
mod loan_error {
    pub const INVALID_TERMS: u32 = 6000;
    pub const FEE_EXCEEDS_PRINCIPAL: u32 = 6001;
    pub const LOAN_NOT_REPAYABLE: u32 = 6002;
    pub const LOAN_NOT_ACTIVE: u32 = 6003;
    pub const INCORRECT_PAYMENT_AMOUNT: u32 = 6005;
    pub const PAYMENT_NOT_OVERDUE: u32 = 6006;
    pub const UNAUTHORIZED_BORROWER: u32 = 6007;
    pub const MINT_MISMATCH: u32 = 6008;
    pub const INVALID_TOKEN_ACCOUNT_OWNER: u32 = 6009;
    pub const UNAUTHORIZED_PROGRAM: u32 = 6011;
    pub const INVALID_AUTHORITY: u32 = 6012;
}

/// Anchor framework error `ConstraintSeeds`, the rejection a forged PDA must
/// produce.
const CONSTRAINT_SEEDS: u32 = 2006;

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
                     access-control checks silently pass without executing."
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

// ---------------------------------------------------------------------------
// SPL Token fixtures — see escrow_vault.rs for the layout note; the loan
// currency is a 6-decimal USDC stand-in.
// ---------------------------------------------------------------------------

fn token_program_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

const MINT_ACCOUNT_LEN: usize = 82;
const TOKEN_ACCOUNT_LEN: usize = 165;

fn mint_account_data(decimals: u8, supply: u64) -> Vec<u8> {
    let mut data = vec![0u8; MINT_ACCOUNT_LEN];
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..36].copy_from_slice(Pubkey::new_unique().as_ref());
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    data
}

fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; TOKEN_ACCOUNT_LEN];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    data
}

fn read_token_balance(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().expect("amount field"))
}

/// PDA of a loan account for one deal.
#[derive(Clone, Copy)]
struct LoanHandles {
    deal_id: [u8; 16],
    loan: Pubkey,
}

/// A loan fixture: lender, borrower, treasury, an outside reporter, and the
/// liquidation authority. A standing keypair plays the liquidation engine's
/// role because the binding Anchor checks is an address comparison.
struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,
    lender: Keypair,
    borrower: Keypair,
    outsider: Keypair,
    liquidation_authority: Keypair,
    mint: Pubkey,
    wrong_mint: Pubkey,
    lender_account: Pubkey,
    borrower_account: Pubkey,
    borrower_wrong_mint_account: Pubkey,
    treasury_account: Pubkey,
    config_pda: Pubkey,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let program_id = Pubkey::new_from_array(loan_lifecycle::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let lender = Keypair::new();
        let borrower = Keypair::new();
        let outsider = Keypair::new();
        let liquidation_authority = Keypair::new();
        for kp in [&lender, &borrower, &outsider, &liquidation_authority] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }

        let token_program = token_program_id();
        let mint = Keypair::new().pubkey();
        let wrong_mint = Keypair::new().pubkey();
        let lender_account = Keypair::new().pubkey();
        let borrower_account = Keypair::new().pubkey();
        let borrower_wrong_mint_account = Keypair::new().pubkey();
        let treasury_account = Keypair::new().pubkey();
        let (config_pda, _) = Pubkey::find_program_address(&[b"loan-config"], &program_id);

        let mut fixture = Self {
            svm,
            program_id,
            payer,
            lender,
            borrower,
            outsider,
            liquidation_authority,
            mint,
            wrong_mint,
            lender_account,
            borrower_account,
            borrower_wrong_mint_account,
            treasury_account,
            config_pda,
        };
        let lender_pk = fixture.lender.pubkey();
        let borrower_pk = fixture.borrower.pubkey();
        fixture.write_account(mint, mint_account_data(6, u64::MAX / 2), token_program);
        fixture.write_account(wrong_mint, mint_account_data(6, u64::MAX / 2), token_program);
        fixture.write_account(
            lender_account,
            token_account_data(&mint, &lender_pk, LENDER_STARTING_ATOMS),
            token_program,
        );
        fixture.write_account(
            borrower_account,
            token_account_data(&mint, &borrower_pk, BORROWER_STARTING_ATOMS),
            token_program,
        );
        fixture.write_account(
            borrower_wrong_mint_account,
            token_account_data(&wrong_mint, &borrower_pk, BORROWER_STARTING_ATOMS),
            token_program,
        );
        // The treasury account is owned by a throwaway key; this fixture only
        // asserts the fee arrives, not who controls it.
        fixture.write_account(
            treasury_account,
            token_account_data(&mint, &Pubkey::new_unique(), 0),
            token_program,
        );
        fixture
    }

    fn loan_handles(&self) -> LoanHandles {
        let mut deal_id = [0u8; 16];
        deal_id.copy_from_slice(&Keypair::new().pubkey().to_bytes()[..16]);
        let (loan, _) =
            Pubkey::find_program_address(&[b"loan", deal_id.as_ref()], &self.program_id);
        LoanHandles { deal_id, loan }
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

    /// Move the chain clock — due dates are derived from `activated_at`, so
    /// the keeper's default logic is driven entirely by this.
    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    fn initialize_loan_config_with(
        &mut self,
        liquidation_authority: &Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            loan_lifecycle::accounts::InitializeLoanConfig {
                payer: self.anchor_key(&self.payer.pubkey()),
                config: self.anchor_key(&self.config_pda),
                system_program: anchor_lang::system_program::ID,
            },
            loan_lifecycle::instruction::InitializeLoanConfig {
                liquidation_authority: self.anchor_key(liquidation_authority),
            },
        );
        self.send(ix, &[])
    }

    fn initialize_loan_config(&mut self) -> std::result::Result<(), String> {
        let authority = self.liquidation_authority.pubkey();
        self.initialize_loan_config_with(&authority)
    }

    /// Activate a loan with explicit economics.
    #[allow(clippy::too_many_arguments)]
    fn activate(
        &mut self,
        handles: &LoanHandles,
        principal_atoms: u64,
        duration_months: u16,
        fee_atoms: u64,
    ) -> std::result::Result<(), String> {
        let lender_account = self.lender_account;
        self.activate_from(
            handles,
            principal_atoms,
            duration_months,
            fee_atoms,
            lender_account,
        )
    }

    fn activate_from(
        &mut self,
        handles: &LoanHandles,
        principal_atoms: u64,
        duration_months: u16,
        fee_atoms: u64,
        lender_token_account: Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            loan_lifecycle::accounts::ActivateLoan {
                lender: self.anchor_key(&self.lender.pubkey()),
                borrower: self.anchor_key(&self.borrower.pubkey()),
                loan: self.anchor_key(&handles.loan),
                loan_mint: self.anchor_key(&self.mint),
                lender_token_account: self.anchor_key(&lender_token_account),
                borrower_token_account: self.anchor_key(&self.borrower_account),
                treasury_token_account: self.anchor_key(&self.treasury_account),
                token_program: self.anchor_key(&token_program_id()),
                system_program: anchor_lang::system_program::ID,
            },
            loan_lifecycle::instruction::ActivateLoan {
                deal_id: handles.deal_id,
                principal_atoms,
                rate_bps: 1_000,
                duration_months,
                collateral_atoms: COLLATERAL_ATOMS,
                treasury_fee_atoms: fee_atoms,
            },
        );
        let lender = self.lender.insecure_clone();
        self.send(ix, &[&lender])
    }

    /// Payment attempt signed by `who`, paid out of `from_account`.
    fn pay_from(
        &mut self,
        handles: &LoanHandles,
        who: &Keypair,
        amount: u64,
        from_account: Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            loan_lifecycle::accounts::MakePayment {
                loan: self.anchor_key(&handles.loan),
                borrower: self.anchor_key(&who.pubkey()),
                loan_mint: self.anchor_key(&self.mint),
                borrower_token_account: self.anchor_key(&from_account),
                lender_token_account: self.anchor_key(&self.lender_account),
                token_program: self.anchor_key(&token_program_id()),
            },
            loan_lifecycle::instruction::MakePayment { amount },
        );
        self.send(ix, &[who])
    }

    fn pay(&mut self, handles: &LoanHandles, amount: u64) -> std::result::Result<(), String> {
        let borrower = self.borrower.insecure_clone();
        let account = self.borrower_account;
        self.pay_from(handles, &borrower, amount, account)
    }

    fn repay_in_full(&mut self, handles: &LoanHandles) -> std::result::Result<(), String> {
        let ix = self.instruction(
            loan_lifecycle::accounts::MakePayment {
                loan: self.anchor_key(&handles.loan),
                borrower: self.anchor_key(&self.borrower.pubkey()),
                loan_mint: self.anchor_key(&self.mint),
                borrower_token_account: self.anchor_key(&self.borrower_account),
                lender_token_account: self.anchor_key(&self.lender_account),
                token_program: self.anchor_key(&token_program_id()),
            },
            loan_lifecycle::instruction::RepayInFull {},
        );
        let borrower = self.borrower.insecure_clone();
        self.send(ix, &[&borrower])
    }

    fn flag_default_as(
        &mut self,
        handles: &LoanHandles,
        who: &Keypair,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            loan_lifecycle::accounts::FlagDefault {
                loan: self.anchor_key(&handles.loan),
                reporter: self.anchor_key(&who.pubkey()),
            },
            loan_lifecycle::instruction::FlagDefault {},
        );
        self.send(ix, &[who])
    }

    fn mark_liquidated_as(
        &mut self,
        handles: &LoanHandles,
        who: &Keypair,
        fully: bool,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            loan_lifecycle::accounts::MarkLiquidated {
                loan: self.anchor_key(&handles.loan),
                liquidation_engine: self.anchor_key(&who.pubkey()),
                config: self.anchor_key(&self.config_pda),
            },
            loan_lifecycle::instruction::MarkLiquidated { fully },
        );
        self.send(ix, &[who])
    }

    /// An active 6-month loan with the canonical economics.
    fn active_loan(&mut self, handles: &LoanHandles) {
        self.activate(handles, PRINCIPAL_ATOMS, 6, FEE_ATOMS).expect("activation");
    }

    /// Credit the lender's token account so a second loan can activate
    /// inside one fixture (one standing balance only covers one principal).
    fn top_up_lender(&mut self, extra_atoms: u64) {
        let at = self.lender_account;
        let current = self.token_balance_of(&at);
        let mint = self.mint;
        let owner = self.lender.pubkey();
        self.write_account(
            at,
            token_account_data(&mint, &owner, current + extra_atoms),
            token_program_id(),
        );
    }

    fn read_loan(&self, at: &Pubkey) -> loan_lifecycle::Loan {
        let account = self.svm.get_account(at).expect("loan account exists");
        loan_lifecycle::Loan::try_deserialize(&mut account.data.as_slice())
            .expect("loan deserializes")
    }

    fn token_balance_of(&self, at: &Pubkey) -> u64 {
        let data = self.svm.get_account(at).expect("token account exists").data;
        read_token_balance(&data)
    }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

#[test]
fn activation_disburses_principal_minus_the_fee_and_defines_the_schedule() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();

    fixture.active_loan(&handles);

    // The fee split at activation: borrower nets principal minus fee, the
    // treasury receives the fee, and every atom is accounted for.
    assert_eq!(
        fixture.token_balance_of(&fixture.borrower_account),
        BORROWER_STARTING_ATOMS + PRINCIPAL_ATOMS - FEE_ATOMS
    );
    assert_eq!(fixture.token_balance_of(&fixture.treasury_account), FEE_ATOMS);
    assert_eq!(
        fixture.token_balance_of(&fixture.lender_account),
        LENDER_STARTING_ATOMS - PRINCIPAL_ATOMS
    );

    let loan = fixture.read_loan(&handles.loan);
    assert_eq!(loan.deal_id, handles.deal_id);
    assert_eq!(loan.borrower.to_bytes(), fixture.borrower.pubkey().to_bytes());
    assert_eq!(loan.lender.to_bytes(), fixture.lender.pubkey().to_bytes());
    assert_eq!(loan.principal_atoms, PRINCIPAL_ATOMS);
    assert_eq!(loan.rate_bps, 1_000);
    assert_eq!(loan.duration_months, 6);
    assert_eq!(loan.collateral_atoms, COLLATERAL_ATOMS);
    assert_eq!(loan.total_repayment_atoms, TOTAL_REPAYMENT_ATOMS);
    assert_eq!(loan.installment_atoms, INSTALLMENT_ATOMS);
    assert_eq!(loan.final_installment_atoms, INSTALLMENT_ATOMS);
    assert_eq!(loan.payments_made, 0);
    assert_eq!(loan.total_paid_atoms, 0);
    assert_eq!(loan.state, loan_lifecycle::LoanState::Active);
}

#[test]
fn activation_rejects_an_unsupported_duration() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();

    // 18 months is not a protocol duration (6, 12, 24 only).
    let result = fixture.activate(&handles, PRINCIPAL_ATOMS, 18, FEE_ATOMS);
    assert_failed_with(&result, loan_error::INVALID_TERMS);
}

#[test]
fn activation_rejects_a_fee_at_or_above_the_principal() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);

    let handles = fixture.loan_handles();
    let result = fixture.activate(&handles, PRINCIPAL_ATOMS, 6, PRINCIPAL_ATOMS);
    assert_failed_with(&result, loan_error::FEE_EXCEEDS_PRINCIPAL);

    let handles = fixture.loan_handles();
    let result = fixture.activate(&handles, PRINCIPAL_ATOMS, 6, PRINCIPAL_ATOMS + 1);
    assert_failed_with(&result, loan_error::FEE_EXCEEDS_PRINCIPAL);
}

#[test]
fn activation_rejects_a_lender_account_the_lender_does_not_own() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();

    // The borrower offers one of their own accounts as the "lender" funding
    // source: real, funded, correct-mint — but token-owned by the borrower,
    // so it cannot fund a loan from the lender's purse. It must be a
    // *distinct* address from the borrower's disbursement account: reusing
    // that account would alias two mutable accounts and Anchor would reject
    // the transaction at the framework layer (2040) before the program's
    // owner check is ever evaluated.
    let impostor_source = Keypair::new().pubkey();
    let borrower_pk = fixture.borrower.pubkey();
    let mint = fixture.mint;
    fixture.write_account(
        impostor_source,
        token_account_data(&mint, &borrower_pk, PRINCIPAL_ATOMS),
        token_program_id(),
    );
    let result = fixture.activate_from(
        &handles,
        PRINCIPAL_ATOMS,
        6,
        FEE_ATOMS,
        impostor_source,
    );
    assert_failed_with(&result, loan_error::INVALID_TOKEN_ACCOUNT_OWNER);
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

#[test]
fn a_payment_applies_in_order_to_the_atom() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    fixture.pay(&handles, INSTALLMENT_ATOMS).expect("installment applies");

    let loan = fixture.read_loan(&handles.loan);
    assert_eq!(loan.payments_made, 1);
    assert_eq!(loan.total_paid_atoms, INSTALLMENT_ATOMS);
    assert_eq!(loan.state, loan_lifecycle::LoanState::Active);
    assert_eq!(
        fixture.token_balance_of(&fixture.lender_account),
        LENDER_STARTING_ATOMS - PRINCIPAL_ATOMS + INSTALLMENT_ATOMS
    );
}

#[test]
fn the_payment_amount_must_match_the_schedule_exactly() {
    // Partial payments never advance the schedule, and overpaying is treated
    // as a client error rather than silently absorbed.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    let result = fixture.pay(&handles, INSTALLMENT_ATOMS - 1);
    assert_failed_with(&result, loan_error::INCORRECT_PAYMENT_AMOUNT);
    let result = fixture.pay(&handles, INSTALLMENT_ATOMS + 1);
    assert_failed_with(&result, loan_error::INCORRECT_PAYMENT_AMOUNT);
    let result = fixture.pay(&handles, 0);
    assert_failed_with(&result, loan_error::INCORRECT_PAYMENT_AMOUNT);

    let loan = fixture.read_loan(&handles.loan);
    assert_eq!(loan.payments_made, 0, "no rejected payment advanced the schedule");
}

#[test]
fn only_the_borrower_can_make_a_payment() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    // A stranger paying "on behalf" of the borrower must not manipulate the
    // schedule counter — repayment authority is the borrower's alone.
    let outsider = fixture.outsider.insecure_clone();
    let borrower_account = fixture.borrower_account;
    let result = fixture.pay_from(&handles, &outsider, INSTALLMENT_ATOMS, borrower_account);
    assert_failed_with(&result, loan_error::UNAUTHORIZED_BORROWER);

    // Not even the lender may service the schedule in the borrower's name.
    // A second lender-owned account keeps source and destination distinct —
    // paying out of the loan's own destination account would alias two
    // mutable accounts and Anchor would reject the transaction at the
    // framework layer (2040) before the borrower-authority check runs.
    let lender_account_2 = Keypair::new().pubkey();
    let lender_pk = fixture.lender.pubkey();
    let mint = fixture.mint;
    fixture.write_account(
        lender_account_2,
        token_account_data(&mint, &lender_pk, LENDER_STARTING_ATOMS),
        token_program_id(),
    );
    let lender = fixture.lender.insecure_clone();
    let result = fixture.pay_from(&handles, &lender, INSTALLMENT_ATOMS, lender_account_2);
    assert_failed_with(&result, loan_error::UNAUTHORIZED_BORROWER);
}

#[test]
fn a_payment_from_the_wrong_mint_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    // Same owner, same decimals, wrong currency: USDT-shaped collateral must
    // never settle a USDC loan.
    let borrower = fixture.borrower.insecure_clone();
    let wrong_mint_account = fixture.borrower_wrong_mint_account;
    let result = fixture.pay_from(&handles, &borrower, INSTALLMENT_ATOMS, wrong_mint_account);
    assert_failed_with(&result, loan_error::MINT_MISMATCH);
}

#[test]
fn paying_the_full_schedule_completes_the_loan_exactly() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    for _ in 0..6 {
        fixture.svm.expire_blockhash();
        fixture.pay(&handles, INSTALLMENT_ATOMS).expect("installment applies");
    }

    let loan = fixture.read_loan(&handles.loan);
    assert_eq!(loan.payments_made, 6);
    assert_eq!(loan.total_paid_atoms, TOTAL_REPAYMENT_ATOMS, "schedule settles to the atom");
    assert_eq!(loan.state, loan_lifecycle::LoanState::Completed);
}

#[test]
fn repay_in_full_settles_the_remaining_schedule_in_one_step() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    fixture.pay(&handles, INSTALLMENT_ATOMS).unwrap();
    fixture.repay_in_full(&handles).expect("early settlement is allowed");

    let loan = fixture.read_loan(&handles.loan);
    assert_eq!(loan.payments_made, 6, "the whole schedule counts as paid");
    assert_eq!(loan.total_paid_atoms, TOTAL_REPAYMENT_ATOMS);
    assert_eq!(loan.state, loan_lifecycle::LoanState::Completed);

    // Conservation across every account: lender ends whole plus interest,
    // borrower spent exactly the schedule total, treasury kept the fee.
    assert_eq!(
        fixture.token_balance_of(&fixture.lender_account),
        LENDER_STARTING_ATOMS - PRINCIPAL_ATOMS + TOTAL_REPAYMENT_ATOMS
    );
    assert_eq!(
        fixture.token_balance_of(&fixture.borrower_account),
        BORROWER_STARTING_ATOMS + PRINCIPAL_ATOMS - FEE_ATOMS - TOTAL_REPAYMENT_ATOMS
    );
    assert_eq!(fixture.token_balance_of(&fixture.treasury_account), FEE_ATOMS);
}

#[test]
fn a_completed_loan_accepts_no_further_action() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);
    fixture.repay_in_full(&handles).unwrap();

    fixture.svm.expire_blockhash();
    let result = fixture.pay(&handles, INSTALLMENT_ATOMS);
    assert_failed_with(&result, loan_error::LOAN_NOT_REPAYABLE);
    let result = fixture.repay_in_full(&handles);
    assert_failed_with(&result, loan_error::LOAN_NOT_REPAYABLE);

    // Even an overdue-looking clock cannot default a settled loan.
    fixture.set_time(i64::MAX / 2);
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.flag_default_as(&handles, &outsider);
    assert_failed_with(&result, loan_error::LOAN_NOT_ACTIVE);
}

// ---------------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------------

#[test]
fn default_cannot_be_flagged_before_the_grace_window_closes() {
    // The keeper polls every 60s, so this gate is hit constantly: while the
    // borrower still has time, the default flag must be unreachable.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    let outsider = fixture.outsider.insecure_clone();

    // Immediately after activation: nowhere near due.
    let result = fixture.flag_default_as(&handles, &outsider);
    assert_failed_with(&result, loan_error::PAYMENT_NOT_OVERDUE);

    // Each retry needs a fresh blockhash: LiteSVM's status cache remembers
    // even failed transactions, so a byte-identical retry short-circuits
    // with AlreadyProcessed instead of re-executing the program.
    fixture.svm.expire_blockhash();

    // One second after the due date: late, but inside the grace window.
    fixture.set_time(SECONDS_PER_MONTH + 1);
    let result = fixture.flag_default_as(&handles, &outsider);
    assert_failed_with(&result, loan_error::PAYMENT_NOT_OVERDUE);

    fixture.svm.expire_blockhash();

    // The final second of grace: still not overdue.
    fixture.set_time(SECONDS_PER_MONTH + GRACE_PERIOD_SECONDS);
    let result = fixture.flag_default_as(&handles, &outsider);
    assert_failed_with(&result, loan_error::PAYMENT_NOT_OVERDUE);

    let loan = fixture.read_loan(&handles.loan);
    assert_eq!(loan.state, loan_lifecycle::LoanState::Active);
}

#[test]
fn an_overdue_loan_is_flagged_defaulted_by_any_reporter() {
    // Permissionless by design: the chain clock, not the reporter, decides
    // overdue-ness, so a malicious reporter can only report the truth.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    fixture.set_time(SECONDS_PER_MONTH + GRACE_PERIOD_SECONDS + 1);
    let outsider = fixture.outsider.insecure_clone();
    fixture.flag_default_as(&handles, &outsider).expect("a genuinely overdue loan flags");
    assert_eq!(
        fixture.read_loan(&handles.loan).state,
        loan_lifecycle::LoanState::Defaulted
    );

    // It cannot be flagged twice.
    fixture.svm.expire_blockhash();
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.flag_default_as(&handles, &outsider);
    assert_failed_with(&result, loan_error::LOAN_NOT_ACTIVE);
}

#[test]
fn catching_up_on_the_missed_installment_clears_the_default() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    fixture.set_time(SECONDS_PER_MONTH + GRACE_PERIOD_SECONDS + 1);
    let outsider = fixture.outsider.insecure_clone();
    fixture.flag_default_as(&handles, &outsider).unwrap();

    fixture.pay(&handles, INSTALLMENT_ATOMS).expect("catch-up payment is accepted");
    let loan = fixture.read_loan(&handles.loan);
    assert_eq!(loan.payments_made, 1);
    assert_eq!(loan.state, loan_lifecycle::LoanState::Active, "default clears on catch-up");
}

// ---------------------------------------------------------------------------
// Liquidation boundary
// ---------------------------------------------------------------------------

#[test]
fn mark_liquidated_requires_the_configured_liquidation_authority() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_loan_config().unwrap();
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    // No arbitrary wallet may stamp a loan as liquidated: doing so would
    // brick the borrower's repayment path on demand.
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.mark_liquidated_as(&handles, &outsider, false);
    assert_failed_with(&result, loan_error::UNAUTHORIZED_PROGRAM);
    let borrower = fixture.borrower.insecure_clone();
    let result = fixture.mark_liquidated_as(&handles, &borrower, true);
    assert_failed_with(&result, loan_error::UNAUTHORIZED_PROGRAM);

    let liquidation = fixture.liquidation_authority.insecure_clone();
    fixture
        .mark_liquidated_as(&handles, &liquidation, false)
        .expect("the liquidation authority marks a partial liquidation");
    assert_eq!(
        fixture.read_loan(&handles.loan).state,
        loan_lifecycle::LoanState::PartiallyLiquidated
    );

    // A liquidated loan is no longer repayable through the normal schedule.
    let result = fixture.pay(&handles, INSTALLMENT_ATOMS);
    assert_failed_with(&result, loan_error::LOAN_NOT_REPAYABLE);

    // Full liquidation on a second loan settles the other terminal state.
    // The first activation left the lender with only the remainder, so the
    // second principal needs fresh capacity.
    fixture.top_up_lender(PRINCIPAL_ATOMS);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);
    let liquidation = fixture.liquidation_authority.insecure_clone();
    fixture.mark_liquidated_as(&handles, &liquidation, true).unwrap();
    assert_eq!(
        fixture.read_loan(&handles.loan).state,
        loan_lifecycle::LoanState::FullyLiquidated
    );
}

#[test]
fn the_loan_config_rejects_defaults_and_cannot_be_replaced() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);

    let result = fixture.initialize_loan_config_with(&Pubkey::default());
    assert_failed_with(&result, loan_error::INVALID_AUTHORITY);

    fixture.initialize_loan_config().unwrap();
    fixture.svm.expire_blockhash();
    let result = fixture.initialize_loan_config();
    assert!(result.is_err(), "the liquidation authority must not be replaceable");
}

#[test]
fn a_forged_loan_account_is_rejected() {
    // A byte-perfect copy of a real loan at a non-PDA address: the seeds
    // constraint re-derives the address and refuses the impostor, so no
    // attacker can fabricate a loan in Defaulted state.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let handles = fixture.loan_handles();
    fixture.active_loan(&handles);

    let real = fixture.svm.get_account(&handles.loan).unwrap();
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

    let forged = LoanHandles { deal_id: handles.deal_id, loan: forgery };
    let result = fixture.pay(&forged, INSTALLMENT_ATOMS);
    assert_failed_with(&result, CONSTRAINT_SEEDS);
}
