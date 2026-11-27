// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPythMinimal {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);
}

contract PythPriceFeedAdapter {
    error InvalidParameter();
    error InvalidPythPrice();

    uint8 public constant DECIMALS = 8;

    IPythMinimal public immutable pyth;
    bytes32 public immutable priceId;
    string public description;

    constructor(address pyth_, bytes32 priceId_, string memory description_) {
        if (pyth_ == address(0) || priceId_ == bytes32(0)) revert InvalidParameter();
        pyth = IPythMinimal(pyth_);
        priceId = priceId_;
        description = description_;
    }

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        IPythMinimal.Price memory p = pyth.getPriceUnsafe(priceId);
        if (p.price <= 0 || p.publishTime == 0) revert InvalidPythPrice();

        answer = _scaleTo8(int256(p.price), p.expo);
        roundId = uint80(p.publishTime);
        answeredInRound = roundId;
        startedAt = p.publishTime;
        updatedAt = p.publishTime;
    }

    function _scaleTo8(int256 price, int32 expo) internal pure returns (int256) {
        int256 shift = int256(expo) + int256(uint256(DECIMALS));
        if (shift >= 0) {
            if (shift > 30) revert InvalidPythPrice();
            return price * int256(10 ** uint256(shift));
        }
        if (shift < -30) revert InvalidPythPrice();
        return price / int256(10 ** uint256(-shift));
    }
}
