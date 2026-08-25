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
use solana_clock::Clock;
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
    ///
    /// The blockhash is rotated first: LiteSVM deduplicates transactions by
    /// signature, so an identical retry after a failure would be rejected as
    /// a replay (`AlreadyProcessed`) before the program ever runs. A real
    /// validator produces a new blockhash every block; tests that retry the
    /// same instruction after a deliberate failure must reach the program
    /// again for the rejection to prove anything.
    fn send(
        &mut self,
        instruction: Instruction,
        signers: &[&Keypair],
    ) -> std::result::Result<(), String> {
        self.svm.expire_blockhash();
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

/// Proposal-lifecycle helpers. The pause tests above cover the emergency
/// powers; these exercise the slower, higher-friction path every parameter
/// change must travel: propose -> approve -> timelock -> execute.
impl Fixture {
    /// Current VM time, so tests can measure windows relative to reality.
    fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    /// Move the VM clock, as a validator producing future slots would.
    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    /// Derive the proposal PDA: [b"proposal", governance, proposal_id le].
    fn proposal_pda(&self, proposal_id: u64) -> Pubkey {
        let gov = self.anchor_key(&self.governance_pda);
        Pubkey::find_program_address(
            &[b"proposal", gov.as_ref(), &proposal_id.to_le_bytes()],
            &self.program_id,
        )
        .0
    }

    /// Read the executed-proposal counter from the governance account.
    fn proposal_count(&self) -> u64 {
        let account = self.svm.get_account(&self.governance_pda).unwrap();
        // Layout: 8 discriminator + 96 signers + 1 paused + 8 proposal_count.
        let offset = 8 + 96 + 1;
        u64::from_le_bytes(
            account.data[offset..offset + 8]
                .try_into()
                .expect("governance account is large enough"),
        )
    }

    /// Propose a parameter change as `signers[signer_index]`.
    fn propose(&mut self, signer_index: usize, proposal_id: u64, payload: Vec<u8>) -> std::result::Result<(), String> {
        self.propose_with(&self.signers[signer_index].insecure_clone(), proposal_id, payload)
    }

    /// Attempt to propose with an arbitrary wallet.
    fn propose_with(&mut self, wallet: &Keypair, proposal_id: u64, payload: Vec<u8>) -> std::result::Result<(), String> {
        let gov = self.anchor_key(&self.governance_pda);
        let proposer = self.anchor_key(&wallet.pubkey());
        let proposal = self.anchor_key(&self.proposal_pda(proposal_id));
        let ix = self.instruction(
            governance::accounts::ProposeParameterChange {
                governance: gov,
                proposer,
                proposal,
                system_program: anchor_lang::system_program::ID,
            },
            governance::instruction::ProposeParameterChange {
                proposal_id,
                target_program: self.anchor_key(&self.program_id),
                action: governance::ParameterAction::SetFeeParameters,
                payload,
            },
        );
        self.send(ix, &[wallet])
    }

    /// Add `signers[signer_index]`'s approval to a proposal.
    fn approve(&mut self, signer_index: usize, proposal_id: u64) -> std::result::Result<(), String> {
        self.approve_with(&self.signers[signer_index].insecure_clone(), proposal_id)
    }

    /// Attempt to approve with an arbitrary wallet.
    fn approve_with(&mut self, wallet: &Keypair, proposal_id: u64) -> std::result::Result<(), String> {
        let gov = self.anchor_key(&self.governance_pda);
        let approver = self.anchor_key(&wallet.pubkey());
        let proposal = self.anchor_key(&self.proposal_pda(proposal_id));
        let ix = self.instruction(
            governance::accounts::ApproveProposal {
                governance: gov,
                approver,
                proposal,
            },
            governance::instruction::ApproveProposal {},
        );
        self.send(ix, &[wallet])
    }

    /// Execute a proposal as `signers[signer_index]`.
    fn execute_proposal(&mut self, signer_index: usize, proposal_id: u64) -> std::result::Result<(), String> {
        let gov = self.anchor_key(&self.governance_pda);
        let executor = self.anchor_key(&self.signers[signer_index].pubkey());
        let proposal = self.anchor_key(&self.proposal_pda(proposal_id));
        let ix = self.instruction(
            governance::accounts::ExecuteProposal {
                governance: gov,
                executor,
                proposal,
            },
            governance::instruction::ExecuteProposal {},
        );
        let keypair = self.signers[signer_index].insecure_clone();
        self.send(ix, &[&keypair])
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

// ---------------------------------------------------------------------------
// Parameter-change proposals: propose -> approve -> timelock -> execute.
// These paths authorize every risk-parameter, oracle, and fee change in the
// protocol, so the 2-of-3 threshold and 24-hour observation window must hold
// under the real runtime, not just in unit tests of the helpers.
// ---------------------------------------------------------------------------

#[test]
fn a_proposal_cannot_execute_before_the_timelock_elapses() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let start = fixture.now();
    fixture.propose(0, 1, vec![7u8; 16]).expect("a signer may propose");
    fixture.approve(1, 1).expect("a second signer may approve");

    // One second inside the 24-hour observation window: refuse.
    fixture.set_time(start + governance::TIMELOCK_SECONDS - 1);
    let early = fixture.execute_proposal(2, 1);
    assert!(
        early.is_err(),
        "a fully approved proposal must still wait out its timelock"
    );
    assert_eq!(fixture.proposal_count(), 0, "nothing executed yet");

    // Exactly at the boundary is permitted: the window is >=, not >.
    fixture.set_time(start + governance::TIMELOCK_SECONDS);
    fixture
        .execute_proposal(2, 1)
        .expect("execution at the timelock boundary should succeed");
    assert_eq!(fixture.proposal_count(), 1);
}

#[test]
fn one_approval_cannot_execute_a_parameter_change() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let start = fixture.now();
    // Proposing records the proposer's own approval: 1-of-3.
    fixture.propose(0, 1, vec![7u8; 16]).expect("a signer may propose");

    // Even with the timelock long past, a single approval must not execute.
    fixture.set_time(start + governance::TIMELOCK_SECONDS + 3600);
    let lonely = fixture.execute_proposal(1, 1);
    assert!(
        lonely.is_err(),
        "1-of-3 must never execute a parameter change"
    );
    assert_eq!(fixture.proposal_count(), 0);
}

#[test]
fn two_approvals_execute_a_proposal_exactly_once() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let start = fixture.now();
    fixture.propose(0, 1, vec![7u8; 16]).unwrap();
    fixture.approve(1, 1).unwrap();
    fixture.set_time(start + governance::TIMELOCK_SECONDS);

    fixture
        .execute_proposal(2, 1)
        .expect("2-of-3 approvals after the timelock should execute");
    assert_eq!(fixture.proposal_count(), 1);

    // A executed proposal is spent: no re-execution, no further approvals.
    let again = fixture.execute_proposal(0, 1);
    assert!(again.is_err(), "an executed proposal must not execute again");
    let late_approval = fixture.approve(2, 1);
    assert!(
        late_approval.is_err(),
        "approving an executed proposal must be rejected"
    );
    assert_eq!(fixture.proposal_count(), 1);
}

#[test]
fn a_signer_cannot_approve_a_proposal_twice() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    fixture.propose(0, 1, vec![7u8; 16]).unwrap();

    // The proposer's approval was recorded at proposal time; repeating it
    // must be an error, not a silent no-op, or 1 signer could fake 2-of-3.
    let duplicate_proposer = fixture.approve(0, 1);
    assert!(
        duplicate_proposer.is_err(),
        "the proposer must not approve their own proposal a second time"
    );

    // A distinct signer approving twice must likewise be rejected.
    fixture.approve(1, 1).expect("a first genuine approval succeeds");
    let duplicate_approver = fixture.approve(1, 1);
    assert!(
        duplicate_approver.is_err(),
        "a signer must not approve the same proposal twice"
    );
}

#[test]
fn a_proposal_expires_after_a_week() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    // Two fully approved proposals, created at the same instant.
    let start = fixture.now();
    fixture.propose(0, 1, vec![7u8; 16]).unwrap();
    fixture.approve(1, 1).unwrap();
    fixture.propose(0, 2, vec![8u8; 16]).unwrap();
    fixture.approve(2, 2).unwrap();

    // The last permitted second: past the timelock, before the expiry.
    fixture.set_time(start + governance::PROPOSAL_EXPIRY_SECONDS - 1);
    fixture
        .execute_proposal(0, 1)
        .expect("a proposal may execute up to the instant it expires");

    // At exactly the expiry the approvals are void; they cannot be banked
    // indefinitely and replayed long after the context has changed.
    fixture.set_time(start + governance::PROPOSAL_EXPIRY_SECONDS);
    let expired = fixture.execute_proposal(0, 2);
    assert!(expired.is_err(), "an expired proposal must not execute");
    assert_eq!(fixture.proposal_count(), 1);
}

#[test]
fn a_paused_protocol_refuses_to_execute_parameter_changes() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let start = fixture.now();
    fixture.propose(0, 1, vec![7u8; 16]).unwrap();
    fixture.approve(1, 1).unwrap();
    // Any signer may halt; while halted, governance must not enact changes.
    fixture.pause(2).expect("a single signer may pause");

    fixture.set_time(start + governance::TIMELOCK_SECONDS + 60);
    let blocked = fixture.execute_proposal(0, 1);
    assert!(
        blocked.is_err(),
        "a paused protocol must refuse to execute parameter changes"
    );
    assert_eq!(fixture.proposal_count(), 0);

    // Resuming takes the full 2-of-3; afterwards the proposal executes.
    fixture.unpause(0, 1).expect("2-of-3 resumes the protocol");
    fixture
        .execute_proposal(0, 1)
        .expect("after unpausing the approved proposal may execute");
    assert_eq!(fixture.proposal_count(), 1);
}

#[test]
fn an_oversized_payload_is_rejected_at_proposal_time() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let oversized = fixture.propose(0, 1, vec![0u8; governance::MAX_PAYLOAD_LEN + 1]);
    assert!(
        oversized.is_err(),
        "a payload above the cap must be rejected when proposed"
    );

    fixture
        .propose(0, 2, vec![0u8; governance::MAX_PAYLOAD_LEN])
        .expect("a payload at exactly the cap is permitted");
}

#[test]
fn a_wallet_outside_the_signer_set_cannot_propose_or_approve() {
    let bytes = require_program!();
    let mut fixture = Fixture::new(&bytes);
    fixture.initialize().unwrap();

    let outsider = Keypair::new();
    fixture.svm.airdrop(&outsider.pubkey(), 10_000_000_000).unwrap();

    fixture.propose(0, 1, vec![7u8; 16]).unwrap();

    let proposed = fixture.propose_with(&outsider, 2, vec![7u8; 16]);
    assert!(proposed.is_err(), "an outsider must not be able to propose");

    let approved = fixture.approve_with(&outsider, 1);
    assert!(approved.is_err(), "an outsider must not be able to approve");

    // The genuine signer's approval still lands afterwards.
    fixture.approve(1, 1).expect("a real signer may still approve");
}
