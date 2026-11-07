// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {ProtectedERC20} from "./ProtectedERC20.sol";

/// @title ScheduledSwap
/// @notice Big Uniswap v4 swaps for protected accounts, without switching protection off.
///
///   1. owner:  token.queueTransfer(address(this), amount)  -> id   (a normal protected scheduled transfer)
///   2. owner:  register(id, poolKey, minOut)                        (records the swap terms on-chain)
///      ── hold window: owner or backup can token.cancelTransfer(id), exactly like any scheduled transfer ──
///   3. anyone: execute(id)  -> pulls the tokens, swaps in the v4 pool, pays the output to the OWNER.
///
/// Why this adds no new trust:
///   - Step 1 is an ordinary scheduled transfer, so the backup's cancel and the stress button work unchanged.
///   - The output always goes to the transfer's owner, so a thief holding the key gains nothing by swapping.
///   - Only hookless pools are accepted (a malicious hook could skim the input), and minOut > 0 is required.
///     A thief could still pick an awful pool or price; the swap terms are public during the hold, which is
///     exactly what the backup reviews before letting it through (see PendingList in the app).
///   - If the tokens reach this contract without a swap (someone called token.executeTransfer(id) directly, or the
///     backup used the fast lane), execute() still swaps them; refund() returns unswapped tokens to the owner.
contract ScheduledSwap is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Registered,
        Done
    }

    struct Order {
        PoolKey key;
        address owner;
        uint128 minOut;
        uint256 amount;
        Status status;
    }

    IPoolManager public immutable poolManager;
    ProtectedERC20 public immutable token;

    mapping(uint256 => Order) private _orders;
    /// @dev Transfers whose unswapped tokens were already returned or swapped, so nothing is paid twice.
    mapping(uint256 => bool) public settled;

    event OrderRegistered(
        uint256 indexed id, address indexed owner, PoolId indexed poolId, uint256 amountIn, uint128 minOut
    );
    event OrderExecuted(
        uint256 indexed id, address indexed owner, address indexed executor, uint256 amountIn, uint256 amountOut
    );
    event Refunded(uint256 indexed id, address indexed owner, uint256 amount);

    error NotYourTransfer(uint256 id);
    error AlreadyRegistered(uint256 id);
    error NotRegistered(uint256 id);
    error AlreadySettled(uint256 id);
    error PoolMustTradeToken();
    error HookedPoolNotAllowed();
    error MinOutRequired();
    error TransferWasCancelled(uint256 id);
    error NotDelivered(uint256 id);
    error InsufficientOutput(uint256 amountOut, uint128 minOut);
    error OnlyPoolManager();
    error OnlyOwner();

    constructor(IPoolManager poolManager_, ProtectedERC20 token_) {
        poolManager = poolManager_;
        token = token_;
    }

    /// @notice Attach swap terms to your own pending transfer to this contract. One-time, can't be changed later.
    function register(uint256 id, PoolKey calldata key, uint128 minOut) external {
        (ProtectedERC20.QueuedTransfer memory q, bool pending) = token.getQueuedTransfer(id);
        if (!pending || q.from != msg.sender || q.to != address(this)) revert NotYourTransfer(id);
        if (_orders[id].status != Status.None) revert AlreadyRegistered(id);
        address t = address(token);
        if (Currency.unwrap(key.currency0) != t && Currency.unwrap(key.currency1) != t) revert PoolMustTradeToken();
        if (address(key.hooks) != address(0)) revert HookedPoolNotAllowed();
        if (minOut == 0) revert MinOutRequired();

        _orders[id] = Order({key: key, owner: q.from, minOut: minOut, amount: q.amount, status: Status.Registered});
        emit OrderRegistered(id, q.from, key.toId(), q.amount, minOut);
    }

    /// @notice Run a registered swap once its transfer's hold has passed. Anyone can call this (e.g. a keeper);
    ///         the output always goes to the owner and must be at least `minOut`.
    function execute(uint256 id) external nonReentrant returns (uint256 amountOut) {
        Order storage o = _orders[id];
        if (o.status != Status.Registered) revert NotRegistered(id);
        if (settled[id]) revert AlreadySettled(id);
        o.status = Status.Done;
        settled[id] = true;

        _deliver(id); // pulls the tokens in (reverts while the hold is running, or if the backup cancelled)

        uint256 before = token.balanceOf(address(this));
        bytes memory result = poolManager.unlock(abi.encode(o.key, o.owner, o.amount, o.minOut));
        amountOut = abi.decode(result, (uint256));
        uint256 unspent = o.amount - (before - token.balanceOf(address(this)));
        if (unspent != 0) IERC20(address(token)).safeTransfer(o.owner, unspent); // price limit hit: return leftover

        emit OrderExecuted(id, o.owner, msg.sender, o.amount - unspent, amountOut);
    }

    /// @notice Return delivered-but-unswapped tokens to their owner. Anyone may refund an unregistered transfer
    ///         (tokens sent here by mistake); only the owner may abandon a registered order this way.
    function refund(uint256 id) external nonReentrant {
        (ProtectedERC20.QueuedTransfer memory q,) = token.getQueuedTransfer(id);
        if (q.to != address(this)) revert NotYourTransfer(id);
        if (settled[id]) revert AlreadySettled(id);
        Order storage o = _orders[id];
        if (o.status == Status.Registered && msg.sender != o.owner) revert OnlyOwner();
        if (q.status != ProtectedERC20.TransferStatus.Executed) revert NotDelivered(id);
        settled[id] = true;
        o.status = Status.Done;
        IERC20(address(token)).safeTransfer(q.from, q.amount);
        emit Refunded(id, q.from, q.amount);
    }

    /// @notice Swap terms for a scheduled transfer, so wallets and backups can review them during the hold.
    function orderOf(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _deliver(uint256 id) private {
        (ProtectedERC20.QueuedTransfer memory q, bool pending) = token.getQueuedTransfer(id);
        if (pending) {
            token.executeTransfer(id); // reverts with HoldNotExpired during the hold
        } else if (q.status != ProtectedERC20.TransferStatus.Executed) {
            revert TransferWasCancelled(id); // cancelled by owner/backup, or wiped by stress()
        }
        // else: already delivered (direct executeTransfer or fast-lane approval): the tokens are already here.
    }

    /// @dev v4 flash accounting: swap exact-in, pay the input, take the output straight to the owner.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (PoolKey memory key, address owner, uint256 amountIn, uint128 minOut) =
            abi.decode(data, (PoolKey, address, uint256, uint128));

        bool zeroForOne = Currency.unwrap(key.currency0) == address(token);
        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn), // negative = exact input
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        (int128 inDelta, int128 outDelta) =
            zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        uint256 paid = uint256(uint128(-inDelta));
        uint256 out = uint256(uint128(outDelta));
        if (out < minOut) revert InsufficientOutput(out, minOut);

        // Pay what we owe: sync, transfer the input token to the PoolManager, settle.
        Currency inCurrency = zeroForOne ? key.currency0 : key.currency1;
        poolManager.sync(inCurrency);
        IERC20(address(token)).safeTransfer(address(poolManager), paid);
        poolManager.settle();

        // Take what we're owed, straight to the owner.
        poolManager.take(zeroForOne ? key.currency1 : key.currency0, owner, out);
        return abi.encode(out);
    }
}
