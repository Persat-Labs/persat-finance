//! Pass 1 — runtime tests against the real compiled deal registry.
//!
//! The registry is the protocol's entry point for both counterparty paths, and
//! two of its guarantees only exist at runtime, enforced by Anchor's account
//! validation rather than by anything a host unit test can see:
//!
//! * **Terms-hash binding.** `confirm_deal` requires the confirmer to present
//!   a SHA-256 of the exact terms they believe they are agreeing to. A stale
//!   or tampered client screen — one number changed anywhere — produces a
//!   different hash and the binding fails. These tests prove that per field.
//! * **State-transition authority.** `begin_funding`, `mark_active`, and
//!   `close_deal` are bound to the protocol programs' recorded authorities via
//!   the registry config singleton. This matters especially for `close_deal`:
//!   the marketplace reputation signal is built from terminal deal states, so
//!   a wallet that could mark its own unpaid deal `Completed` could
//!   manufacture repayment history at will.
//!
//! # Requires a compiled program
//!
//! LiteSVM loads `target/deploy/deal_registry.so`, produced by `anchor build`.
//! CI sets `PERSAT_REQUIRE_PROGRAMS=1`; a missing program is a hard failure,
//! never a silent skip.

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
const PROGRAM_SO: &str = "target/deploy/deal_registry.so";

/// Anchor error codes for [`deal_registry::DealError`], in declaration order
/// (6000 is Anchor's error-code offset).
mod deal_error {
    pub const INVALID_PRINCIPAL: u32 = 6000;
    pub const INVALID_DURATION: u32 = 6003;
    pub const INVALID_LTV: u32 = 6004;
    pub const INVALID_COUNTERPARTY: u32 = 6007;
    pub const SELF_DEALING: u32 = 6008;
    pub const PUBLIC_DEAL_CANNOT_BIND_COUNTERPARTY: u32 = 6009;
    pub const TERMS_MISMATCH: u32 = 6010;
    pub const UNAUTHORIZED_COUNTERPARTY: u32 = 6011;
    pub const INVALID_STATE_TRANSITION: u32 = 6012;
    pub const UNAUTHORIZED_PROGRAM: u32 = 6014;
    pub const INVALID_AUTHORITY: u32 = 6015;
}

/// Anchor framework error `ConstraintSeeds`, the rejection a forged PDA must
/// produce.
const CONSTRAINT_SEEDS: u32 = 2006;

/// Principal: 10,000 USDC in 6-decimal atoms.
const PRINCIPAL_ATOMS: u64 = 10_000_000_000;
/// Collateral: 0.2 BTC in 8-decimal atoms.
const COLLATERAL_ATOMS: u64 = 20_000_000;

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
                     binding checks silently pass without executing."
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

/// Valid deal terms, shaped like a real 12-month marketplace position.
/// `rate` is 10% APR at the protocol 50% max LTV.
fn terms() -> deal_registry::DealTerms {
    deal_registry::DealTerms {
        principal_atoms: PRINCIPAL_ATOMS,
        loan_mint: anchor_lang::prelude::Pubkey::new_unique(),
        collateral_mint: anchor_lang::prelude::Pubkey::new_unique(),
        collateral_atoms: COLLATERAL_ATOMS,
        rate_bps: 1_000,
        duration_months: 12,
        ltv_bps: 5_000,
    }
}

/// PDA of a deal account.
#[derive(Clone, Copy)]
struct DealHandles {
    deal_id: [u8; 16],
    deal: Pubkey,
}

/// A registry fixture: a creator, a named counterparty, an outsider, and the
/// three protocol authority keys for state transitions. On chain the
/// authorities are CPI signer PDAs of the escrow vault, loan lifecycle, and
/// liquidation engine programs; the binding Anchor checks is an address
/// comparison, so standing keypairs exercise exactly the same path.
struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,
    creator: Keypair,
    counterparty: Keypair,
    outsider: Keypair,
    escrow_authority: Keypair,
    loan_authority: Keypair,
    liquidation_authority: Keypair,
    config_pda: Pubkey,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let program_id = Pubkey::new_from_array(deal_registry::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let creator = Keypair::new();
        let counterparty = Keypair::new();
        let outsider = Keypair::new();
        let escrow_authority = Keypair::new();
        let loan_authority = Keypair::new();
        let liquidation_authority = Keypair::new();
        for kp in [
            &creator,
            &counterparty,
            &outsider,
            &escrow_authority,
            &loan_authority,
            &liquidation_authority,
        ] {
            svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }

        let (config_pda, _) = Pubkey::find_program_address(&[b"registry-config"], &program_id);
        Self {
            svm,
            program_id,
            payer,
            creator,
            counterparty,
            outsider,
            escrow_authority,
            loan_authority,
            liquidation_authority,
            config_pda,
        }
    }

    fn deal_handles(&self) -> DealHandles {
        let mut deal_id = [0u8; 16];
        deal_id.copy_from_slice(&Keypair::new().pubkey().to_bytes()[..16]);
        let (deal, _) =
            Pubkey::find_program_address(&[b"deal", deal_id.as_ref()], &self.program_id);
        DealHandles { deal_id, deal }
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

    /// Create the registry authority singleton with explicit keys.
    fn initialize_registry_with(
        &mut self,
        escrow_authority: &Pubkey,
        loan_authority: &Pubkey,
        liquidation_authority: &Pubkey,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            deal_registry::accounts::InitializeRegistry {
                payer: self.anchor_key(&self.payer.pubkey()),
                config: self.anchor_key(&self.config_pda),
                system_program: anchor_lang::system_program::ID,
            },
            deal_registry::instruction::InitializeRegistry {
                escrow_authority: self.anchor_key(escrow_authority),
                loan_authority: self.anchor_key(loan_authority),
                liquidation_authority: self.anchor_key(liquidation_authority),
            },
        );
        self.send(ix, &[])
    }

    fn initialize_registry(&mut self) -> std::result::Result<(), String> {
        let e = self.escrow_authority.pubkey();
        let l = self.loan_authority.pubkey();
        let q = self.liquidation_authority.pubkey();
        self.initialize_registry_with(&e, &l, &q)
    }

    fn propose(
        &mut self,
        deal: &DealHandles,
        terms: &deal_registry::DealTerms,
        visibility: deal_registry::Visibility,
        creator_side: deal_registry::Side,
        counterparty: Option<anchor_lang::prelude::Pubkey>,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            deal_registry::accounts::ProposeDeal {
                creator: self.anchor_key(&self.creator.pubkey()),
                deal: self.anchor_key(&deal.deal),
                system_program: anchor_lang::system_program::ID,
            },
            deal_registry::instruction::ProposeDeal {
                deal_id: deal.deal_id,
                terms: *terms,
                visibility,
                creator_side,
                counterparty,
            },
        );
        let creator = self.creator.insecure_clone();
        self.send(ix, &[&creator])
    }

    fn confirm_with_hash(
        &mut self,
        deal: &DealHandles,
        who: &Keypair,
        expected_terms_hash: [u8; 32],
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            deal_registry::accounts::ConfirmDeal {
                confirmer: self.anchor_key(&who.pubkey()),
                deal: self.anchor_key(&deal.deal),
            },
            deal_registry::instruction::ConfirmDeal { expected_terms_hash },
        );
        self.send(ix, &[who])
    }

    fn cancel_as(
        &mut self,
        deal: &DealHandles,
        who: &Keypair,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            deal_registry::accounts::CancelDeal {
                actor: self.anchor_key(&who.pubkey()),
                deal: self.anchor_key(&deal.deal),
            },
            deal_registry::instruction::CancelDeal {},
        );
        self.send(ix, &[who])
    }

    fn begin_funding_as(
        &mut self,
        deal: &DealHandles,
        who: &Keypair,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            deal_registry::accounts::AdvanceState {
                authority: self.anchor_key(&who.pubkey()),
                deal: self.anchor_key(&deal.deal),
                config: self.anchor_key(&self.config_pda),
            },
            deal_registry::instruction::BeginFunding {},
        );
        self.send(ix, &[who])
    }

    fn mark_active_as(
        &mut self,
        deal: &DealHandles,
        who: &Keypair,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            deal_registry::accounts::AdvanceState {
                authority: self.anchor_key(&who.pubkey()),
                deal: self.anchor_key(&deal.deal),
                config: self.anchor_key(&self.config_pda),
            },
            deal_registry::instruction::MarkActive {},
        );
        self.send(ix, &[who])
    }

    fn close_as(
        &mut self,
        deal: &DealHandles,
        who: &Keypair,
        outcome: deal_registry::CloseOutcome,
    ) -> std::result::Result<(), String> {
        let ix = self.instruction(
            deal_registry::accounts::AdvanceState {
                authority: self.anchor_key(&who.pubkey()),
                deal: self.anchor_key(&deal.deal),
                config: self.anchor_key(&self.config_pda),
            },
            deal_registry::instruction::CloseDeal { outcome },
        );
        self.send(ix, &[who])
    }

    /// Drive a deal from proposal to `Active` through the honest path.
    fn active_deal(&mut self, deal: &DealHandles, t: &deal_registry::DealTerms) {
        self.propose(
            deal,
            t,
            deal_registry::Visibility::Private,
            deal_registry::Side::Borrower,
            Some(self.anchor_key(&self.counterparty.pubkey())),
        )
        .expect("propose");
        let counterparty = self.counterparty.insecure_clone();
        self.confirm_with_hash(deal, &counterparty, t.hash()).expect("confirm");
        let escrow = self.escrow_authority.insecure_clone();
        self.begin_funding_as(deal, &escrow).expect("begin funding");
        let loan = self.loan_authority.insecure_clone();
        self.mark_active_as(deal, &loan).expect("mark active");
    }

    fn read_deal(&self, at: &Pubkey) -> deal_registry::Deal {
        let account = self.svm.get_account(at).expect("deal account exists");
        deal_registry::Deal::try_deserialize(&mut account.data.as_slice())
            .expect("deal deserializes")
    }

    fn read_config(&self) -> deal_registry::RegistryConfig {
        let account = self.svm.get_account(&self.config_pda).expect("config exists");
        deal_registry::RegistryConfig::try_deserialize(&mut account.data.as_slice())
            .expect("config deserializes")
    }
}

// ---------------------------------------------------------------------------
// Registry configuration
// ---------------------------------------------------------------------------

#[test]
fn the_registry_records_the_three_protocol_authorities() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();

    let config = fixture.read_config();
    assert_eq!(config.escrow_authority.to_bytes(), fixture.escrow_authority.pubkey().to_bytes());
    assert_eq!(config.loan_authority.to_bytes(), fixture.loan_authority.pubkey().to_bytes());
    assert_eq!(
        config.liquidation_authority.to_bytes(),
        fixture.liquidation_authority.pubkey().to_bytes()
    );

    // The singleton cannot be reset by a second initialization.
    fixture.svm.expire_blockhash();
    let result = fixture.initialize_registry();
    assert!(result.is_err(), "the authority set must not be replaceable");
}

#[test]
fn the_registry_rejects_default_authorities() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let loan = fixture.loan_authority.pubkey();
    let liq = fixture.liquidation_authority.pubkey();
    let escrow = fixture.escrow_authority.pubkey();
    let default = Pubkey::default();

    let result = fixture.initialize_registry_with(&default, &loan, &liq);
    assert_failed_with(&result, deal_error::INVALID_AUTHORITY);
    let result = fixture.initialize_registry_with(&escrow, &default, &liq);
    assert_failed_with(&result, deal_error::INVALID_AUTHORITY);
    let result = fixture.initialize_registry_with(&escrow, &loan, &default);
    assert_failed_with(&result, deal_error::INVALID_AUTHORITY);
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

#[test]
fn a_deal_is_created_proposed_with_terms_recorded_verbatim() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();

    fixture
        .propose(
            &deal,
            &t,
            deal_registry::Visibility::Public,
            deal_registry::Side::Lender,
            None,
        )
        .unwrap();

    let stored = fixture.read_deal(&deal.deal);
    assert_eq!(stored.deal_id, deal.deal_id);
    assert_eq!(stored.creator.to_bytes(), fixture.creator.pubkey().to_bytes());
    assert_eq!(stored.terms, t, "terms must be stored exactly as offered");
    assert_eq!(stored.state, deal_registry::DealState::Proposed);
    assert_eq!(stored.visibility, deal_registry::Visibility::Public);
    assert_eq!(stored.origin, deal_registry::DealOriginKind::Marketplace);
    assert_eq!(stored.lender.to_bytes(), fixture.creator.pubkey().to_bytes());
    assert_eq!(stored.borrower.to_bytes(), anchor_lang::prelude::Pubkey::default().to_bytes());
}

#[test]
fn invalid_terms_are_rejected_at_proposal_time() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);

    let mut t = terms();
    t.principal_atoms = 0;
    let deal = fixture.deal_handles();
    let result = fixture.propose(
        &deal,
        &t,
        deal_registry::Visibility::Private,
        deal_registry::Side::Borrower,
        None,
    );
    assert_failed_with(&result, deal_error::INVALID_PRINCIPAL);

    // Above the protocol's 50% LTV ceiling — a policy constant, and rejection
    // must happen on chain, not merely in the frontend.
    let mut t = terms();
    t.ltv_bps = 5_001;
    let deal = fixture.deal_handles();
    let result = fixture.propose(
        &deal,
        &t,
        deal_registry::Visibility::Private,
        deal_registry::Side::Borrower,
        None,
    );
    assert_failed_with(&result, deal_error::INVALID_LTV);

    let mut t = terms();
    t.duration_months = 18;
    let deal = fixture.deal_handles();
    let result = fixture.propose(
        &deal,
        &t,
        deal_registry::Visibility::Private,
        deal_registry::Side::Borrower,
        None,
    );
    assert_failed_with(&result, deal_error::INVALID_DURATION);
}

#[test]
fn a_wallet_cannot_create_a_deal_against_itself() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();

    // Creator as its own counterparty would let one wallet manufacture
    // completed-loan history at zero risk.
    let creator_key = fixture.creator.pubkey();
    let result = fixture.propose(
        &deal,
        &t,
        deal_registry::Visibility::Private,
        deal_registry::Side::Borrower,
        Some(fixture.anchor_key(&creator_key)),
    );
    assert_failed_with(&result, deal_error::SELF_DEALING);

    let result = fixture.propose(
        &deal,
        &t,
        deal_registry::Visibility::Private,
        deal_registry::Side::Borrower,
        Some(anchor_lang::prelude::Pubkey::default()),
    );
    assert_failed_with(&result, deal_error::INVALID_COUNTERPARTY);
}

#[test]
fn a_public_listing_cannot_bind_a_counterparty_at_creation() {
    // A listing is open to anyone by definition; pre-binding one contradicts
    // publishing it and would create hidden private deals wearing a public
    // label.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();

    let counterparty_key = fixture.counterparty.pubkey();
    let result = fixture.propose(
        &deal,
        &t,
        deal_registry::Visibility::Public,
        deal_registry::Side::Lender,
        Some(fixture.anchor_key(&counterparty_key)),
    );
    assert_failed_with(&result, deal_error::PUBLIC_DEAL_CANNOT_BIND_COUNTERPARTY);
}

// ---------------------------------------------------------------------------
// Terms-hash binding — the mandate
// ---------------------------------------------------------------------------

#[test]
fn confirming_with_the_exact_terms_hash_binds_the_counterparty() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();

    // Open private deal: no counterparty bound at creation — the deal-link
    // path. The respondent confirms with a hash of what their screen showed.
    fixture
        .propose(&deal, &t, deal_registry::Visibility::Private, deal_registry::Side::Borrower, None)
        .unwrap();

    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).expect("exact hash confirms");

    let stored = fixture.read_deal(&deal.deal);
    assert_eq!(stored.state, deal_registry::DealState::Confirmed);
    assert_eq!(stored.borrower.to_bytes(), fixture.creator.pubkey().to_bytes());
    assert_eq!(stored.lender.to_bytes(), fixture.counterparty.pubkey().to_bytes());
}

#[test]
fn a_hash_for_any_other_terms_is_rejected_field_by_field() {
    // The binding must fail if *any single field* differs from what the
    // confirmer saw. This is the difference between "both parties agreed to
    // the same numbers" and a screen that quietly changed one.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();
    fixture
        .propose(&deal, &t, deal_registry::Visibility::Private, deal_registry::Side::Borrower, None)
        .unwrap();

    let mut mutations: Vec<(&str, deal_registry::DealTerms)> = Vec::new();
    let mut m = t;
    m.principal_atoms += 1;
    mutations.push(("principal", m));
    let mut m = t;
    m.collateral_atoms += 1;
    mutations.push(("collateral", m));
    let mut m = t;
    m.rate_bps += 1;
    mutations.push(("rate", m));
    let mut m = t;
    m.duration_months = 6;
    mutations.push(("duration", m));
    let mut m = t;
    m.ltv_bps -= 1;
    mutations.push(("ltv", m));
    let mut m = t;
    m.loan_mint = anchor_lang::prelude::Pubkey::new_unique();
    mutations.push(("loan mint", m));
    let mut m = t;
    m.collateral_mint = anchor_lang::prelude::Pubkey::new_unique();
    mutations.push(("collateral mint", m));
    let mut m = t;
    m.loan_mint = t.collateral_mint;
    m.collateral_mint = t.loan_mint;
    mutations.push(("swapped mints", m));

    for (field, mutated) in &mutations {
        let counterparty = fixture.counterparty.insecure_clone();
        let result = fixture.confirm_with_hash(&deal, &counterparty, mutated.hash());
        assert_failed_with(&result, deal_error::TERMS_MISMATCH);
        assert!(
            fixture.read_deal(&deal.deal).state == deal_registry::DealState::Proposed,
            "a mismatched {field} hash must leave the deal un-confirmed"
        );
    }

    // A garbage digest is no better than a digest for wrong terms.
    let counterparty = fixture.counterparty.insecure_clone();
    let result = fixture.confirm_with_hash(&deal, &counterparty, [0u8; 32]);
    assert_failed_with(&result, deal_error::TERMS_MISMATCH);

    // Every rejection was non-destructive: the honest confirmer can still
    // bind with the true terms afterwards.
    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).expect("still confirmable");
    assert_eq!(fixture.read_deal(&deal.deal).state, deal_registry::DealState::Confirmed);
}

#[test]
fn only_the_named_counterparty_can_confirm_a_prebound_deal() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();

    let counterparty_key = fixture.counterparty.pubkey();
    fixture
        .propose(
            &deal,
            &t,
            deal_registry::Visibility::Private,
            deal_registry::Side::Borrower,
            Some(fixture.anchor_key(&counterparty_key)),
        )
        .unwrap();

    // A deal-link thief: someone who is not the named counterparty holds the
    // correct terms hash. They still cannot bind themselves to the deal.
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.confirm_with_hash(&deal, &outsider, t.hash());
    assert_failed_with(&result, deal_error::UNAUTHORIZED_COUNTERPARTY);

    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).expect("named counterparty confirms");
}

#[test]
fn the_creator_cannot_confirm_their_own_deal() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();
    fixture
        .propose(&deal, &t, deal_registry::Visibility::Private, deal_registry::Side::Borrower, None)
        .unwrap();

    // With the *correct* hash — the rejection must be identity, not digest.
    let creator = fixture.creator.insecure_clone();
    let result = fixture.confirm_with_hash(&deal, &creator, t.hash());
    assert_failed_with(&result, deal_error::SELF_DEALING);
}

#[test]
fn a_confirmed_deal_cannot_be_confirmed_again() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();
    fixture
        .propose(&deal, &t, deal_registry::Visibility::Private, deal_registry::Side::Borrower, None)
        .unwrap();
    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).unwrap();

    // A second confirmer must not displace the first — even with the right
    // hash, the state gate fires first.
    fixture.svm.expire_blockhash();
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.confirm_with_hash(&deal, &outsider, t.hash());
    assert_failed_with(&result, deal_error::INVALID_STATE_TRANSITION);
    assert_eq!(
        fixture.read_deal(&deal.deal).lender.to_bytes(),
        fixture.counterparty.pubkey().to_bytes(),
        "the original counterparty is untouched"
    );
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

#[test]
fn the_creator_can_cancel_and_the_deal_is_dead() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();
    fixture
        .propose(&deal, &t, deal_registry::Visibility::Private, deal_registry::Side::Borrower, None)
        .unwrap();

    let creator = fixture.creator.insecure_clone();
    fixture.cancel_as(&deal, &creator).expect("creator cancels");
    assert_eq!(fixture.read_deal(&deal.deal).state, deal_registry::DealState::Cancelled);

    // Nothing can happen to a cancelled deal, even with the correct hash.
    let counterparty = fixture.counterparty.insecure_clone();
    let result = fixture.confirm_with_hash(&deal, &counterparty, t.hash());
    assert_failed_with(&result, deal_error::INVALID_STATE_TRANSITION);
}

#[test]
fn the_counterparty_can_cancel_but_an_outsider_cannot() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();
    let counterparty_key = fixture.counterparty.pubkey();
    fixture
        .propose(
            &deal,
            &t,
            deal_registry::Visibility::Private,
            deal_registry::Side::Borrower,
            Some(fixture.anchor_key(&counterparty_key)),
        )
        .unwrap();

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.cancel_as(&deal, &outsider);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_COUNTERPARTY);
    assert_eq!(fixture.read_deal(&deal.deal).state, deal_registry::DealState::Proposed);

    // The named counterparty declining a deal is the withdraw path.
    let counterparty = fixture.counterparty.insecure_clone();
    fixture.cancel_as(&deal, &counterparty).expect("counterparty cancels");
}

// ---------------------------------------------------------------------------
// State-transition authority
// ---------------------------------------------------------------------------

#[test]
fn funding_can_only_begin_via_the_escrow_authority() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let deal = fixture.deal_handles();
    let t = terms();
    let counterparty_key = fixture.counterparty.pubkey();
    fixture
        .propose(
            &deal,
            &t,
            deal_registry::Visibility::Private,
            deal_registry::Side::Borrower,
            Some(fixture.anchor_key(&counterparty_key)),
        )
        .unwrap();
    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).unwrap();

    // No random wallet may move the deal forward.
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.begin_funding_as(&deal, &outsider);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_PROGRAM);
    // Nor the authority of a different protocol program.
    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.begin_funding_as(&deal, &loan);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_PROGRAM);

    let escrow = fixture.escrow_authority.insecure_clone();
    fixture.begin_funding_as(&deal, &escrow).expect("escrow authority begins funding");
    assert_eq!(fixture.read_deal(&deal.deal).state, deal_registry::DealState::Funding);
}

#[test]
fn activation_can_only_be_marked_by_the_loan_authority() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let deal = fixture.deal_handles();
    let t = terms();
    let counterparty_key = fixture.counterparty.pubkey();
    fixture
        .propose(
            &deal,
            &t,
            deal_registry::Visibility::Private,
            deal_registry::Side::Borrower,
            Some(fixture.anchor_key(&counterparty_key)),
        )
        .unwrap();
    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).unwrap();
    let escrow = fixture.escrow_authority.insecure_clone();
    fixture.begin_funding_as(&deal, &escrow).unwrap();

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.mark_active_as(&deal, &outsider);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_PROGRAM);
    let escrow = fixture.escrow_authority.insecure_clone();
    let result = fixture.mark_active_as(&deal, &escrow);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_PROGRAM);

    let loan = fixture.loan_authority.insecure_clone();
    fixture.mark_active_as(&deal, &loan).expect("loan authority marks active");
    assert_eq!(fixture.read_deal(&deal.deal).state, deal_registry::DealState::Active);
}

#[test]
fn closing_requires_the_authority_of_the_correct_program() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();

    // Clean completion: only the loan authority may write `Completed`.
    let deal = fixture.deal_handles();
    let t = terms();
    fixture.active_deal(&deal, &t);

    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.close_as(&deal, &outsider, deal_registry::CloseOutcome::Completed);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_PROGRAM);
    // The liquidation authority cannot turn a live deal into a clean close.
    let liquidation = fixture.liquidation_authority.insecure_clone();
    let result = fixture.close_as(&deal, &liquidation, deal_registry::CloseOutcome::Completed);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_PROGRAM);
    let loan = fixture.loan_authority.insecure_clone();
    fixture
        .close_as(&deal, &loan, deal_registry::CloseOutcome::Completed)
        .expect("loan authority records completion");
    assert_eq!(fixture.read_deal(&deal.deal).state, deal_registry::DealState::Completed);

    // Terminal liquidation: only the liquidation authority may write it.
    let deal = fixture.deal_handles();
    let t = terms();
    fixture.active_deal(&deal, &t);
    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.close_as(&deal, &loan, deal_registry::CloseOutcome::FullyLiquidated);
    assert_failed_with(&result, deal_error::UNAUTHORIZED_PROGRAM);
    let liquidation = fixture.liquidation_authority.insecure_clone();
    fixture
        .close_as(&deal, &liquidation, deal_registry::CloseOutcome::FullyLiquidated)
        .expect("liquidation authority records liquidation");
    assert_eq!(fixture.read_deal(&deal.deal).state, deal_registry::DealState::FullyLiquidated);

    // And no authority may skip the machine: a confirmed-but-never-funded
    // deal cannot be closed at all.
    let deal = fixture.deal_handles();
    let t = terms();
    let counterparty_key = fixture.counterparty.pubkey();
    fixture
        .propose(
            &deal,
            &t,
            deal_registry::Visibility::Private,
            deal_registry::Side::Borrower,
            Some(fixture.anchor_key(&counterparty_key)),
        )
        .unwrap();
    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).unwrap();
    let loan = fixture.loan_authority.insecure_clone();
    let result = fixture.close_as(&deal, &loan, deal_registry::CloseOutcome::Completed);
    assert_failed_with(&result, deal_error::INVALID_STATE_TRANSITION);
}

#[test]
fn a_forged_deal_account_is_rejected() {
    // Same forgery class as the vault: an exact byte copy of a real deal at
    // an address that is not the PDA for its embedded deal id. The seeds
    // constraint re-derives the PDA and refuses the impostor.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize_registry().unwrap();
    let deal = fixture.deal_handles();
    let t = terms();
    fixture
        .propose(&deal, &t, deal_registry::Visibility::Private, deal_registry::Side::Borrower, None)
        .unwrap();

    let real = fixture.svm.get_account(&deal.deal).unwrap();
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

    let forged = DealHandles { deal_id: deal.deal_id, deal: forgery };
    let counterparty = fixture.counterparty.insecure_clone();
    let result = fixture.confirm_with_hash(&forged, &counterparty, t.hash());
    assert_failed_with(&result, CONSTRAINT_SEEDS);

    // The real deal remains confirmable.
    let counterparty = fixture.counterparty.insecure_clone();
    fixture.confirm_with_hash(&deal, &counterparty, t.hash()).expect("real deal unaffected");
}

// ---------------------------------------------------------------------------
// Marketplace path
// ---------------------------------------------------------------------------

#[test]
fn a_public_listing_can_be_claimed_by_any_respondent_with_the_exact_terms() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    let deal = fixture.deal_handles();
    let t = terms();

    fixture
        .propose(&deal, &t, deal_registry::Visibility::Public, deal_registry::Side::Lender, None)
        .unwrap();

    // Any respondent may match — but only against the exact terms offered.
    let mut wrong = t;
    wrong.rate_bps = 999;
    let outsider = fixture.outsider.insecure_clone();
    let result = fixture.confirm_with_hash(&deal, &outsider, wrong.hash());
    assert_failed_with(&result, deal_error::TERMS_MISMATCH);

    let outsider = fixture.outsider.insecure_clone();
    fixture.confirm_with_hash(&deal, &outsider, t.hash()).expect("exact terms match");

    let stored = fixture.read_deal(&deal.deal);
    assert_eq!(stored.state, deal_registry::DealState::Confirmed);
    assert_eq!(stored.lender.to_bytes(), fixture.creator.pubkey().to_bytes());
    assert_eq!(stored.borrower.to_bytes(), fixture.outsider.pubkey().to_bytes());
}
