// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Returns tick cumulatives for a constant average tick, enough to test TWAP consumers.
contract MockUniswapV3Pool {
    address public token0;
    address public token1;
    int24 public averageTick;

    constructor(address token0_, address token1_, int24 averageTick_) {
        token0 = token0_;
        token1 = token1_;
        averageTick = averageTick_;
    }

    function setAverageTick(int24 tick) external {
        averageTick = tick;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            tickCumulatives[i] = int56(averageTick) * int56(int256(block.timestamp - secondsAgos[i]));
        }
    }
}
