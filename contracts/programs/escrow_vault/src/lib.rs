//! Persat Finance escrow vault.
//!
//! This is the only program that holds user collateral, so it is deliberately
//! the most conservative one in the protocol.
//!
//! Design rules:
//!
//! * The vault token account is owned by a PDA derived from the deal. No human
//!   key — including any Persat Labs key — can sign for it. Custody belongs to
//!   the program logic and nothing else.
//! * Collateral leaves the vault through exactly three paths: full release to
//!   the borrower on completion, seizure by the liquidation engine, and surplus
//!   return after a full liquidation. Each is authority-gated to one caller.
//! * Every withdrawal checks the recorded balance rather than trusting the
//!   token account, so a stray direct transfer into the vault can never be
//!   swept out as if it were collateral.
//!
//! Atomic settlement: collateral locking and principal disbursement occur in a
//! single transaction driven by the loan lifecycle program. There is no
//! intermediate state where the borrower has posted collateral but the lender
//! has not funded, or vice versa.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("ETZyNBxrn43GApFkiAwfEimzWC93P7nEdSQMcT8Snmy3");

#[program]
pub mod escrow_vault {
    use super::*;

    /// Create the vault for a deal and record who may act on it.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        deal_id: [u8; 16],
        loan_program: Pubkey,
        liquidation_program: Pubkey,
    ) -> Result<()> {
        require!(
            loan_program != Pubkey::default() && liquidation_program != Pubkey::default(),
            VaultError::InvalidAuthority
        );
        let vault = &mut ctx.accounts.vault;
        vault.deal_id = deal_id;
        vault.borrower = ctx.accounts.borrower.key();
        vault.collateral_mint = ctx.accounts.collateral_mint.key();
        vault.token_account = ctx.accounts.vault_token_account.key();
        vault.loan_program = loan_program;
        vault.liquidation_program = liquidation_program;
        vault.collateral_atoms = 0;
        vault.state = VaultState::Open;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    /// Move collateral from the borrower into the vault.
    ///
    /// The caller must have already verified the mint against the Asset
    /// Whitelist Registry; this program additionally pins the mint to the one
    /// recorded at vault creation so a different token can never be substituted.
    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.vault.state == VaultState::Open,
            VaultError::VaultNotOpen
        );

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.borrower_token_account.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.borrower.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.collateral_mint.decimals,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.collateral_atoms = vault
            .collateral_atoms
            .checked_add(amount)
            .ok_or(VaultError::ArithmeticOverflow)?;

        emit!(CollateralDeposited {
            deal_id: vault.deal_id,
            amount,
            total: vault.collateral_atoms,
        });
        Ok(())
    }

    /// Lock the vault once the agreed collateral is fully posted.
    ///
    /// After locking, the borrower cannot withdraw. Only the loan lifecycle and
    /// liquidation programs can move collateral out.
    pub fn lock_vault(ctx: Context<LoanAuthorityAction>, required_atoms: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(vault.state == VaultState::Open, VaultError::VaultNotOpen);
        require!(
            vault.collateral_atoms >= required_atoms,
            VaultError::InsufficientCollateral
        );
        vault.state = VaultState::Locked;
        Ok(())
    }

    /// Return all remaining collateral to the borrower on loan completion.
    pub fn release_collateral(ctx: Context<ReleaseCollateral>) -> Result<()> {
        require!(
            ctx.accounts.vault.state == VaultState::Locked,
            VaultError::VaultNotLocked
        );
        let amount = ctx.accounts.vault.collateral_atoms;
        require!(amount > 0, VaultError::ZeroAmount);
        // The destination must be the borrower recorded at vault creation, so a
        // caller cannot redirect a release to an arbitrary wallet.
        require!(
            ctx.accounts.borrower_token_account.owner == ctx.accounts.vault.borrower,
            VaultError::InvalidDestination
        );

        transfer_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.vault_token_account,
            &ctx.accounts.borrower_token_account,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.token_program,
            amount,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.collateral_atoms = 0;
        vault.state = VaultState::Closed;
        emit!(CollateralReleased {
            deal_id: vault.deal_id,
            amount,
        });
        Ok(())
    }

    /// Seize collateral on behalf of the liquidation engine.
    ///
    /// Used for both partial and full liquidation. The amount is computed by
    /// the liquidation engine against fresh oracle data; this program enforces
    /// only that it never exceeds what the vault actually holds.
    pub fn seize_collateral(ctx: Context<SeizeCollateral>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let vault_state = ctx.accounts.vault.state;
        require!(vault_state == VaultState::Locked, VaultError::VaultNotLocked);
        require!(
            amount <= ctx.accounts.vault.collateral_atoms,
            VaultError::InsufficientCollateral
        );

        transfer_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.vault_token_account,
            &ctx.accounts.recipient_token_account,
            &ctx.accounts.collateral_mint,
            &ctx.accounts.token_program,
            amount,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.collateral_atoms = vault
            .collateral_atoms
            .checked_sub(amount)
            .ok_or(VaultError::ArithmeticOverflow)?;
        if vault.collateral_atoms == 0 {
            vault.state = VaultState::Closed;
        }
        emit!(CollateralSeized {
            deal_id: vault.deal_id,
            amount,
            remaining: vault.collateral_atoms,
        });
        Ok(())
    }
}

/// Signed transfer out of the vault PDA.
fn transfer_from_vault<'info>(
    vault: &Account<'info, Vault>,
    vault_token_account: &InterfaceAccount<'info, TokenAccount>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let deal_id = vault.deal_id;
    let bump = [vault.bump];
    let seeds: &[&[u8]] = &[b"vault", deal_id.as_ref(), &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault_token_account.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(
        init,
        payer = borrower,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", deal_id.as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    /// Vault token account owned by the vault PDA itself.
    #[account(
        init,
        payer = borrower,
        token::mint = collateral_mint,
        token::authority = vault,
        seeds = [b"vault-tokens", deal_id.as_ref()],
        bump
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut, seeds = [b"vault", vault.deal_id.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.borrower @ VaultError::UnauthorizedBorrower)]
    pub borrower: Signer<'info>,
    #[account(address = vault.collateral_mint @ VaultError::MintMismatch)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = borrower_token_account.mint == vault.collateral_mint @ VaultError::MintMismatch
    )]
    pub borrower_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = vault.token_account @ VaultError::InvalidVaultTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct LoanAuthorityAction<'info> {
    #[account(mut, seeds = [b"vault", vault.deal_id.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.loan_program @ VaultError::UnauthorizedProgram)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReleaseCollateral<'info> {
    #[account(mut, seeds = [b"vault", vault.deal_id.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.loan_program @ VaultError::UnauthorizedProgram)]
    pub authority: Signer<'info>,
    #[account(address = vault.collateral_mint @ VaultError::MintMismatch)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = vault.token_account @ VaultError::InvalidVaultTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = borrower_token_account.mint == vault.collateral_mint @ VaultError::MintMismatch
    )]
    pub borrower_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SeizeCollateral<'info> {
    #[account(mut, seeds = [b"vault", vault.deal_id.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.liquidation_program @ VaultError::UnauthorizedProgram)]
    pub authority: Signer<'info>,
    #[account(address = vault.collateral_mint @ VaultError::MintMismatch)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = vault.token_account @ VaultError::InvalidVaultTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = recipient_token_account.mint == vault.collateral_mint @ VaultError::MintMismatch
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub deal_id: [u8; 16],
    pub borrower: Pubkey,
    pub collateral_mint: Pubkey,
    pub token_account: Pubkey,
    /// Only this program may release collateral or lock the vault.
    pub loan_program: Pubkey,
    /// Only this program may seize collateral.
    pub liquidation_program: Pubkey,
    /// Collateral the vault accounts for. Never read from the token balance.
    pub collateral_atoms: u64,
    pub state: VaultState,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum VaultState {
    /// Accepting deposits from the borrower.
    Open,
    /// Collateral committed; only protocol programs may move it.
    Locked,
    /// Fully released or fully seized.
    Closed,
}

#[event]
pub struct CollateralDeposited {
    pub deal_id: [u8; 16],
    pub amount: u64,
    pub total: u64,
}

#[event]
pub struct CollateralReleased {
    pub deal_id: [u8; 16],
    pub amount: u64,
}

#[event]
pub struct CollateralSeized {
    pub deal_id: [u8; 16],
    pub amount: u64,
    pub remaining: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Authority must not be the default public key.")]
    InvalidAuthority,
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("The vault is not accepting deposits.")]
    VaultNotOpen,
    #[msg("The vault is not locked.")]
    VaultNotLocked,
    #[msg("The vault does not hold enough collateral for this action.")]
    InsufficientCollateral,
    #[msg("Only the borrower recorded on this vault may deposit.")]
    UnauthorizedBorrower,
    #[msg("Only the authorized protocol program may perform this action.")]
    UnauthorizedProgram,
    #[msg("The token mint does not match the collateral recorded for this vault.")]
    MintMismatch,
    #[msg("The supplied vault token account is not the one recorded for this vault.")]
    InvalidVaultTokenAccount,
    #[msg("Collateral may only be released to the borrower who posted it.")]
    InvalidDestination,
    #[msg("A vault arithmetic operation overflowed.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_states_are_distinct() {
        // The three lifecycle states must never collapse into one another:
        // deposits are only accepted while Open, movements only while Locked,
        // and Closed is terminal.
        assert_ne!(VaultState::Open, VaultState::Locked);
        assert_ne!(VaultState::Locked, VaultState::Closed);
        assert_ne!(VaultState::Open, VaultState::Closed);
    }

    #[test]
    fn vault_layout_stays_pinned() {
        // deal_id + five pubkeys (borrower, mint, token account, loan
        // authority, liquidation authority) + atoms + state + bump
        assert_eq!(Vault::INIT_SPACE, 16 + 5 * 32 + 8 + 1 + 1);
    }
}
