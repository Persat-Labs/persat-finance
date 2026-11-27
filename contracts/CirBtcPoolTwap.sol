// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IUniswapV3PoolObserve {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

contract CirBtcPoolTwap {
    error InvalidPool();
    error InvalidParameter();
    error TickOutOfRange();

    uint256 private constant ONE = 1e18;
    uint256 private constant TICK_BASE = 1.0001e18;
    int256 private constant MAX_ABS_TICK = 400_000;

    IUniswapV3PoolObserve public immutable pool;
    uint32 public immutable twapWindow;
    bool public immutable cirBtcIsToken0;
    uint8 public immutable cirBtcDecimals;
    uint8 public immutable usdcDecimals;

    constructor(address pool_, address cirBtc_, address usdc_, uint32 twapWindow_) {
        if (pool_ == address(0) || cirBtc_ == address(0) || usdc_ == address(0)) revert InvalidParameter();
        if (twapWindow_ < 300) revert InvalidParameter();

        address token0 = IUniswapV3PoolObserve(pool_).token0();
        address token1 = IUniswapV3PoolObserve(pool_).token1();
        if (token0 == cirBtc_ && token1 == usdc_) {
            cirBtcIsToken0 = true;
        } else if (token0 == usdc_ && token1 == cirBtc_) {
            cirBtcIsToken0 = false;
        } else {
            revert InvalidPool();
        }

        pool = IUniswapV3PoolObserve(pool_);
        twapWindow = twapWindow_;
        cirBtcDecimals = IERC20Metadata(cirBtc_).decimals();
        usdcDecimals = IERC20Metadata(usdc_).decimals();
    }

    function twapPriceE18() external view returns (uint256) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        (int56[] memory tickCumulatives,) = pool.observe(secondsAgos);

        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int256 tick = int256(delta) / int256(uint256(twapWindow));
        if (delta < 0 && int256(delta) % int256(uint256(twapWindow)) != 0) tick--;

        uint256 token1PerToken0 = _tickToRatioE18(tick);
        uint256 usdcPerCirBtcRaw = cirBtcIsToken0 ? token1PerToken0 : Math.mulDiv(ONE, ONE, token1PerToken0);

        return Math.mulDiv(usdcPerCirBtcRaw, 10 ** cirBtcDecimals, 10 ** usdcDecimals);
    }

    function _tickToRatioE18(int256 tick) internal pure returns (uint256) {
        if (tick > MAX_ABS_TICK || tick < -MAX_ABS_TICK) revert TickOutOfRange();
        uint256 n = uint256(tick < 0 ? -tick : tick);
        uint256 result = ONE;
        uint256 base = TICK_BASE;
        while (n != 0) {
            if (n & 1 == 1) result = Math.mulDiv(result, base, ONE);
            n >>= 1;
            if (n != 0) base = Math.mulDiv(base, base, ONE);
        }
        return tick < 0 ? Math.mulDiv(ONE, ONE, result) : result;
    }
}
