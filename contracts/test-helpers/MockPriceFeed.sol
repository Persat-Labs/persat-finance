// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Mock Chainlink-style price feed (IPriceFeed interface) for Persat Finance unit tests.
/// Allows tests to configure price, staleness, and invalid-price scenarios.
contract MockPriceFeed {
    uint8 private _decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;
    uint80 private _answeredInRound;
    uint256 private _startedAt;

    constructor(uint8 decimals_, int256 answer_, uint256 updatedAt_) {
        _decimals = decimals_;
        _answer = answer_;
        _updatedAt = updatedAt_;
        _roundId = 1;
        _answeredInRound = 1;
        _startedAt = updatedAt_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    // --- Test helpers ---

    /// @dev Advance updatedAt to block.timestamp (fresh oracle).
    function setFresh() external {
        _updatedAt = block.timestamp;
        _startedAt = block.timestamp;
    }

    /// @dev Set a specific updatedAt so callers can drive staleness.
    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }

    /// @dev Set a new price answer.
    function setAnswer(int256 answer_) external {
        _answer = answer_;
    }

    /// @dev Make the oracle look stale (updatedAt far in the past).
    function makeStale(uint256 stalenessThreshold) external {
        _updatedAt = block.timestamp - stalenessThreshold - 1;
    }

    /// @dev Simulate answeredInRound < roundId (invalid price).
    function makeInvalidRound() external {
        _roundId = 2;
        _answeredInRound = 1;
    }

    /// @dev Simulate startedAt == 0 (incomplete round).
    function makeZeroStartedAt() external {
        _startedAt = 0;
    }

    /// @dev Simulate a non-positive price.
    function makeZeroPrice() external {
        _answer = 0;
    }

    /// @dev Simulate a negative price.
    function makeNegativePrice() external {
        _answer = -1;
    }
}
