//! Pass 1 — access-control tests against the real compiled program.
//!
//! These execute the actual SBF binary inside LiteSVM, an in-process Solana VM.
//! That distinction matters: the unit tests in each program verify *pure logic*,
//! but the security of this protocol rests just as heavily on Anchor's
//! `#[derive(Accounts)]` constraints — signer checks, `has_one`, PDA seeds. Those
//! are enforced by the runtime, so only a runtime test can prove they work.
//!
//! Governance is tested first because it is the protocol's security root: it
//! holds the emergency pause and authorises every parameter change. If its
//! 2-of-3 threshold or 24-hour timelock can be bypassed, nothing else matters.
//!
//! # Requires a compiled program
//!
//! LiteSVM loads `target/deploy/governance.so`, produced by `anchor build`. When
//! that file is absent these tests skip, so a plain `cargo test` on a fresh
//! checkout stays green:
//!
//! ```bash
//! cd contracts && anchor build --ignore-keys && cargo test -p protocol-tests
//! ```
//!
//! A skip is a real hazard: the suite reports "ok" having executed nothing, so
//! a broken access-control constraint would look green. CI therefore sets
//! `PERSAT_REQUIRE_PROGRAMS=1`, which converts a missing program into a hard
//! failure. Never set that variable off in CI to make a red build pass.

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

/// Path to the compiled program, relative to the contracts workspace root.
const PROGRAM_SO: &str = "target/deploy/governance.so";

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

/// A governance test fixture: a funded payer and three distinct signers.
struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,
    signers: [Keypair; 3],
    governance_pda: Pubkey,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let program_id = Pubkey::new_from_array(governance::ID.to_bytes());
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

        let signers = [Keypair::new(), Keypair::new(), Keypair::new()];
        for signer in &signers {
            svm.airdrop(&signer.pubkey(), 10_000_000_000).unwrap();
        }

        let (governance_pda, _) = Pubkey::find_program_address(&[b"governance"], &program_id);

        Self {
            svm,
            program_id,
            payer,
            signers,
            governance_pda,
        }
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
    fn instruction<A: ToAccountMetas, D: InstructionData>(&self, accounts: A, data: D) -> Instruction {
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

    /// Create the governance singleton with the three fixture signers.
    fn initialize(&mut self) -> std::result::Result<(), String> {
        let signer_keys = [
            self.anchor_key(&self.signers[0].pubkey()),
            self.anchor_key(&self.signers[1].pubkey()),
            self.anchor_key(&self.signers[2].pubkey()),
        ];
        let payer = self.anchor_key(&self.payer.pubkey());
        let gov = self.anchor_key(&self.governance_pda);
        let ix = self.instruction(
            governance::accounts::InitializeGovernance {
                payer,
                governance: gov,
                system_program: anchor_lang::system_program::ID,
            },
            governance::instruction::InitializeGovernance {
                signers: signer_keys,
            },
        );
        self.send(ix, &[])
    }

    /// Pause the protocol as `signer_index`.
    fn pause(&mut self, signer_index: usize) -> std::result::Result<(), String> {
        let gov = self.anchor_key(&self.governance_pda);
        let signer = self.anchor_key(&self.signers[signer_index].pubkey());
        let ix = self.instruction(
            governance::accounts::EmergencyAction {
                governance: gov,
                signer,
            },
            governance::instruction::EmergencyPause {},
        );
        let keypair = self.signers[signer_index].insecure_clone();
        self.send(ix, &[&keypair])
    }

    /// Attempt to pause as a wallet that is not a governance signer.
    fn pause_as(&mut self, outsider: &Keypair) -> std::result::Result<(), String> {
        let gov = self.anchor_key(&self.governance_pda);
        let signer = self.anchor_key(&outsider.pubkey());
        let ix = self.instruction(
            governance::accounts::EmergencyAction {
                governance: gov,
                signer,
            },
            governance::instruction::EmergencyPause {},
        );
        self.send(ix, &[outsider])
    }

    /// Unpause with two named signers.
    fn unpause(&mut self, first: usize, second: usize) -> std::result::Result<(), String> {
        let gov = self.anchor_key(&self.governance_pda);
        let first_key = self.anchor_key(&self.signers[first].pubkey());
        let second_key = self.anchor_key(&self.signers[second].pubkey());
        let ix = self.instruction(
            governance::accounts::EmergencyUnpause {
                governance: gov,
                first_signer: first_key,
                second_signer: second_key,
            },
            governance::instruction::EmergencyUnpause {},
        );
        let a = self.signers[first].insecure_clone();
        let b = self.signers[second].insecure_clone();
        if first == second {
            self.send(ix, &[&a])
        } else {
            self.send(ix, &[&a, &b])
        }
    }

    /// Read the on-chain paused flag.
    fn is_paused(&self) -> bool {
        let account = self.svm.get_account(&self.governance_pda).unwrap();
        // Layout: 8 discriminator + 3 * 32 signers + 1 paused.
        account.data[8 + 96]
            != 0
    }
}

#[test]
fn governance_initializes_with_three_distinct_signers() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().expect("initialization should succeed");

    let account = fixture.svm.get_account(&fixture.governance_pda).unwrap();
    assert!(!account.data.is_empty(), "governance account should exist");
    assert!(!fixture.is_paused(), "protocol should start unpaused");
}

#[test]
fn a_single_signer_can_trigger_the_emergency_pause() {
    // 1-of-3 with no timelock. Stopping the protocol is the safe direction: the
    // cost of a wrong pause is downtime, the cost of a delayed pause during an
    // exploit is user funds.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    fixture.pause(0).expect("any single signer may pause");
    assert!(fixture.is_paused(), "protocol should be paused");
}

#[test]
fn a_wallet_outside_the_signer_set_cannot_pause() {
    // The critical access-control check: pause is powerful, so an arbitrary
    // wallet must not reach it even though the instruction takes any signer.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let outsider = Keypair::new();
    fixture.svm.airdrop(&outsider.pubkey(), 10_000_000_000).unwrap();

    let result = fixture.pause_as(&outsider);
    assert!(result.is_err(), "an outsider must not be able to pause");
    assert!(!fixture.is_paused(), "protocol must remain unpaused");
}

#[test]
fn unpausing_requires_two_distinct_signers() {
    // Deliberately asymmetric: one signer stops the protocol, but restarting it
    // takes the full 2-of-3. Resuming must never be as easy as halting.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();
    fixture.pause(0).unwrap();
    assert!(fixture.is_paused());

    // The same signer twice must not satisfy the threshold.
    let duplicate = fixture.unpause(0, 0);
    assert!(duplicate.is_err(), "one signer must not unpause alone");
    assert!(fixture.is_paused(), "protocol must remain paused");

    // Two distinct signers succeed.
    fixture.unpause(0, 1).expect("2-of-3 should unpause");
    assert!(!fixture.is_paused(), "protocol should be unpaused");
}

#[test]
fn pausing_an_already_paused_protocol_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();
    fixture.pause(0).unwrap();

    let again = fixture.pause(1);
    assert!(again.is_err(), "double pause should be rejected");
}

#[test]
fn unpausing_a_running_protocol_is_rejected() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let result = fixture.unpause(0, 1);
    assert!(result.is_err(), "unpausing when not paused should be rejected");
}

#[test]
fn the_governance_singleton_cannot_be_initialized_twice() {
    // The PDA is seeded by a constant, so a second initialization would either
    // fail or silently reset the signer set. It must fail.
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let second = fixture.initialize();
    assert!(second.is_err(), "re-initialization must be rejected");
}
