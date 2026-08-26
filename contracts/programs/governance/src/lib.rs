//! Persat Finance governance.
//!
//! This program is the protocol's security root. It owns two distinct powers,
//! deliberately given different thresholds because they carry opposite risks:
//!
//! * **Standard parameter changes** require 2-of-3 signatures *and* a 24-hour
//!   timelock. Changing risk parameters, oracle feeds, or fees is a
//!   high-consequence action, so it is slow and observable on purpose. Anyone
//!   watching the chain has a full day to react before a change executes.
//!
//! * **Emergency pause** requires only 1-of-3 and has no timelock. Stopping the
//!   protocol is the safe direction: the cost of a wrong pause is downtime, the
//!   cost of a delayed pause during an exploit is user funds. Unpausing is
//!   deliberately *not* symmetric — it takes the full 2-of-3 to resume.
//!
//! This program holds no funds and performs no token transfers. It only records
//! authority and publishes state that other programs read.

use anchor_lang::prelude::*;

declare_id!("gSCWC42bnn8XbRNXt7FdoGPGqG5dkfMihqYj8xhGwuj");

/// Number of governance signers. Fixed at three for the MVP.
pub const SIGNER_COUNT: usize = 3;
/// Signatures required for a standard parameter change.
pub const APPROVAL_THRESHOLD: u8 = 2;
/// Mandatory delay between proposing and executing a standard change.
pub const TIMELOCK_SECONDS: i64 = 24 * 60 * 60;
/// A proposal that is never executed expires, so stale approvals cannot be
/// banked indefinitely and replayed long after the context has changed.
pub const PROPOSAL_EXPIRY_SECONDS: i64 = 7 * 24 * 60 * 60;
/// Upper bound on an encoded parameter payload.
pub const MAX_PAYLOAD_LEN: usize = 128;

#[program]
pub mod governance {
    use super::*;

    /// Create the governance singleton with its three independent signers.
    pub fn initialize_governance(
        ctx: Context<InitializeGovernance>,
        signers: [Pubkey; SIGNER_COUNT],
    ) -> Result<()> {
        // Every signer must be a real, distinct key. A duplicated signer would
        // silently reduce 2-of-3 to 1-of-2 and defeat the whole threshold.
        for (index, signer) in signers.iter().enumerate() {
            require!(*signer != Pubkey::default(), GovernanceError::InvalidSigner);
            for other in signers.iter().skip(index.saturating_add(1)) {
                require!(signer != other, GovernanceError::DuplicateSigner);
            }
        }
        let governance = &mut ctx.accounts.governance;
        governance.signers = signers;
        governance.paused = false;
        governance.proposal_count = 0;
        governance.bump = ctx.bumps.governance;
        Ok(())
    }

    /// Propose a parameter change. Records the proposer's own approval.
    pub fn propose_parameter_change(
        ctx: Context<ProposeParameterChange>,
        proposal_id: u64,
        target_program: Pubkey,
        action: ParameterAction,
        payload: Vec<u8>,
    ) -> Result<()> {
        require!(
            payload.len() <= MAX_PAYLOAD_LEN,
            GovernanceError::PayloadTooLarge
        );
        let governance = &ctx.accounts.governance;
        let index = governance.signer_index(&ctx.accounts.proposer.key())?;
        let now = Clock::get()?.unix_timestamp;

        let proposal = &mut ctx.accounts.proposal;
        proposal.governance = governance.key();
        proposal.proposal_id = proposal_id;
        proposal.target_program = target_program;
        proposal.action = action;
        proposal.payload = payload;
        proposal.created_at = now;
        // The timelock starts at proposal time, not at the second approval, so
        // the full 24-hour observation window always applies.
        proposal.executable_at = now
            .checked_add(TIMELOCK_SECONDS)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
        proposal.expires_at = now
            .checked_add(PROPOSAL_EXPIRY_SECONDS)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
        proposal.approvals = [false; SIGNER_COUNT];
        proposal.approvals[index] = true;
        proposal.executed = false;
        proposal.bump = ctx.bumps.proposal;
        Ok(())
    }

    /// Add another signer's approval to an existing proposal.
    pub fn approve_proposal(ctx: Context<ApproveProposal>) -> Result<()> {
        let index = ctx
            .accounts
            .governance
            .signer_index(&ctx.accounts.approver.key())?;
        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.proposal;
        require!(!proposal.executed, GovernanceError::ProposalAlreadyExecuted);
        require!(now < proposal.expires_at, GovernanceError::ProposalExpired);
        // Re-approving is rejected rather than ignored, so a single signer can
        // never inflate the count toward the threshold.
        require!(
            !proposal.approvals[index],
            GovernanceError::DuplicateApproval
        );
        proposal.approvals[index] = true;
        Ok(())
    }

    /// Execute an approved proposal once its timelock has elapsed.
    ///
    /// This marks the proposal executed and emits the authorized change. The
    /// target program reads this record; governance never mutates another
    /// program's state directly.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let governance = &mut ctx.accounts.governance;
        let proposal = &mut ctx.accounts.proposal;

        require!(!proposal.executed, GovernanceError::ProposalAlreadyExecuted);
        require!(
            proposal.approval_count() >= APPROVAL_THRESHOLD,
            GovernanceError::InsufficientApprovals
        );
        require!(
            now >= proposal.executable_at,
            GovernanceError::TimelockNotElapsed
        );
        require!(now < proposal.expires_at, GovernanceError::ProposalExpired);
        // A paused protocol must not enact parameter changes; resuming is the
        // only governance action that should follow a pause.
        require!(!governance.paused, GovernanceError::ProtocolPaused);

        proposal.executed = true;
        governance.proposal_count = governance
            .proposal_count
            .checked_add(1)
            .ok_or(GovernanceError::ArithmeticOverflow)?;

        emit!(ProposalExecuted {
            proposal_id: proposal.proposal_id,
            target_program: proposal.target_program,
            action: proposal.action,
            executed_at: now,
        });
        Ok(())
    }

    /// Halt the protocol immediately. Any single governance signer may do this.
    pub fn emergency_pause(ctx: Context<EmergencyAction>) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        let governance = &mut ctx.accounts.governance;
        governance.signer_index(&signer)?;
        require!(!governance.paused, GovernanceError::AlreadyPaused);
        governance.paused = true;
        emit!(ProtocolPauseChanged {
            paused: true,
            actor: signer,
            at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Resume the protocol. Requires the full standard threshold, so restarting
    /// is never as easy as stopping.
    pub fn emergency_unpause(ctx: Context<EmergencyUnpause>) -> Result<()> {
        let first = ctx.accounts.first_signer.key();
        let second = ctx.accounts.second_signer.key();
        require!(first != second, GovernanceError::DuplicateApproval);
        let governance = &mut ctx.accounts.governance;
        governance.signer_index(&first)?;
        governance.signer_index(&second)?;
        require!(governance.paused, GovernanceError::NotPaused);
        governance.paused = false;
        emit!(ProtocolPauseChanged {
            paused: false,
            actor: first,
            at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeGovernance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Governance::INIT_SPACE,
        seeds = [b"governance"],
        bump
    )]
    pub governance: Account<'info, Governance>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ProposeParameterChange<'info> {
    #[account(seeds = [b"governance"], bump = governance.bump)]
    pub governance: Account<'info, Governance>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", governance.key().as_ref(), &proposal_id.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveProposal<'info> {
    #[account(seeds = [b"governance"], bump = governance.bump)]
    pub governance: Account<'info, Governance>,
    pub approver: Signer<'info>,
    #[account(
        mut,
        has_one = governance @ GovernanceError::ProposalGovernanceMismatch,
        seeds = [b"proposal", governance.key().as_ref(), &proposal.proposal_id.to_le_bytes()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut, seeds = [b"governance"], bump = governance.bump)]
    pub governance: Account<'info, Governance>,
    pub executor: Signer<'info>,
    #[account(
        mut,
        has_one = governance @ GovernanceError::ProposalGovernanceMismatch,
        seeds = [b"proposal", governance.key().as_ref(), &proposal.proposal_id.to_le_bytes()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct EmergencyAction<'info> {
    #[account(mut, seeds = [b"governance"], bump = governance.bump)]
    pub governance: Account<'info, Governance>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyUnpause<'info> {
    #[account(mut, seeds = [b"governance"], bump = governance.bump)]
    pub governance: Account<'info, Governance>,
    pub first_signer: Signer<'info>,
    pub second_signer: Signer<'info>,
}

/// The governance singleton. Other programs read `paused` and `signers`.
#[account]
#[derive(InitSpace)]
pub struct Governance {
    /// The three independent governance signers.
    pub signers: [Pubkey; SIGNER_COUNT],
    /// Global emergency stop.
    pub paused: bool,
    /// Number of proposals executed, for auditability.
    pub proposal_count: u64,
    pub bump: u8,
}

impl Governance {
    /// Position of `key` in the signer set, or an authorization error.
    pub fn signer_index(&self, key: &Pubkey) -> Result<usize> {
        self.signers
            .iter()
            .position(|signer| signer == key)
            .ok_or_else(|| error!(GovernanceError::UnauthorizedSigner))
    }
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub governance: Pubkey,
    pub proposal_id: u64,
    /// Program the change applies to.
    pub target_program: Pubkey,
    pub action: ParameterAction,
    #[max_len(MAX_PAYLOAD_LEN)]
    pub payload: Vec<u8>,
    pub created_at: i64,
    /// Earliest timestamp at which execution is permitted.
    pub executable_at: i64,
    /// Timestamp after which the proposal can no longer be executed.
    pub expires_at: i64,
    pub approvals: [bool; SIGNER_COUNT],
    pub executed: bool,
    pub bump: u8,
}

impl Proposal {
    /// Number of distinct signers who have approved.
    pub fn approval_count(&self) -> u8 {
        let mut count = 0u8;
        for approved in self.approvals.iter() {
            if *approved {
                count = count.saturating_add(1);
            }
        }
        count
    }
}

/// The categories of change governance may authorize.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ParameterAction {
    /// Add or update an asset in the whitelist registry.
    UpdateAssetParameters,
    /// Deactivate a whitelisted asset.
    DeactivateAsset,
    /// Change the oracle feed address.
    SetOracleFeed,
    /// Change the oracle staleness threshold.
    SetStalenessThreshold,
    /// Change origination fee parameters.
    SetFeeParameters,
    /// Change the treasury destination.
    SetTreasury,
}

#[event]
pub struct ProposalExecuted {
    pub proposal_id: u64,
    pub target_program: Pubkey,
    pub action: ParameterAction,
    pub executed_at: i64,
}

#[event]
pub struct ProtocolPauseChanged {
    pub paused: bool,
    pub actor: Pubkey,
    pub at: i64,
}

#[error_code]
pub enum GovernanceError {
    #[msg("A governance signer must not be the default public key.")]
    InvalidSigner,
    #[msg("Governance signers must be three distinct keys.")]
    DuplicateSigner,
    #[msg("This wallet is not a configured governance signer.")]
    UnauthorizedSigner,
    #[msg("This signer has already approved the proposal.")]
    DuplicateApproval,
    #[msg("The proposal has not reached the required 2-of-3 approvals.")]
    InsufficientApprovals,
    #[msg("The 24-hour governance timelock has not elapsed.")]
    TimelockNotElapsed,
    #[msg("The proposal has expired and must be resubmitted.")]
    ProposalExpired,
    #[msg("The proposal has already been executed.")]
    ProposalAlreadyExecuted,
    #[msg("The proposal does not belong to this governance account.")]
    ProposalGovernanceMismatch,
    #[msg("The protocol is paused.")]
    ProtocolPaused,
    #[msg("The protocol is already paused.")]
    AlreadyPaused,
    #[msg("The protocol is not paused.")]
    NotPaused,
    #[msg("The parameter payload exceeds the maximum permitted size.")]
    PayloadTooLarge,
    #[msg("A governance arithmetic operation overflowed.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn governance() -> Governance {
        Governance {
            signers: [
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                Pubkey::new_unique(),
            ],
            paused: false,
            proposal_count: 0,
            bump: 255,
        }
    }

    fn proposal(approvals: [bool; SIGNER_COUNT]) -> Proposal {
        Proposal {
            governance: Pubkey::new_unique(),
            proposal_id: 1,
            target_program: Pubkey::new_unique(),
            action: ParameterAction::SetFeeParameters,
            payload: vec![1, 2, 3],
            created_at: 100,
            executable_at: 100 + TIMELOCK_SECONDS,
            expires_at: 100 + PROPOSAL_EXPIRY_SECONDS,
            approvals,
            executed: false,
            bump: 255,
        }
    }

    #[test]
    fn signer_index_finds_each_configured_signer_in_order() {
        let governance = governance();
        for (index, signer) in governance.signers.iter().enumerate() {
            assert_eq!(governance.signer_index(signer).unwrap(), index);
        }
    }

    #[test]
    fn signer_index_refuses_keys_outside_the_signer_set() {
        let governance = governance();
        assert!(governance.signer_index(&Pubkey::new_unique()).is_err());
        assert!(governance.signer_index(&Pubkey::default()).is_err());
    }

    #[test]
    fn approval_counts_only_distinct_signer_slots() {
        assert_eq!(proposal([false; SIGNER_COUNT]).approval_count(), 0);
        assert_eq!(proposal([true, false, false]).approval_count(), 1);
        assert_eq!(proposal([false, true, true]).approval_count(), 2);
        assert_eq!(proposal([true, true, true]).approval_count(), 3);
    }

    #[test]
    fn the_proposer_alone_never_reaches_the_execution_threshold() {
        let one_approval = proposal([true, false, false]);
        assert!(one_approval.approval_count() < APPROVAL_THRESHOLD);
        let two_approvals = proposal([true, true, false]);
        assert!(two_approvals.approval_count() >= APPROVAL_THRESHOLD);
    }

    #[test]
    fn thresholds_and_windows_keep_their_documented_values() {
        assert_eq!(SIGNER_COUNT, 3);
        assert_eq!(APPROVAL_THRESHOLD, 2);
        assert_eq!(TIMELOCK_SECONDS, 24 * 60 * 60);
        assert_eq!(PROPOSAL_EXPIRY_SECONDS, 7 * 24 * 60 * 60);
        // A proposal must outlive its own timelock, or nothing could execute.
        assert!(PROPOSAL_EXPIRY_SECONDS > TIMELOCK_SECONDS);
        assert_eq!(MAX_PAYLOAD_LEN, 128);
    }

    #[test]
    fn account_layouts_stay_pinned() {
        // signers + paused + proposal_count + bump
        assert_eq!(Governance::INIT_SPACE, 3 * 32 + 1 + 8 + 1);
        // governance + id + target + action + payload (4 + MAX_PAYLOAD_LEN)
        // + three timestamps + approvals + executed + bump
        assert_eq!(
            Proposal::INIT_SPACE,
            32 + 8 + 32 + 1 + (4 + MAX_PAYLOAD_LEN) + 8 + 8 + 8 + SIGNER_COUNT + 1 + 1
        );
    }
}
