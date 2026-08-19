//! Minimal, self-contained reader for Pyth `PriceUpdateV2` accounts.
//!
//! # Why this is hand-rolled rather than using `pyth-solana-receiver-sdk`
//!
//! The SDK is the normal choice and would be preferred. It cannot be used here
//! yet: `pyth-solana-receiver-sdk` 2.0.0 requires `anchor-lang ^1.0.2`, and the
//! protocol CI workflow pins the Anchor CLI to exactly 1.0.0. AVM refuses to
//! build when the resolved `anchor-lang` version and the installed CLI disagree.
//! No earlier Pyth release supports Anchor 1.x at all — 1.2.0 and below target
//! `anchor-lang ^0.32.1`.
//!
//! Rather than silently downgrade the oracle to a trusted-pusher design, this
//! module reads the account directly. The wire format is stable and small: an
//! 8-byte Anchor discriminator, a write authority, a verification level, and a
//! fixed-layout `PriceFeedMessage`. Every field offset below is derived from
//! the upstream definitions, cited inline.
//!
//! This is deliberately **read-only and defensive**. It never writes a Pyth
//! account, and it validates the discriminator, length, and owner before
//! interpreting a single byte of price data.
//!
//! Replace this module with the upstream SDK once CI can install Anchor 1.0.2.

use anchor_lang::prelude::*;

/// Anchor account discriminator for `PriceUpdateV2`.
///
/// `sha256("account:PriceUpdateV2")[..8]`. Checking this is what stops an
/// attacker handing us a different Pyth account type — a `TwapUpdate`, say —
/// whose bytes would otherwise deserialize into a plausible-looking price.
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// The Pyth Solana Receiver program, which owns every legitimate price update.
///
/// Same address on mainnet, devnet, and testnet.
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// How thoroughly Wormhole guardian signatures were checked for an update.
///
/// Mirrors `VerificationLevel` in the Pyth SDK. `Partial` updates lower the
/// number of guardians who must collude to forge a price, so this protocol
/// accepts `Full` only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

/// A decoded Pyth price feed message.
///
/// Field order matches `pythnet_sdk::messages::PriceFeedMessage`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

/// A decoded `PriceUpdateV2` account.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

// Byte offsets into the account data.
//
// Layout, from `PriceUpdateV2` and `PriceFeedMessage`:
//   0   ..8    discriminator
//   8   ..40   write_authority: Pubkey
//   40  ..     verification_level: enum
//              Borsh encodes an enum as a 1-byte variant index, followed by
//              that variant's fields. `Partial { num_signatures: u8 }` is
//              variant 0 and carries one extra byte; `Full` is variant 1 and
//              carries none. The message therefore starts at 42 for Partial
//              and 41 for Full.
const OFFSET_WRITE_AUTHORITY: usize = 8;
const OFFSET_VERIFICATION_LEVEL: usize = 40;
const VARIANT_PARTIAL: u8 = 0;
const VARIANT_FULL: u8 = 1;

/// Read `n` little-endian bytes at `offset`, or fail if out of range.
macro_rules! read_le {
    ($data:expr, $offset:expr, $ty:ty, $len:expr) => {{
        let start = $offset;
        let end = start
            .checked_add($len)
            .ok_or(PythError::MalformedPriceAccount)?;
        let slice = $data
            .get(start..end)
            .ok_or(PythError::MalformedPriceAccount)?;
        let mut buffer = [0u8; $len];
        buffer.copy_from_slice(slice);
        <$ty>::from_le_bytes(buffer)
    }};
}

impl PriceUpdateV2 {
    /// Decode and validate a Pyth price update account.
    ///
    /// Checks, before any price byte is trusted:
    ///
    /// 1. The account is owned by the Pyth receiver program. Without this an
    ///    attacker could pass an account they wrote themselves containing any
    ///    price they like — the single most important check here.
    /// 2. The Anchor discriminator matches `PriceUpdateV2`.
    /// 3. Every field lies within the account's actual data length.
    pub fn from_account_info(info: &AccountInfo) -> Result<Self> {
        require_keys_eq!(
            *info.owner,
            PYTH_RECEIVER_PROGRAM_ID,
            PythError::WrongPriceAccountOwner
        );
        let data = info
            .try_borrow_data()
            .map_err(|_| error!(PythError::MalformedPriceAccount))?;
        Self::deserialize(&data)
    }

    /// Decode from a raw account data slice.
    pub fn deserialize(data: &[u8]) -> Result<Self> {
        let discriminator = data
            .get(0..8)
            .ok_or(PythError::MalformedPriceAccount)?;
        require!(
            discriminator == PRICE_UPDATE_V2_DISCRIMINATOR,
            PythError::NotAPriceUpdateAccount
        );

        let authority_bytes: [u8; 32] = data
            .get(OFFSET_WRITE_AUTHORITY..OFFSET_WRITE_AUTHORITY + 32)
            .ok_or(PythError::MalformedPriceAccount)?
            .try_into()
            .map_err(|_| error!(PythError::MalformedPriceAccount))?;

        let variant = *data
            .get(OFFSET_VERIFICATION_LEVEL)
            .ok_or(PythError::MalformedPriceAccount)?;
        let (verification_level, message_offset) = match variant {
            VARIANT_PARTIAL => {
                let signatures = *data
                    .get(OFFSET_VERIFICATION_LEVEL + 1)
                    .ok_or(PythError::MalformedPriceAccount)?;
                (
                    VerificationLevel::Partial {
                        num_signatures: signatures,
                    },
                    OFFSET_VERIFICATION_LEVEL + 2,
                )
            }
            VARIANT_FULL => (VerificationLevel::Full, OFFSET_VERIFICATION_LEVEL + 1),
            // An unknown variant means the format changed underneath us. Refuse
            // rather than guess at an offset.
            _ => return Err(error!(PythError::MalformedPriceAccount)),
        };

        let feed_id: [u8; 32] = data
            .get(message_offset..message_offset + 32)
            .ok_or(PythError::MalformedPriceAccount)?
            .try_into()
            .map_err(|_| error!(PythError::MalformedPriceAccount))?;

        let price = read_le!(data, message_offset + 32, i64, 8);
        let conf = read_le!(data, message_offset + 40, u64, 8);
        let exponent = read_le!(data, message_offset + 48, i32, 4);
        let publish_time = read_le!(data, message_offset + 52, i64, 8);
        let prev_publish_time = read_le!(data, message_offset + 60, i64, 8);
        let ema_price = read_le!(data, message_offset + 68, i64, 8);
        let ema_conf = read_le!(data, message_offset + 76, u64, 8);
        let posted_slot = read_le!(data, message_offset + 84, u64, 8);

        Ok(Self {
            write_authority: Pubkey::new_from_array(authority_bytes),
            verification_level,
            price_message: PriceFeedMessage {
                feed_id,
                price,
                conf,
                exponent,
                publish_time,
                prev_publish_time,
                ema_price,
                ema_conf,
            },
            posted_slot,
        })
    }

    /// True when this update carries a full Wormhole quorum.
    pub fn is_fully_verified(&self) -> bool {
        matches!(self.verification_level, VerificationLevel::Full)
    }
}

/// Parse a 32-byte feed id from its hex representation, with or without `0x`.
pub fn feed_id_from_hex(input: &str) -> Result<[u8; 32]> {
    let trimmed = input.strip_prefix("0x").unwrap_or(input);
    require!(trimmed.len() == 64, PythError::InvalidFeedId);
    let mut out = [0u8; 32];
    let bytes = trimmed.as_bytes();
    let mut index = 0usize;
    while index < 32 {
        let high = hex_value(bytes[index * 2])?;
        let low = hex_value(bytes[index * 2 + 1])?;
        out[index] = (high << 4) | low;
        index += 1;
    }
    Ok(out)
}

fn hex_value(character: u8) -> Result<u8> {
    match character {
        b'0'..=b'9' => Ok(character - b'0'),
        b'a'..=b'f' => Ok(character - b'a' + 10),
        b'A'..=b'F' => Ok(character - b'A' + 10),
        _ => Err(error!(PythError::InvalidFeedId)),
    }
}

#[error_code]
pub enum PythError {
    #[msg("The price account is not owned by the Pyth receiver program.")]
    WrongPriceAccountOwner,
    #[msg("The account is not a Pyth PriceUpdateV2 account.")]
    NotAPriceUpdateAccount,
    #[msg("The Pyth price account data is malformed or truncated.")]
    MalformedPriceAccount,
    #[msg("The feed id is not valid 32-byte hex.")]
    InvalidFeedId,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a synthetic account body matching the upstream layout.
    fn encode(level: VerificationLevel, feed_id: [u8; 32], price: i64, conf: u64, expo: i32, publish_time: i64) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
        data.extend_from_slice(&[7u8; 32]); // write_authority
        match level {
            VerificationLevel::Partial { num_signatures } => {
                data.push(VARIANT_PARTIAL);
                data.push(num_signatures);
            }
            VerificationLevel::Full => data.push(VARIANT_FULL),
        }
        data.extend_from_slice(&feed_id);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&expo.to_le_bytes());
        data.extend_from_slice(&publish_time.to_le_bytes());
        data.extend_from_slice(&(publish_time - 1).to_le_bytes()); // prev_publish_time
        data.extend_from_slice(&price.to_le_bytes()); // ema_price
        data.extend_from_slice(&conf.to_le_bytes()); // ema_conf
        data.extend_from_slice(&42u64.to_le_bytes()); // posted_slot
        data
    }

    #[test]
    fn a_full_verification_update_round_trips() {
        let feed = [9u8; 32];
        let data = encode(VerificationLevel::Full, feed, 100_000_00000000, 5_00000000, -8, 1_700_000_000);
        let update = PriceUpdateV2::deserialize(&data).unwrap();
        assert_eq!(update.verification_level, VerificationLevel::Full);
        assert!(update.is_fully_verified());
        assert_eq!(update.price_message.feed_id, feed);
        assert_eq!(update.price_message.price, 100_000_00000000);
        assert_eq!(update.price_message.conf, 5_00000000);
        assert_eq!(update.price_message.exponent, -8);
        assert_eq!(update.price_message.publish_time, 1_700_000_000);
        assert_eq!(update.posted_slot, 42);
    }

    #[test]
    fn a_partial_update_decodes_with_the_shifted_offset() {
        // The extra signature byte shifts every subsequent field by one. If the
        // offset were wrong the price would decode to garbage.
        let feed = [3u8; 32];
        let data = encode(
            VerificationLevel::Partial { num_signatures: 4 },
            feed,
            77_777,
            11,
            -5,
            1_600_000_000,
        );
        let update = PriceUpdateV2::deserialize(&data).unwrap();
        assert_eq!(
            update.verification_level,
            VerificationLevel::Partial { num_signatures: 4 }
        );
        assert!(!update.is_fully_verified());
        assert_eq!(update.price_message.feed_id, feed);
        assert_eq!(update.price_message.price, 77_777);
        assert_eq!(update.price_message.exponent, -5);
    }

    #[test]
    fn a_wrong_discriminator_is_rejected() {
        let mut data = encode(VerificationLevel::Full, [1u8; 32], 1, 1, -8, 1);
        data[0] ^= 0xFF;
        assert!(PriceUpdateV2::deserialize(&data).is_err());
    }

    #[test]
    fn a_truncated_account_is_rejected_rather_than_read_out_of_bounds() {
        let data = encode(VerificationLevel::Full, [1u8; 32], 1, 1, -8, 1);
        for length in 0..data.len() {
            // Every prefix must fail cleanly, never panic.
            let _ = PriceUpdateV2::deserialize(&data[..length]);
        }
        assert!(PriceUpdateV2::deserialize(&data[..data.len() - 1]).is_err());
    }

    #[test]
    fn an_unknown_verification_variant_is_rejected() {
        let mut data = encode(VerificationLevel::Full, [1u8; 32], 1, 1, -8, 1);
        data[OFFSET_VERIFICATION_LEVEL] = 9;
        assert!(PriceUpdateV2::deserialize(&data).is_err());
    }

    #[test]
    fn the_btc_usd_feed_id_parses_from_hex() {
        let with_prefix =
            feed_id_from_hex("0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43")
                .unwrap();
        let without_prefix =
            feed_id_from_hex("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43")
                .unwrap();
        assert_eq!(with_prefix, without_prefix);
        assert_eq!(with_prefix[0], 0xe6);
        assert_eq!(with_prefix[31], 0x43);
    }

    #[test]
    fn uppercase_hex_parses_identically() {
        let lower =
            feed_id_from_hex("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43")
                .unwrap();
        let upper =
            feed_id_from_hex("E62DF6C8B4A85FE1A67DB44DC12DE5DB330F7AC66B72DC658AFEDF0F4A415B43")
                .unwrap();
        assert_eq!(lower, upper);
    }

    #[test]
    fn malformed_feed_ids_are_rejected() {
        assert!(feed_id_from_hex("").is_err());
        assert!(feed_id_from_hex("0x1234").is_err());
        // Correct length, invalid characters.
        assert!(feed_id_from_hex(&"z".repeat(64)).is_err());
    }

    #[test]
    fn two_different_feeds_never_collide() {
        let btc =
            feed_id_from_hex("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43")
                .unwrap();
        let eth =
            feed_id_from_hex("ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace")
                .unwrap();
        assert_ne!(btc, eth);
    }
}
