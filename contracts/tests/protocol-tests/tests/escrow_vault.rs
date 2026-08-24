//! Pass 1 — access-control tests against the real compiled escrow vault.
//!
//! The escrow vault is the only program in the protocol that custodies user
//! collateral, so it carries the strongest burden of proof in the suite. As
//! with governance, these tests execute the compiled SBF binary inside LiteSVM
//! because the properties that matter — signer checks, `address =` bindings,
//! PDA seeds — are enforced by Anchor's `#[derive(Accounts)]` at runtime, not
//! by anything a host-target unit test can reach.
//!
//! What is being proven here:
//!
//! * Collateral leaves a vault along exactly two outward paths — release to
//!   the borrower (loan-program authority only) and seizure (liquidation
//!   authority only). The borrower, the economic owner of the collateral,
//!   cannot move it alone. That is the entire point of escrow.
//! * The vault PDA is unforgeable: a byte-perfect copy of a real vault
//!   account at a different address is rejected by the seeds constraint.
//! * The recorded balance, never the token balance, is authoritative, so a
//!   stray direct transfer into the vault cannot be swept out as collateral.
//! * A partial seizure sized by `persat_core` (never more than 20% of posted
//!   collateral for one missed payment, per `maxPartialLiquidationBps`) lands
//!   on-chain exactly, and the vault refuses anything beyond what it records.
//!
//! # Requires a compiled program
//!
//! LiteSVM loads `target/deploy/escrow_vault.so`, produced by `anchor build`.
//! When that file is absent these tests skip; CI sets
//! `PERSAT_REQUIRE_PROGRAMS=1`, which turns a missing program into a hard
//! failure instead. Never weaken that to make a red build go green.

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
const PROGRAM_SO: &str = "target/deploy/escrow_vault.so";

/// 0.4 BTC in 8-decimal atoms — a realistic devnet-sized position.
const COLLATERAL_ATOMS: u64 = 40_000_000;

/// The borrower starts holding 1 BTC.
const BORROWER_STARTING_ATOMS: u64 = 100_000_000;

/// Anchor error codes for [`escrow_vault::VaultError`], in declaration order
/// (6000 is Anchor's error-code offset).
mod vault_error {
    pub const INVALID_AUTHORITY: u32 = 6000;
    pub const ZERO_AMOUNT: u32 = 6001;
    pub const VAULT_NOT_OPEN: u32 = 6002;
    pub const VAULT_NOT_LOCKED: u32 = 6003;
    pub const INSUFFICIENT_COLLATERAL: u32 = 6004;
    pub const UNAUTHORIZED_BORROWER: u32 = 6005;
    pub const UNAUTHORIZED_PROGRAM: u32 = 6006;
    pub const INVALID_VAULT_TOKEN_ACCOUNT: u32 = 6008;
    pub const INVALID_DESTINATION: u32 = 6009;
}

/// Anchor framework error `ConstraintSeeds`: the account passed in is not the
/// PDA the seeds derive. This is the rejection a forged vault must produce.
const CONSTRAINT_SEEDS: u32 = 2006;

/// Locate the compiled program, or `None` if it has not been built.
fn program_bytes() -> Option<Vec<u8>> {
    // CARGO_MANIFEST_DIR is contracts/tests/protocol-tests; the workspace root
    // is two levels up.
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

/// Assert a transaction failed with a specific custom error code.
///
/// `is_err()` alone cannot distinguish "rejected for the right reason" from
/// "rejected for some other reason" — a test that stays green when the program
/// regresses into a different failure mode would be false evidence.
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
// SPL Token fixtures
//
// The classic SPL Token program (v3.5.0) ships inside LiteSVM's default
// programs, so the vault's CPIs run against the same binary deployed on
// mainnet. Its account layouts are frozen: Mint is 82 bytes, token Account is
// 165 bytes — the same bytes the token program reads with its own `Pack`
// implementation. We pack them by hand because the tests' collateral simply
// exists at setup; no mint authority needs to sign.
// ---------------------------------------------------------------------------

/// The classic SPL Token program. tBTC and zBTC are classic SPL tokens; the
/// vault also tolerates Token-2022 via `TokenInterface`.
fn token_program_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

const MINT_ACCOUNT_LEN: usize = 82;
const TOKEN_ACCOUNT_LEN: usize = 165;

/// Pack an SPL Token mint. The mint authority is a throwaway key, since every
/// token the tests use already exists in pre-packed accounts.
fn mint_account_data(decimals: u8, supply: u64) -> Vec<u8> {
    let mut data = vec![0u8; MINT_ACCOUNT_LEN];
    // mint_authority: COption<Pubkey> = Some(throwaway).
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..36].copy_from_slice(Pubkey::new_unique().as_ref());
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1; // is_initialized
    // freeze_authority stays COption::None.
    data
}

/// Pack an SPL Token account in `Initialized` state.
fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; TOKEN_ACCOUNT_LEN];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1; // state: Initialized
    data
}

fn read_token_balance(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().expect("amount field"))
}

fn read_token_owner(data: &[u8]) -> [u8; 32] {
    data[32..64].try_into().expect("owner field")
}

/// PDA triple for one deal's vault: the vault state account and the token
/// account it owns, both seeded by the deal id. `Copy` so tests can hold it
/// while mutating the fixture.
#[derive(Clone, Copy)]
struct VaultHandles {
    deal_id: [u8; 16],
    vault: Pubkey,
    vault_tokens: Pubkey,
}

/// An escrow fixture: one deal, one mint, a funded borrower, and the two
/// protocol authority keys. A standing keypair plays each authority role — on
/// chain these pubkeys would be CPI signer PDAs of the loan lifecycle and
/// liquidation engine programs, and Anchor's `address =` constraint cannot
/// tell the difference, precisely because it checks an address rather than an
/// identity.
struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,
    borrower: Keypair,
    outsider: Keypair,
    loan_authority: Keypair,
    liquidation_authority: Keypair,
    mint: Pubkey,
    borrower_account: Pubkey,
    /// Same mint, owned by the outsider — used to test destination binding.
    outsider_account: Pubkey,
    deal: VaultHandles,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let program_id = Pubkey::new_from_array(escrow_vault::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let borrower = Keypair::new();
        let outsider = Keypair::new();
        let loan_authority = Keypair::new();
        let liquidation_authority = Keypair::new();
        for kp in [&borrower, &outsider, &loan_authority, &liquidation_authority] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }

        let token_program = token_program_id();
        let mint = Keypair::new().pubkey();
        let borrower_account = Keypair::new().pubkey();
        let outsider_account = Keypair::new().pubkey();

        let mut deal_id = [0u8; 16];
        deal_id.copy_from_slice(&Keypair::new().pubkey().to_bytes()[..16]);
        let (vault, _) = Pubkey::find_program_address(&[b"vault", deal_id.as_ref()], &program_id);
        let (vault_tokens, _) =
            Pubkey::find_program_address(&[b"vault-tokens", deal_id.as_ref()], &program_id);

        let mut fixture = Self {
            svm,
            program_id,
            payer,
            borrower,
            outsider,
            loan_authority,
            liquidation_authority,
            mint,
            borrower_account,
            outsider_account,
            deal: VaultHandles { deal_id, vault, vault_tokens },
        };
        let borrower_pk = fixture.borrower.pubkey();
        let outsider_pk = fixture.outsider.pubkey();
        fixture.write_account(mint, mint_account_data(8, BORROWER_STARTING_ATOMS), token_program);
        fixture.write_account(
            borrower_account,
            token_account_data(&mint, &borrower_pk, BORROWER_STARTING_ATOMS),
            token_program,
        );
        fixture.write_account(
            outsider_account,
            token_account_data(&mint, &outsider_pk, BORROWER_STARTING_ATOMS),
            token_program,
        );
        fixture
    }

    /// Derive the PDAs for a second deal in the same SVM (cross-deal tests).
    fn second_deal(&self) -> VaultHandles {
        let mut deal_id = [0u8; 16];
        deal_id.copy_from_slice(&Keypair::new().pubkey().to_bytes()[..16]);
        let (vault, _) =
            Pubkey::find_program_address(&[b"vault", deal_id.as_ref()], &self.program_id);
        let (vault_tokens, _) =
            Pubkey::find_program_address(&[b"vault-tokens", deal_id.as_ref()], &self.program_id);
        VaultHandles { deal_id, vault, vault_tokens }
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

    /// Submit one instruction signed by `signers`, returning the result.
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

    /// Build an instruction from Anchor's generated accounts and args types.
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

    /// Create the vault, recording the given authority keys.
    fn initialize_vault(
        &mut self,
        deal: &VaultHandles,
        loan_program: &Pubkey,
        liquidation_program: &Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            escrow_vault::accounts::InitializeVault {
                borrower: self.anchor_key(&self.borrower.pubkey()),
                vault: self.anchor_key(&deal.vault),
                collateral_mint: self.anchor_key(&self.mint),
                vault_token_account: self.anchor_key(&deal.vault_tokens),
                token_program: self.anchor_key(&token_program_id()),
                system_program: anchor_lang::system_program::ID,
            },
            escrow_vault::instruction::InitializeVault {
                deal_id: deal.deal_id,
                loan_program: self.anchor_key(loan_program),
                liquidation_program: self.anchor_key(liquidation_program),
            },
        );
        let borrower = self.borrower.insecure_clone();
        self.send(ix, &[&borrower])
    }

    fn initialize_vault_with_fixture_authorities(
        &mut self,
        deal: &VaultHandles,
    ) -> std::result::Result<(), String> {
        let loan = self.loan_authority.pubkey();
        let liq = self.liquidation_authority.pubkey();
        self.initialize_vault(deal, &loan, &liq)
    }

    fn deposit(&mut self, deal: &VaultHandles, amount: u64) -> std::result::Result<(), String> {
        let borrower = self.borrower.insecure_clone();
        let account = self.borrower_account;
        self.deposit_from(deal, amount, &borrower, account)
    }

    /// Deposit signed by `who`, drawing from `from_account`.
    fn deposit_from(
        &mut self,
        deal: &VaultHandles,
        amount: u64,
        who: &Keypair,
        from_account: Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            escrow_vault::accounts::DepositCollateral {
                vault: self.anchor_key(&deal.vault),
                borrower: self.anchor_key(&who.pubkey()),
                collateral_mint: self.anchor_key(&self.mint),
                borrower_token_account: self.anchor_key(&from_account),
                vault_token_account: self.anchor_key(&deal.vault_tokens),
                token_program: self.anchor_key(&token_program_id()),
            },
            escrow_vault::instruction::DepositCollateral { amount },
        );
        self.send(ix, &[who])
    }

    fn lock_with(
        &mut self,
        deal: &VaultHandles,
        who: &Keypair,
        required_atoms: u64,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            escrow_vault::accounts::LoanAuthorityAction {
                vault: self.anchor_key(&deal.vault),
                authority: self.anchor_key(&who.pubkey()),
            },
            escrow_vault::instruction::LockVault { required_atoms },
        );
        self.send(ix, &[who])
    }

    /// Release attempt by `who` into `destination`. On the honest path `who`
    /// is the loan authority and `destination` the borrower's account.
    fn release_with(
        &mut self,
        deal: &VaultHandles,
        who: &Keypair,
        destination: Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            escrow_vault::accounts::ReleaseCollateral {
                vault: self.anchor_key(&deal.vault),
                authority: self.anchor_key(&who.pubkey()),
                collateral_mint: self.anchor_key(&self.mint),
                vault_token_account: self.anchor_key(&deal.vault_tokens),
                borrower_token_account: self.anchor_key(&destination),
                token_program: self.anchor_key(&token_program_id()),
            },
            escrow_vault::instruction::ReleaseCollateral {},
        );
        self.send(ix, &[who])
    }

    /// Seize attempt by `who` into `recipient`.
    fn seize_with(
        &mut self,
        deal: &VaultHandles,
        who: &Keypair,
        amount: u64,
        recipient: Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            escrow_vault::accounts::SeizeCollateral {
                vault: self.anchor_key(&deal.vault),
                authority: self.anchor_key(&who.pubkey()),
                collateral_mint: self.anchor_key(&self.mint),
                vault_token_account: self.anchor_key(&deal.vault_tokens),
                recipient_token_account: self.anchor_key(&recipient),
                token_program: self.anchor_key(&token_program_id()),
            },
            escrow_vault::instruction::SeizeCollateral { amount },
        );
        self.send(ix, &[who])
    }

    /// Deposit the full collateral and lock it, as the loan program would.
    fn locked_vault(&mut self, deal: &VaultHandles, atoms: u64) {
        self.initialize_vault_with_fixture_authorities(deal).expect("init");
        self.deposit(deal, atoms).expect("deposit");
        let loan = self.loan_authority.insecure_clone();
        self.lock_with(deal, &loan, atoms).expect("lock");
    }

    fn read_vault(&self, at: &Pubkey) -> escrow_vault::Vault {
        let account = self.svm.get_account(at).expect("vault account exists");
        escrow_vault::Vault::try_deserialize(&mut account.data.as_slice())
            .expect("vault deserializes")
    }

    fn token_balance_of(&self, at: &Pubkey) -> u64 {
        let data = self.svm.get_account(at).expect("token account exists").data;
        read_token_balance(&data)
    }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

#[test]
fn the_vault_records_its_authorities_and_starts_open() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.initialize_vault_with_fixture_authorities(&deal).unwrap();

    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.deal_id, deal.deal_id);
    assert_eq!(
        vault.borrower.to_bytes(),
        fixture.borrower.pubkey().to_bytes(),
        "the vault must remember whose collateral it holds"
    );
    assert_eq!(vault.collateral_mint.to_bytes(), fixture.mint.to_bytes());
    assert_eq!(vault.token_account.to_bytes(), deal.vault_tokens.to_bytes());
    assert_eq!(
        vault.loan_program.to_bytes(),
        fixture.loan_authority.pubkey().to_bytes(),
        "release and lock must be bound to exactly one authority"
    );
    assert_eq!(
        vault.liquidation_program.to_bytes(),
        fixture.liquidation_authority.pubkey().to_bytes(),
        "seizure must be bound to exactly one authority"
    );
    assert_eq!(vault.collateral_atoms, 0);
    assert_eq!(vault.state, escrow_vault::VaultState::Open);

    // The token account the vault just created is owned by the vault PDA —
    // no human key anywhere can sign for it.
    let token_account = fixture.svm.get_account(&deal.vault_tokens).unwrap();
    assert_eq!(read_token_owner(&token_account.data), deal.vault.to_bytes());
    assert_eq!(token_account.owner, token_program_id());
}

#[test]
fn a_vault_cannot_be_initialized_with_default_authorities() {
    // A default authority key would make every later release/seizure check
    // incoherent. Reject at creation, not at first use.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    let loan = fixture.loan_authority.pubkey();
    let liq = fixture.liquidation_authority.pubkey();

    let result = fixture.initialize_vault(&deal, &Pubkey::default(), &liq);
    assert_failed_with(&result, vault_error::INVALID_AUTHORITY);

    let result = fixture.initialize_vault(&deal, &loan, &Pubkey::default());
    assert_failed_with(&result, vault_error::INVALID_AUTHORITY);
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

#[test]
fn the_borrower_can_deposit_and_the_recorded_balance_tracks_exactly() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.initialize_vault_with_fixture_authorities(&deal).unwrap();

    fixture.deposit(&deal, 25_000_000).unwrap();
    fixture.deposit(&deal, 15_000_000).unwrap();

    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.collateral_atoms, COLLATERAL_ATOMS);
    assert_eq!(fixture.token_balance_of(&deal.vault_tokens), COLLATERAL_ATOMS);
    assert_eq!(
        fixture.token_balance_of(&fixture.borrower_account),
        BORROWER_STARTING_ATOMS - COLLATERAL_ATOMS
    );
    assert_eq!(vault.state, escrow_vault::VaultState::Open, "still taking deposits");
}

#[test]
fn a_zero_deposit_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.initialize_vault_with_fixture_authorities(&deal).unwrap();

    let result = fixture.deposit(&deal, 0);
    assert_failed_with(&result, vault_error::ZERO_AMOUNT);
}

#[test]
fn someone_other_than_the_borrower_cannot_deposit() {
    // The vault binds deposit authority to the recorded borrower. A stranger
    // who funds an account with the same mint still cannot deposit.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.initialize_vault_with_fixture_authorities(&deal).unwrap();

    let outsider_account = fixture.outsider_account;
    let result = {
        let outsider = fixture.outsider.insecure_clone();
        fixture.deposit_from(&deal, 1_000_000, &outsider, outsider_account)
    };
    assert_failed_with(&result, vault_error::UNAUTHORIZED_BORROWER);
    assert_eq!(fixture.read_vault(&deal.vault).collateral_atoms, 0);
}

#[test]
fn deposits_stop_once_the_vault_is_locked() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    let result = fixture.deposit(&deal, 1_000_000);
    assert_failed_with(&result, vault_error::VAULT_NOT_OPEN);
}

// ---------------------------------------------------------------------------
// Forged vault PDA
// ---------------------------------------------------------------------------

#[test]
fn a_forged_vault_pda_is_rejected() {
    // The strongest possible forgery: an exact byte copy of a real vault
    // account — same owner (the escrow program), same discriminator, same
    // internally-consistent data — relocated to an address that is not the
    // PDA for its embedded deal id. Anchor's `seeds =` constraint re-derives
    // the PDA from the stored deal id and bump and compares it to the
    // supplied account address, so the copy is useless.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    let real = fixture.svm.get_account(&deal.vault).unwrap();

    // Variant one: byte-perfect copy at a fresh (on-curve) address.
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
    let forged = VaultHandles { deal_id: deal.deal_id, vault: forgery, vault_tokens: deal.vault_tokens };
    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.lock_with(&forged, &loan, COLLATERAL_ATOMS);
    assert_failed_with(&result, CONSTRAINT_SEEDS);

    let liquidation = fixture.liquidation_authority.insecure_clone();
    let outsider_account = fixture.outsider_account;
    let result = fixture.seize_with(&forged, &liquidation, 1, outsider_account);
    assert_failed_with(&result, CONSTRAINT_SEEDS);

    // Variant two: the account is owned by the system program rather than the
    // escrow program. The owner check rejects it before any program logic.
    let wrong_owner = Keypair::new().pubkey();
    fixture
        .svm
        .set_account(
            wrong_owner,
            Account {
                lamports: real.lamports,
                data: real.data.clone(),
                owner: Pubkey::from_str("11111111111111111111111111111111").unwrap(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let forged = VaultHandles { deal_id: deal.deal_id, vault: wrong_owner, vault_tokens: deal.vault_tokens };
    let loan = fixture.loan_authority.insecure_clone();
    assert!(fixture.lock_with(&forged, &loan, 1).is_err());

    // Variant three: valid owner, corrupted discriminator.
    let mut corrupted = real.data.clone();
    corrupted[0] ^= 0xff;
    let bogus = Keypair::new().pubkey();
    fixture
        .svm
        .set_account(
            bogus,
            Account {
                lamports: real.lamports,
                data: corrupted,
                owner: fixture.program_id,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let forged = VaultHandles { deal_id: deal.deal_id, vault: bogus, vault_tokens: deal.vault_tokens };
    let loan = fixture.loan_authority.insecure_clone();
    assert!(fixture.lock_with(&forged, &loan, 1).is_err());

    // The real vault is untouched by every attempt.
    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.collateral_atoms, COLLATERAL_ATOMS);
    assert_eq!(vault.state, escrow_vault::VaultState::Locked);
}

#[test]
fn token_accounts_from_another_vault_are_rejected() {
    // Two legitimate vaults for two deals must not share parts: passing deal
    // B's token account while acting on deal A is rejected by the pinned
    // `token_account` recorded at initialization.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);
    let other = fixture.second_deal();
    fixture.locked_vault(&other, COLLATERAL_ATOMS);

    let loan = fixture.loan_authority.insecure_clone();
    let ix = fixture.instruction(
        escrow_vault::accounts::ReleaseCollateral {
            vault: fixture.anchor_key(&deal.vault),
            authority: fixture.anchor_key(&loan.pubkey()),
            collateral_mint: fixture.anchor_key(&fixture.mint),
            vault_token_account: fixture.anchor_key(&other.vault_tokens),
            borrower_token_account: fixture.anchor_key(&fixture.borrower_account),
            token_program: fixture.anchor_key(&token_program_id()),
        },
        escrow_vault::instruction::ReleaseCollateral {},
    );
    let result = fixture.send(ix, &[&loan]);
    assert_failed_with(&result, vault_error::INVALID_VAULT_TOKEN_ACCOUNT);
}

// ---------------------------------------------------------------------------
// Lock: the loan authority, and no one else
// ---------------------------------------------------------------------------

#[test]
fn only_the_loan_authority_can_lock_the_vault() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.initialize_vault_with_fixture_authorities(&deal).unwrap();
    fixture.deposit(&deal, COLLATERAL_ATOMS).unwrap();

    // The outsider cannot.
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.lock_with(&deal, &outsider, COLLATERAL_ATOMS);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    // The borrower — whose collateral is on the line — cannot.
    let borrower = fixture.borrower.insecure_clone();
    let result = fixture.lock_with(&deal, &borrower, COLLATERAL_ATOMS);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    // The *liquidation* authority is the wrong program for this action.
    let liquidation = fixture.liquidation_authority.insecure_clone();
    let result = fixture.lock_with(&deal, &liquidation, COLLATERAL_ATOMS);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    // The loan authority cannot lock a vault holding less than required.
    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.lock_with(&deal, &loan, COLLATERAL_ATOMS + 1);
    assert_failed_with(&result, vault_error::INSUFFICIENT_COLLATERAL);
    assert_eq!(fixture.read_vault(&deal.vault).state, escrow_vault::VaultState::Open);

    // The loan authority, at exactly the posted amount, locks.
    let loan = fixture.loan_authority.insecure_clone();
    fixture.lock_with(&deal, &loan, COLLATERAL_ATOMS).expect("loan authority locks");
    assert_eq!(fixture.read_vault(&deal.vault).state, escrow_vault::VaultState::Locked);

    // Locking is not idempotent: a second identical call must fail. A fresh
    // blockhash keeps the retry from being deduplicated as a resend of the
    // successful transaction.
    fixture.svm.expire_blockhash();
    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.lock_with(&deal, &loan, COLLATERAL_ATOMS);
    assert_failed_with(&result, vault_error::VAULT_NOT_OPEN);
}

// ---------------------------------------------------------------------------
// Seizure: the liquidation authority, and no one else
// ---------------------------------------------------------------------------

#[test]
fn only_the_liquidation_authority_can_seize_collateral() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    // The loan authority may release, but may never seize.
    let loan = fixture.loan_authority.insecure_clone();
    let outsider_account = fixture.outsider_account;
    let result = fixture.seize_with(&deal, &loan, 1_000_000, outsider_account);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    // The outsider cannot.
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.seize_with(&deal, &outsider, 1_000_000, outsider_account);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    // The borrower cannot "seize" their own collateral back.
    let borrower = fixture.borrower.insecure_clone();
    let borrower_account = fixture.borrower_account;
    let result = fixture.seize_with(&deal, &borrower, COLLATERAL_ATOMS, borrower_account);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    // The liquidation authority can.
    let liquidation = fixture.liquidation_authority.insecure_clone();
    fixture
        .seize_with(&deal, &liquidation, 1_000_000, outsider_account)
        .expect("liquidation authority seizes");
    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.collateral_atoms, COLLATERAL_ATOMS - 1_000_000);
    assert_eq!(vault.state, escrow_vault::VaultState::Locked);
}

#[test]
fn a_zero_seizure_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    let liquidation = fixture.liquidation_authority.insecure_clone();
    let outsider_account = fixture.outsider_account;
    let result = fixture.seize_with(&deal, &liquidation, 0, outsider_account);
    assert_failed_with(&result, vault_error::ZERO_AMOUNT);
}

#[test]
fn seizure_is_capped_by_the_recorded_balance_not_the_token_balance() {
    // Someone directly transfers extra tokens into the vault token account —
    // a refund, a mistake, or an attempt to inflate what the vault can pay
    // out. The vault must ignore the token balance and enforce its recorded
    // balance: `seize` beyond the record fails even though the token account
    // genuinely holds enough tokens to cover it.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    // The stray transfer: 30M atoms appear in the vault token account without
    // any instruction recording them.
    let mint = fixture.mint;
    let inflated = token_account_data(&mint, &deal.vault, COLLATERAL_ATOMS + 30_000_000);
    fixture.write_account(deal.vault_tokens, inflated, token_program_id());
    assert_eq!(fixture.token_balance_of(&deal.vault_tokens), COLLATERAL_ATOMS + 30_000_000);

    // One atom beyond the record is refused — with 70M actual tokens present.
    let liquidation = fixture.liquidation_authority.insecure_clone();
    let outsider_account = fixture.outsider_account;
    let result =
        fixture.seize_with(&deal, &liquidation, COLLATERAL_ATOMS + 1, outsider_account);
    assert_failed_with(&result, vault_error::INSUFFICIENT_COLLATERAL);

    // Exactly the recorded amount can still be seized. The 30M stray atoms
    // stay behind: the vault will not sweep them out as if they were
    // collateral — the documented trade-off of trusting the record over the
    // token balance. (Note for the audit trail: stray tokens sent to a vault
    // are permanently unspendable under the current instruction set, a
    // deliberate simplification accepted over a recover-and-sweep path.)
    let liquidation = fixture.liquidation_authority.insecure_clone();
    fixture
        .seize_with(&deal, &liquidation, COLLATERAL_ATOMS, outsider_account)
        .expect("recorded balance is seizable");
    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.collateral_atoms, 0);
    assert_eq!(vault.state, escrow_vault::VaultState::Closed);
    assert_eq!(
        fixture.token_balance_of(&deal.vault_tokens),
        30_000_000,
        "stray tokens are not swept"
    );
}

#[test]
fn a_partial_seizure_respects_the_twenty_percent_cap_and_leaves_the_remainder() {
    // The mandate: partial liquidation can never take more than 20% of posted
    // collateral for one missed payment, however large the shortfall. The cap
    // is computed in `persat_core::liquidation` — linked here, and fuzzed at
    // 10,000 cases per property in Pass 2 — and the vault is where that
    // computed amount meets real token movement. This test binds the two
    // layers: exactly the amount the cap allows is what the vault releases.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    // A $90k obligation against $40k of collateral would naively demand 2.36x
    // everything the borrower posted. The cap cuts it to 20%.
    let seized = persat_core::liquidation::partial_liquidation_amount(
        90_000_000_000,   // missed payment, 6-decimal USDC atoms
        500,              // 5% penalty
        COLLATERAL_ATOMS, // 0.4 BTC posted
        40_000_000_000,   // its USD value at $100k, 6-decimal atoms
        2_000,            // maxPartialLiquidationBps: the 20% policy cap
    )
    .expect("the cap calculation is total");
    assert_eq!(
        seized,
        COLLATERAL_ATOMS / 5,
        "the computed seizure must be exactly 20% of the collateral, never the debt"
    );

    let liquidation = fixture.liquidation_authority.insecure_clone();
    let outsider_account = fixture.outsider_account;
    fixture
        .seize_with(&deal, &liquidation, seized, outsider_account)
        .expect("a compliant partial seizure succeeds");
    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(
        vault.collateral_atoms,
        COLLATERAL_ATOMS - seized,
        "the other 80% stays securing the borrower's position"
    );
    assert_eq!(vault.state, escrow_vault::VaultState::Locked, "the loan continues");
    assert_eq!(
        fixture.token_balance_of(&outsider_account),
        BORROWER_STARTING_ATOMS + seized
    );

    // A full seizure (the full-liquidation path) closes the vault.
    let remaining = vault.collateral_atoms;
    let liquidation = fixture.liquidation_authority.insecure_clone();
    fixture.seize_with(&deal, &liquidation, remaining, outsider_account).unwrap();
    assert_eq!(fixture.read_vault(&deal.vault).state, escrow_vault::VaultState::Closed);

    // A closed vault releases and seizes nothing further. A fresh blockhash
    // keeps any byte-identical retry from being deduplicated as a resend.
    fixture.svm.expire_blockhash();
    let liquidation = fixture.liquidation_authority.insecure_clone();
    let result = fixture.seize_with(&deal, &liquidation, 1, outsider_account);
    assert_failed_with(&result, vault_error::VAULT_NOT_LOCKED);
}

// ---------------------------------------------------------------------------
// Release: the loan authority, to the borrower, and only while locked
// ---------------------------------------------------------------------------

#[test]
fn release_is_refused_until_the_vault_is_locked() {
    // Before activation the collateral is not the protocol's to return: a
    // release call against an Open vault fails, even from the loan authority.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.initialize_vault_with_fixture_authorities(&deal).unwrap();
    fixture.deposit(&deal, COLLATERAL_ATOMS).unwrap();

    let loan = fixture.loan_authority.insecure_clone();
    let destination = fixture.borrower_account;
    let result = fixture.release_with(&deal, &loan, destination);
    assert_failed_with(&result, vault_error::VAULT_NOT_LOCKED);
}

#[test]
fn a_non_authority_cannot_release_collateral() {
    // The headline access-control property: with the vault locked, no wallet
    // outside the loan authority can move a single atom out of it — not a
    // stranger, and not even toward the legitimate destination.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    let destination = fixture.borrower_account;
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.release_with(&deal, &outsider, destination);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    // The liquidation authority is also the wrong caller here: seizure is the
    // only path it may use.
    let liquidation = fixture.liquidation_authority.insecure_clone();
    let result = fixture.release_with(&deal, &liquidation, destination);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);

    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.collateral_atoms, COLLATERAL_ATOMS);
    assert_eq!(vault.state, escrow_vault::VaultState::Locked);
}

#[test]
fn the_borrower_cannot_release_their_own_collateral_while_locked() {
    // "Release while locked is refused" applies to the borrower above all:
    // once the vault is locked, economic ownership no longer implies control.
    // If the borrower could unilaterally withdraw, the lender's collateral
    // would be fiction.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    let destination = fixture.borrower_account;
    let borrower = fixture.borrower.insecure_clone();
    let result = fixture.release_with(&deal, &borrower, destination);
    assert_failed_with(&result, vault_error::UNAUTHORIZED_PROGRAM);
    assert_eq!(
        fixture.token_balance_of(&fixture.borrower_account),
        BORROWER_STARTING_ATOMS - COLLATERAL_ATOMS
    );
}

#[test]
fn the_loan_authority_can_release_everything_back_to_the_borrower_exactly_once() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.initialize_vault_with_fixture_authorities(&deal).unwrap();
    fixture.deposit(&deal, 25_000_000).unwrap();
    fixture.deposit(&deal, 15_000_000).unwrap();
    let loan = fixture.loan_authority.insecure_clone();
    fixture.lock_with(&deal, &loan, COLLATERAL_ATOMS).unwrap();

    let destination = fixture.borrower_account;
    let loan = fixture.loan_authority.insecure_clone();
    fixture.release_with(&deal, &loan, destination).expect("loan authority releases");

    assert_eq!(
        fixture.token_balance_of(&fixture.borrower_account),
        BORROWER_STARTING_ATOMS,
        "the borrower is made whole to the atom"
    );
    assert_eq!(fixture.token_balance_of(&deal.vault_tokens), 0);
    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.collateral_atoms, 0);
    assert_eq!(vault.state, escrow_vault::VaultState::Closed);

    // A second release of the same vault must fail; a fresh blockhash keeps
    // the retry from being deduplicated as a resend of the successful one.
    fixture.svm.expire_blockhash();
    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.release_with(&deal, &loan, destination);
    assert_failed_with(&result, vault_error::VAULT_NOT_LOCKED);
}

#[test]
fn release_to_an_account_not_owned_by_the_borrower_is_refused() {
    // Even the loan authority cannot redirect the release: the destination
    // account's owner must be the borrower recorded at vault creation. This
    // is the check that stops a compromised authority key from draining the
    // vault to itself in a single transaction.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal;
    fixture.locked_vault(&deal, COLLATERAL_ATOMS);

    let loan = fixture.loan_authority.insecure_clone();
    let outsider_account = fixture.outsider_account;
    let result = fixture.release_with(&deal, &loan, outsider_account);
    assert_failed_with(&result, vault_error::INVALID_DESTINATION);

    let vault = fixture.read_vault(&deal.vault);
    assert_eq!(vault.collateral_atoms, COLLATERAL_ATOMS);
    assert_eq!(fixture.token_balance_of(&deal.vault_tokens), COLLATERAL_ATOMS);
}
