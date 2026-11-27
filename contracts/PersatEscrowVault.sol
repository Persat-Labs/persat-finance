// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PersatDealRegistry} from "./PersatDealRegistry.sol";

interface IPriceFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function decimals() external view returns (uint8);
}

interface IPegGuard {
    function twapPriceE18() external view returns (uint256);
}

contract PersatEscrowVault is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error OracleStale();
    error OracleInvalidPrice();
    error LTVHealthy();
    error InsufficientLTV();
    error TermsHashMismatch();
    error NotBorrower();
    error NotLender();
    error NotDealParty();
    error DealNotActive();
    error RepaymentFailed();
    error ZeroAddress();
    error FeeTooHigh();
    error CircBTCRescueBlocked();
    error RescueExceedsFreeBalance();
    error InvalidParameter();
    error InitialLtvTooHigh(uint256 ltvBps, uint256 maxLtvBps);
    error CirBtcDepegged(uint256 poolPriceE18, uint256 feedPriceE18);
    error TokenPaused();
    error TokensNotPaused();
    error NothingToWithdraw();
    error LiquidationsPaused(uint256 until);
    error LiquidationPauseTooLong();
    error LiquidationPauseCooldown(uint256 availableAt);
    error RenounceDisabled();

    event LoanActivated(
        bytes16 indexed dealId,
        address indexed borrower,
        address indexed lender,
        uint256 principal,
        uint256 collateral,
        uint256 fee,
        uint256 disbursedToBorrower
    );
    event LoanRepaid(bytes16 indexed dealId, uint256 totalRepayment, uint256 collateralReleased);
    event LoanLiquidated(bytes16 indexed dealId, address indexed liquidator, uint256 btcUsdPrice, uint256 ltvBps);
    event LiquidationSettled(
        bytes16 indexed dealId,
        uint256 usdcToLender,
        uint256 collateralToLiquidator,
        uint256 collateralToBorrower,
        bool overdue
    );
    event OracleFailureClaim(bytes16 indexed dealId, address indexed lender, uint256 collateral);
    event LoanDefaulted(bytes16 indexed dealId);
    event PaymentCredited(address indexed token, address indexed account, uint256 amount);
    event Withdrawn(address indexed token, address indexed account, uint256 amount);
    event TokenPauseNoted(uint256 timestamp);
    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeChangeQueued(uint256 newFeeBps, uint256 effectiveAt);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event CollateralAdded(bytes16 indexed dealId, uint256 amount, uint256 newLockedCollateral);
    event LiquidationsPausedUntil(uint256 until);

    uint256 public constant MAX_FEE_BPS = 50;
    uint256 public constant LOAN_MONTH = 30 days;
    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 public constant LATE_FEE_BPS = 200;
    uint256 public constant LIQUIDATION_BONUS_BPS = 300;
    uint256 public constant PAUSE_CURE_PERIOD = 3 days;
    uint256 public constant PAUSE_NOTE_GAP = 1 days;
    uint256 public constant ORACLE_FAILURE_DELAY = 30 days;
    uint256 public constant FEE_CHANGE_DELAY = 4 days;
    uint256 public constant MAX_PEG_DEVIATION_BPS = 200;
    uint256 public constant MAX_LIQUIDATION_PAUSE = 24 hours;
    uint256 public constant LIQUIDATION_GRACE = 6 hours;
    uint256 public constant LIQUIDATION_PAUSE_COOLDOWN = 3 days;

    IPriceFeed public immutable priceFeed;
    IPegGuard public immutable pegGuard;
    uint256 public immutable stalenessThreshold;
    uint256 public immutable liquidationThresholdBps;
    uint256 public immutable maxInitialLtvBps;
    uint8 public immutable priceFeedDecimals;
    uint8 public immutable cirBtcDecimals;
    address public immutable usdc;
    address public immutable cirBtc;
    PersatDealRegistry public immutable registry;

    mapping(bytes16 => uint256) public lockedCollateral;
    mapping(address => mapping(address => uint256)) public claimable;
    mapping(address => uint256) public totalClaimable;

    address public feeRecipient;
    uint256 public feeBps;
    uint256 public pendingFeeBps;
    uint256 public feeChangeEffectiveAt;
    uint256 public lastTokenPauseAt;
    uint256 public pauseEpisodeStart;
    uint256 public liquidationsPausedUntil;

    constructor(
        address registry_,
        address usdc_,
        address cirBtc_,
        address priceFeed_,
        uint256 stalenessThreshold_,
        uint256 liquidationThresholdBps_,
        uint256 maxInitialLtvBps_,
        address pegGuard_,
        address feeRecipient_,
        uint256 feeBps_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            registry_ == address(0) || usdc_ == address(0) || cirBtc_ == address(0) || priceFeed_ == address(0)
                || feeRecipient_ == address(0) || initialOwner == address(0)
        ) {
            revert ZeroAddress();
        }
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (stalenessThreshold_ == 0) revert InvalidParameter();
        if (liquidationThresholdBps_ == 0 || liquidationThresholdBps_ > 10_000) revert InvalidParameter();
        if (maxInitialLtvBps_ == 0 || maxInitialLtvBps_ >= liquidationThresholdBps_) revert InvalidParameter();

        registry = PersatDealRegistry(registry_);
        usdc = usdc_;
        cirBtc = cirBtc_;
        priceFeed = IPriceFeed(priceFeed_);
        pegGuard = IPegGuard(pegGuard_);
        stalenessThreshold = stalenessThreshold_;
        liquidationThresholdBps = liquidationThresholdBps_;
        maxInitialLtvBps = maxInitialLtvBps_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;

        priceFeedDecimals = IPriceFeed(priceFeed_).decimals();
        if (priceFeedDecimals < 6 || priceFeedDecimals > 18) revert InvalidParameter();
        cirBtcDecimals = IERC20Metadata(cirBtc_).decimals();
    }

    function activateLoan(bytes16 dealId) external nonReentrant whenNotPaused {
        PersatDealRegistry.Deal memory deal = registry.getDeal(dealId);

        if (deal.state != PersatDealRegistry.DealState.Confirmed) {
            revert DealNotActive();
        }
        if (msg.sender != deal.borrower && msg.sender != deal.lender) revert NotDealParty();
        if (_computeTermsHash(deal) != deal.termsHash) revert TermsHashMismatch();

        uint256 price = _readPrice();
        _checkPeg(price);
        uint256 ltvBps = _ltvBps(_principalPlusInterest(deal), _cirBtcToUsdcValue(deal.collateral, price));
        if (ltvBps > maxInitialLtvBps) revert InitialLtvTooHigh(ltvBps, maxInitialLtvBps);

        registry.setDealActive(dealId, block.timestamp);
        _syncFee();

        uint256 feeAmount = deal.principal * feeBps / 10_000;
        uint256 borrowerPrincipal = deal.principal - feeAmount;

        uint256 collateralBefore = IERC20(cirBtc).balanceOf(address(this));
        IERC20(cirBtc).safeTransferFrom(deal.borrower, address(this), deal.collateral);
        uint256 actualCollateral = IERC20(cirBtc).balanceOf(address(this)) - collateralBefore;

        lockedCollateral[dealId] = actualCollateral;

        IERC20(usdc).safeTransferFrom(deal.lender, deal.borrower, borrowerPrincipal);
        if (feeAmount > 0) {
            IERC20(usdc).safeTransferFrom(deal.lender, address(this), feeAmount);
            _pushOrCredit(usdc, feeRecipient, feeAmount);
        }

        emit LoanActivated(
            dealId, deal.borrower, deal.lender, deal.principal, actualCollateral, feeAmount, borrowerPrincipal
        );
    }

    function repayLoan(bytes16 dealId) external nonReentrant {
        PersatDealRegistry.Deal memory deal = registry.getDeal(dealId);

        bool isActive = deal.state == PersatDealRegistry.DealState.Active;
        bool isDefaulted = deal.state == PersatDealRegistry.DealState.Defaulted;
        if (!isActive && !isDefaulted) {
            revert DealNotActive();
        }
        if (msg.sender != deal.borrower) revert NotBorrower();
        if (_computeTermsHash(deal) != deal.termsHash) revert TermsHashMismatch();

        uint256 totalRepayment = _amountDue(deal);
        uint256 collateralToRelease = lockedCollateral[dealId];

        delete lockedCollateral[dealId];
        registry.setDealCompleted(dealId);

        IERC20(usdc).safeTransferFrom(deal.borrower, address(this), totalRepayment);
        _pushOrCredit(usdc, deal.lender, totalRepayment);
        _pushOrCredit(cirBtc, deal.borrower, collateralToRelease);

        emit LoanRepaid(dealId, totalRepayment, collateralToRelease);
    }

    function addCollateral(bytes16 dealId, uint256 amount) external nonReentrant {
        PersatDealRegistry.Deal memory deal = registry.getDeal(dealId);

        if (deal.state != PersatDealRegistry.DealState.Active) revert DealNotActive();
        if (msg.sender != deal.borrower) revert NotBorrower();
        if (amount == 0) revert InvalidParameter();

        uint256 before = IERC20(cirBtc).balanceOf(address(this));
        IERC20(cirBtc).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(cirBtc).balanceOf(address(this)) - before;

        lockedCollateral[dealId] += received;
        emit CollateralAdded(dealId, received, lockedCollateral[dealId]);
    }

    function liquidate(bytes16 dealId) external nonReentrant {
        if (block.timestamp < liquidationsPausedUntil) revert LiquidationsPaused(liquidationsPausedUntil);
        PersatDealRegistry.Deal memory deal = registry.getDeal(dealId);

        bool isActive = deal.state == PersatDealRegistry.DealState.Active;
        bool isDefaulted = deal.state == PersatDealRegistry.DealState.Defaulted;
        if (!isActive && !isDefaulted) revert DealNotActive();
        if (_computeTermsHash(deal) != deal.termsHash) revert TermsHashMismatch();
        if (_tokenPaused(usdc) || _tokenPaused(cirBtc)) revert TokenPaused();

        uint256 collateralAmount = lockedCollateral[dealId];
        uint256 opensAt = _liquidationOpensAt(deal);
        bool overdue = block.timestamp > opensAt;

        (bool priceOk, uint256 btcUsdPrice) = _tryReadPrice();
        if (!priceOk) {
            if (!overdue || block.timestamp <= opensAt + ORACLE_FAILURE_DELAY) {
                _readPrice();
                revert OracleInvalidPrice();
            }
            _oracleFailureClaim(dealId, deal, collateralAmount);
            return;
        }

        uint256 collateralUsdValue = _cirBtcToUsdcValue(collateralAmount, btcUsdPrice);
        uint256 debtUsdc = _amountDue(deal);
        uint256 ltvBps = _ltvBps(debtUsdc, collateralUsdValue);
        if (ltvBps < liquidationThresholdBps && !overdue) revert LTVHealthy();

        delete lockedCollateral[dealId];
        registry.setDealLiquidated(dealId);

        emit LoanLiquidated(dealId, msg.sender, btcUsdPrice, ltvBps);
        _settleLiquidation(dealId, deal, collateralAmount, collateralUsdValue, debtUsdc, btcUsdPrice, overdue);
    }

    function markDefault(bytes16 dealId) external nonReentrant {
        PersatDealRegistry.Deal memory deal = registry.getDeal(dealId);

        if (deal.state != PersatDealRegistry.DealState.Active) revert DealNotActive();
        if (block.timestamp <= _maturity(deal)) revert DealNotActive();

        registry.setDealDefaulted(dealId);
        emit LoanDefaulted(dealId);
    }

    function withdraw(address token) external nonReentrant {
        uint256 amount = claimable[token][msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        claimable[token][msg.sender] = 0;
        totalClaimable[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdrawn(token, msg.sender, amount);
    }

    function notePause() external {
        if (!_tokenPaused(usdc) && !_tokenPaused(cirBtc)) revert TokensNotPaused();
        if (lastTokenPauseAt == 0 || block.timestamp > lastTokenPauseAt + PAUSE_NOTE_GAP) {
            pauseEpisodeStart = block.timestamp;
        }
        lastTokenPauseAt = block.timestamp;
        emit TokenPauseNoted(block.timestamp);
    }

    function amountDue(bytes16 dealId) external view returns (uint256) {
        return _amountDue(registry.getDeal(dealId));
    }

    function maturityOf(bytes16 dealId) external view returns (uint256) {
        PersatDealRegistry.Deal memory deal = registry.getDeal(dealId);
        if (deal.activatedAt == 0) return 0;
        return _maturity(deal);
    }

    function liquidationOpensAt(bytes16 dealId) external view returns (uint256) {
        PersatDealRegistry.Deal memory deal = registry.getDeal(dealId);
        if (deal.activatedAt == 0) return 0;
        return _liquidationOpensAt(deal);
    }

    function currentFeeBps() public view returns (uint256) {
        if (feeChangeEffectiveAt != 0 && block.timestamp >= feeChangeEffectiveAt) return pendingFeeBps;
        return feeBps;
    }

    function rescueERC20(address token, address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        if (token == cirBtc) revert CircBTCRescueBlocked();
        if (amount > IERC20(token).balanceOf(address(this)) - totalClaimable[token]) {
            revert RescueExceedsFreeBalance();
        }

        IERC20(token).safeTransfer(recipient, amount);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = recipient;
        emit FeeRecipientUpdated(oldRecipient, recipient);
    }

    function setFeeBps(uint256 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        _syncFee();
        pendingFeeBps = feeBps_;
        feeChangeEffectiveAt = block.timestamp + FEE_CHANGE_DELAY;
        emit FeeChangeQueued(feeBps_, feeChangeEffectiveAt);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function pauseLiquidations(uint256 duration) external onlyOwner {
        if (duration == 0 || duration > MAX_LIQUIDATION_PAUSE) revert LiquidationPauseTooLong();
        uint256 availableAt = liquidationsPausedUntil == 0 ? 0 : liquidationsPausedUntil + LIQUIDATION_PAUSE_COOLDOWN;
        if (block.timestamp < availableAt) revert LiquidationPauseCooldown(availableAt);
        liquidationsPausedUntil = block.timestamp + duration + LIQUIDATION_GRACE;
        emit LiquidationsPausedUntil(liquidationsPausedUntil);
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function _settleLiquidation(
        bytes16 dealId,
        PersatDealRegistry.Deal memory deal,
        uint256 collateralAmount,
        uint256 collateralUsdValue,
        uint256 debtUsdc,
        uint256 btcUsdPrice,
        bool overdue
    ) internal {
        uint256 maxRepay = collateralUsdValue * 10_000 / (10_000 + LIQUIDATION_BONUS_BPS);
        uint256 repayUsdc = debtUsdc < maxRepay ? debtUsdc : maxRepay;
        uint256 seized = _usdcToCirBtcAmount(repayUsdc * (10_000 + LIQUIDATION_BONUS_BPS) / 10_000, btcUsdPrice);
        if (repayUsdc == maxRepay || seized > collateralAmount) seized = collateralAmount;

        if (msg.sender == deal.lender) {
            repayUsdc = 0;
        } else if (repayUsdc > 0) {
            IERC20(usdc).safeTransferFrom(msg.sender, address(this), repayUsdc);
            _pushOrCredit(usdc, deal.lender, repayUsdc);
        }
        _pushOrCredit(cirBtc, msg.sender, seized);
        _pushOrCredit(cirBtc, deal.borrower, collateralAmount - seized);

        emit LiquidationSettled(dealId, repayUsdc, seized, collateralAmount - seized, overdue);
    }

    function _oracleFailureClaim(bytes16 dealId, PersatDealRegistry.Deal memory deal, uint256 collateralAmount)
        internal
    {
        if (msg.sender != deal.lender) revert NotLender();

        delete lockedCollateral[dealId];
        registry.setDealLiquidated(dealId);
        _pushOrCredit(cirBtc, deal.lender, collateralAmount);

        emit OracleFailureClaim(dealId, deal.lender, collateralAmount);
    }

    function _syncFee() internal {
        if (feeChangeEffectiveAt == 0 || block.timestamp < feeChangeEffectiveAt) return;
        uint256 oldFeeBps = feeBps;
        feeBps = pendingFeeBps;
        feeChangeEffectiveAt = 0;
        emit FeeUpdated(oldFeeBps, feeBps);
    }

    function _pushOrCredit(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (ok && (data.length == 0 ? token.code.length > 0 : (data.length >= 32 && abi.decode(data, (uint256)) == 1)))
        {
            return;
        }
        claimable[token][to] += amount;
        totalClaimable[token] += amount;
        emit PaymentCredited(token, to, amount);
    }

    function _tokenPaused(address token) internal view returns (bool) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("paused()"));
        return ok && data.length >= 32 && abi.decode(data, (uint256)) != 0;
    }

    function _checkPeg(uint256 btcUsdPrice) internal view {
        if (address(pegGuard) == address(0)) return;
        uint256 poolPrice = pegGuard.twapPriceE18();
        uint256 feedPrice = btcUsdPrice * 10 ** (18 - priceFeedDecimals);
        uint256 diff = poolPrice > feedPrice ? poolPrice - feedPrice : feedPrice - poolPrice;
        if (diff * 10_000 > feedPrice * MAX_PEG_DEVIATION_BPS) revert CirBtcDepegged(poolPrice, feedPrice);
    }

    function _readPrice() internal view returns (uint256) {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            priceFeed.latestRoundData();
        if (answeredInRound < roundId) revert OracleInvalidPrice();
        if (startedAt == 0) revert OracleInvalidPrice();
        if (answer <= 0) revert OracleInvalidPrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > stalenessThreshold) revert OracleStale();
        return uint256(answer);
    }

    function _tryReadPrice() internal view returns (bool, uint256) {
        try priceFeed.latestRoundData() returns (
            uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
        ) {
            if (
                answeredInRound < roundId || startedAt == 0 || answer <= 0 || updatedAt > block.timestamp
                    || block.timestamp - updatedAt > stalenessThreshold
            ) {
                return (false, 0);
            }
            return (true, uint256(answer));
        } catch {
            return (false, 0);
        }
    }

    function _maturity(PersatDealRegistry.Deal memory deal) internal pure returns (uint256) {
        return deal.activatedAt + uint256(deal.durationMonths) * LOAN_MONTH;
    }

    function _liquidationOpensAt(PersatDealRegistry.Deal memory deal) internal view returns (uint256) {
        uint256 opensAt = _maturity(deal) + GRACE_PERIOD;
        uint256 cureEnd = lastTokenPauseAt + PAUSE_CURE_PERIOD;
        if (lastTokenPauseAt != 0 && cureEnd > opensAt) return cureEnd;
        return opensAt;
    }

    function _fullInterest(PersatDealRegistry.Deal memory deal) internal pure returns (uint256) {
        return deal.principal * deal.rateBps * deal.durationMonths / (10_000 * 12);
    }

    function _principalPlusInterest(PersatDealRegistry.Deal memory deal) internal pure returns (uint256) {
        return deal.principal + _fullInterest(deal);
    }

    function _accruedInterest(PersatDealRegistry.Deal memory deal) internal view returns (uint256) {
        uint256 full = _fullInterest(deal);
        if (deal.activatedAt == 0) return full;
        uint256 term = uint256(deal.durationMonths) * LOAN_MONTH;
        uint256 elapsed = block.timestamp - deal.activatedAt;
        if (elapsed < LOAN_MONTH) elapsed = LOAN_MONTH;
        if (elapsed >= term) return full;
        return full * elapsed / term;
    }

    function _amountDue(PersatDealRegistry.Deal memory deal) internal view returns (uint256) {
        uint256 due = deal.principal + _accruedInterest(deal);
        if (deal.activatedAt != 0) {
            uint256 maturity = _maturity(deal);
            bool pauseInGrace = lastTokenPauseAt > maturity && pauseEpisodeStart <= maturity + GRACE_PERIOD;
            if (block.timestamp > maturity && !pauseInGrace) {
                due += deal.principal * LATE_FEE_BPS / 10_000;
            }
        }
        return due;
    }

    function _ltvBps(uint256 debtUsdc, uint256 collateralUsdValue) internal pure returns (uint256) {
        if (collateralUsdValue == 0) return type(uint256).max;
        return debtUsdc * 10_000 / collateralUsdValue;
    }

    function _computeTermsHash(PersatDealRegistry.Deal memory deal) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                deal.dealId,
                deal.borrower,
                deal.lender,
                deal.principal,
                deal.collateral,
                deal.rateBps,
                deal.durationMonths
            )
        );
    }

    function _cirBtcToUsdcValue(uint256 cirBtcAmount, uint256 priceAnswer) internal view returns (uint256) {
        uint256 priceScaleTo6 = 10 ** (priceFeedDecimals - 6);
        return cirBtcAmount * priceAnswer / (10 ** cirBtcDecimals) / priceScaleTo6;
    }

    function _usdcToCirBtcAmount(uint256 usdcAmount, uint256 priceAnswer) internal view returns (uint256) {
        uint256 priceScaleTo6 = 10 ** (priceFeedDecimals - 6);
        return usdcAmount * (10 ** cirBtcDecimals) * priceScaleTo6 / priceAnswer;
    }
}
