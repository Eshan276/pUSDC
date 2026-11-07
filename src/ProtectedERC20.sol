// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ProtectedERC20: an opt-in, account-level "recoverable transfer" flag for ERC-20s.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DESIGN AMBIGUITIES AND THE CHOICES MADE HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. "Daily allowance" naming. ERC-20 already has `allowance`/`approve`, so this
 *     contract calls the per-day bypass amount the DAILY LIMIT (`dailyLimit`).
 *
 *  2. Daily limit window. A fixed 24h window starts at the first protected
 *     outgoing transfer after the previous window ended. It is not a rolling
 *     sum: it costs O(1) and is easy to explain ("resets 24h after you started
 *     spending").
 *
 *  3. What uses up the daily limit. Every outgoing path from a protected account
 *     except `executeTransfer` and `stress`: `transfer`, `transferFrom` (allowance
 *     and permit spenders included), and burns (wrapper withdrawals). Queued
 *     transfers already waited out the hold, so executing one does not use the
 *     limit. Approvals are NOT restricted: approving is harmless because spending
 *     the approval is what gets checked (rule 8).
 *
 *  4. Where queued funds live. They stay in the sender's balance (DEXs and
 *     explorers keep seeing them) but are RESERVED: a plain transfer cannot spend
 *     them. Locked funds are held back the same way. Spendable =
 *     balance - reserved - locked. Every path checks this, protected or not, so
 *     reserved and locked tokens can never move, even after the flag is off.
 *
 *  5. Increase vs decrease of protection, one parameter at a time:
 *       dailyLimit    lower  = instant | higher  = delayed
 *       holdWindow    longer = instant | shorter = delayed
 *       offDelay      longer = instant | shorter = delayed
 *       lockDuration  longer = instant | shorter = delayed
 *       backup        any change is delayed (the backup is the root of trust)
 *       flag on       instant          | flag off = delayed
 *     A delayed change waits for the offDelay in force WHEN IT IS REQUESTED, so
 *     shortening offDelay itself waits for the old, longer delay. Each parameter
 *     has one pending slot. A new request replaces the old one and restarts its
 *     timer. Applying an instant increase also clears that parameter's pending
 *     decrease, so a decrease queued earlier cannot later override it.
 *
 *  6. Applying delayed changes is lazy. Nobody has to call "apply". Once the
 *     time passes, every view reports the new value, and the next state-changing
 *     call that touches the account writes it to storage and emits the event
 *     (`FlagOff`, `BackupChanged`, `ParamUpdated`). Anyone can force this with
 *     `sync(account)`.
 *
 *  7. Who may cancel what. The owner OR the backup can cancel a queued transfer.
 *     Only the owner can cancel its own pending flag-off or decrease; the backup
 *     cannot. Otherwise a compromised backup could block the owner from ever
 *     replacing it. The backup's answer to a malicious flag-off or backup-change
 *     request is `stress()`.
 *
 *  8. What `stress()` does. Callable by the owner or the current backup while the
 *     account is protected. It (a) cancels every pending queued transfer in O(1)
 *     by bumping a per-account epoch, so an attacker cannot block it by queueing
 *     thousands of transfers, (b) cancels every pending protection decrease,
 *     including a pending flag-off, (c) moves the owner's whole spendable balance
 *     to the backup and (d) locks it there for the owner's preconfigured
 *     `lockDuration`. The duration is set in advance, never passed to stress(),
 *     so a coerced caller cannot pick "0". The owner stays protected afterwards.
 *
 *  9. Lock accounting. Each backup wallet has a single lock bucket {amount, until}.
 *     A stress while a lock is active ADDS to the amount but does NOT extend
 *     `until`. Otherwise an attacker holding the owner key could send dust and
 *     re-stress forever to keep the backup's recovered funds frozen. After expiry
 *     the next stress starts a fresh bucket. Funds the backup receives from other
 *     sources stay spendable.
 *
 * 10. Queued-transfer recipient. Anything except address(0) or the sender. The
 *     wrapper treats a transfer to the token contract itself as "unwrap to the
 *     sender", which is also how a large unwrap is queued.
 *
 * 11. Flag-off cleanup. When the flag turns off, pending decreases are dropped,
 *     but already-queued transfers stay valid: they can still be executed after
 *     their hold, or cancelled by the owner or the last backup.
 *
 * 12. Bounds. Minimums stop protection from being meaningless (a 0s hold or
 *     delay). Maximums stop a typo or a coerced user from freezing funds for
 *     decades. Maximums are constants. Minimums are set once in the constructor
 *     (immutable, no admin): production deployments use the DEFAULT_MIN_*
 *     values (1-day hold, 7-day off-delay, 1-day lock); a test/demo deployment
 *     may use minutes so the whole flow can be shown live. Every duration is in
 *     seconds, so minutes, hours and days all work.
 *
 * 13. Revert errors. For accounts with nothing reserved or locked, an
 *     over-balance transfer still reverts with OpenZeppelin's standard
 *     `ERC20InsufficientBalance`, so unprotected accounts behave byte-for-byte
 *     like a plain ERC-20. Our own errors appear only when the protection rules
 *     cause the revert.
 *
 * 14. Fast lane (opt-in). If the holder enables `fastLane`, the backup wallet
 *     can `approveTransfer(id)` to execute a queued transfer immediately, so a
 *     big payment never needs protection switched off. An attacker holding only
 *     the main key can't get the approval. Trade-off: if one person holds both
 *     keys (e.g. two wallets on the same phone), a physical attacker can force
 *     both, so it's off by default. Enabling it later is a loosening (delayed by
 *     offDelay); disabling it is instant; stress() cancels a pending enable.
 *     Choosing it in protect() is instant, like the rest of the initial setup.
 *
 * 15. Over-limit plain sends from a wallet are scheduled, not reverted. When a
 *     protected EOA calls `transfer()` directly (msg.sender == tx.origin, no
 *     code) with more than its remaining daily limit, the transfer is queued
 *     exactly like `queueTransfer` and `true` is returned, so "Send" in any
 *     wallet app just works (the recipient gets it after the hold). No
 *     `Transfer` event is emitted until execution, so off-chain indexers don't
 *     credit it early. `transferFrom`, and `transfer` from any contract or
 *     code-bearing account (EIP-7702 included), still revert with
 *     ExceedsDailyLimit. A contract may treat `true` as "tokens moved" (e.g. a
 *     lender crediting a deposit), and a holder who is also their own backup
 *     could then cancel and keep both.
 *
 * No owner, no admin, no upgradeability, no fees.
 */

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract ProtectedERC20 is ERC20Permit, ReentrancyGuard {
    // ───────────────────────────── constants ─────────────────────────────

    uint64 public constant LIMIT_PERIOD = 1 days;
    uint64 public constant MAX_OFF_DELAY = 365 days;
    uint64 public constant MAX_HOLD_WINDOW = 30 days;
    uint64 public constant MAX_LOCK_DURATION = 365 days;

    /// @notice Recommended minimums for production deployments.
    uint64 public constant DEFAULT_MIN_HOLD_WINDOW = 1 days;
    uint64 public constant DEFAULT_MIN_OFF_DELAY = 7 days;
    uint64 public constant DEFAULT_MIN_LOCK_DURATION = 1 days;

    /// @notice This deployment's minimums (seconds), fixed at construction (design note 12).
    uint64 public immutable MIN_HOLD_WINDOW;
    uint64 public immutable MIN_OFF_DELAY;
    uint64 public immutable MIN_LOCK_DURATION;

    // ─────────────────────────────── types ───────────────────────────────

    /// @notice Tunable protection parameters. Index into `Protection.params`.
    enum Param {
        DailyLimit,
        HoldWindow,
        OffDelay,
        LockDuration
    }

    uint256 private constant PARAM_COUNT = 4;

    /// @notice Per-deployment minimum durations, in seconds.
    struct Minimums {
        uint64 holdWindow;
        uint64 offDelay;
        uint64 lockDuration;
    }

    enum TransferStatus {
        None,
        Pending,
        Executed,
        Cancelled
    }

    struct PendingChange {
        uint256 value;
        uint64 effectiveAt; // 0 = nothing pending
    }

    struct Protection {
        bool active;
        uint64 flagOffAt; // 0 = no flag-off pending
        bool fastLane; // backup may approve queued transfers for immediate execution
        uint64 fastLaneAt; // 0 = no fast-lane enable pending
        address backup;
        address pendingBackup;
        uint64 pendingBackupAt; // 0 = no backup change pending
        uint256[PARAM_COUNT] params;
        PendingChange[PARAM_COUNT] pending;
    }

    struct SpendWindow {
        uint64 start;
        uint256 spent;
    }

    struct Lock {
        uint256 amount;
        uint64 until;
    }

    struct QueuedTransfer {
        address from;
        uint64 executableAt;
        address to;
        uint64 epoch;
        uint256 amount;
        TransferStatus status;
    }

    /// @notice Effective protection settings for an account, as returned by `protectionOf`.
    struct ProtectionView {
        bool active;
        address backup;
        uint256 dailyLimit;
        uint64 holdWindow;
        uint64 offDelay;
        uint64 lockDuration;
        uint64 flagOffAt;
        bool fastLane;
        uint64 fastLaneAt; // pending enable time, 0 if none
    }

    // ────────────────────────────── storage ──────────────────────────────

    mapping(address => Protection) private _protection;
    mapping(address => SpendWindow) private _spend;
    mapping(address => Lock) private _locks;
    mapping(address => uint256) private _reserved;
    mapping(address => uint64) private _epoch;
    mapping(uint256 => QueuedTransfer) private _queued;
    mapping(address => uint256[]) private _queuedIds;

    /// @notice Number of transfers ever queued. Ids start at 1.
    uint256 public queuedTransferCount;

    /// @dev Set only while `executeTransfer`/`stress` move funds, to skip the daily-limit check.
    bool private _skipDailyLimit;

    // ────────────────────────────── events ───────────────────────────────

    event FlagOn(
        address indexed account,
        address indexed backup,
        uint256 dailyLimit,
        uint64 holdWindow,
        uint64 offDelay,
        uint64 lockDuration,
        bool fastLane
    );
    event FlagOffRequested(address indexed account, uint64 effectiveAt);
    event FlagOffCancelled(address indexed account);
    event FlagOff(address indexed account);

    event ParamUpdated(address indexed account, Param indexed param, uint256 value);
    event ParamChangeRequested(address indexed account, Param indexed param, uint256 value, uint64 effectiveAt);
    event ParamChangeCancelled(address indexed account, Param indexed param);

    event BackupChangeRequested(address indexed account, address indexed newBackup, uint64 effectiveAt);
    event BackupChangeCancelled(address indexed account);
    event BackupChanged(address indexed account, address indexed oldBackup, address indexed newBackup);

    event TransferQueued(
        uint256 indexed id, address indexed from, address indexed to, uint256 amount, uint64 executableAt
    );
    event TransferCancelled(uint256 indexed id, address indexed by);
    event TransferExecuted(uint256 indexed id, address indexed by);
    event TransferApproved(uint256 indexed id, address indexed backup);

    event FastLaneUpdated(address indexed account, bool enabled);
    event FastLaneChangeRequested(address indexed account, uint64 effectiveAt);

    event StressTriggered(
        address indexed account, address indexed backup, address indexed by, uint256 amount, uint64 lockedUntil
    );

    // ────────────────────────────── errors ───────────────────────────────

    error AlreadyProtected(address account);
    error NotProtected(address account);
    error InvalidBackup(address backup);
    error InvalidParam(Param param, uint256 value);
    error InvalidRecipient(address to);
    error ZeroAmount();
    error NothingPending();
    error Unauthorized(address caller);
    error ExceedsDailyLimit(address account, uint256 amount, uint256 remaining);
    error InsufficientUnlockedBalance(address account, uint256 amount, uint256 available);
    error TransferNotPending(uint256 id);
    error HoldNotExpired(uint256 id, uint64 executableAt);
    error FastLaneOff(address account);
    error InvalidMinimums();

    constructor(string memory name_, string memory symbol_, Minimums memory mins)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        if (
            mins.holdWindow == 0 || mins.holdWindow > MAX_HOLD_WINDOW || mins.offDelay == 0
                || mins.offDelay > MAX_OFF_DELAY || mins.lockDuration == 0 || mins.lockDuration > MAX_LOCK_DURATION
        ) revert InvalidMinimums();
        MIN_HOLD_WINDOW = mins.holdWindow;
        MIN_OFF_DELAY = mins.offDelay;
        MIN_LOCK_DURATION = mins.lockDuration;
    }

    // ═════════════════════════ protection settings ═════════════════════════

    /// @notice Turn protection on for `msg.sender`. Instant, including the initial fast-lane choice.
    function protect(
        address backup,
        uint256 dailyLimit,
        uint64 holdWindow,
        uint64 offDelay,
        uint64 lockDuration,
        bool fastLane
    ) external {
        _sync(msg.sender);
        Protection storage p = _protection[msg.sender];
        if (p.active) revert AlreadyProtected(msg.sender);
        _checkBackup(msg.sender, backup);
        _checkParam(Param.DailyLimit, dailyLimit);
        _checkParam(Param.HoldWindow, holdWindow);
        _checkParam(Param.OffDelay, offDelay);
        _checkParam(Param.LockDuration, lockDuration);

        p.active = true;
        p.flagOffAt = 0;
        p.fastLane = fastLane;
        p.fastLaneAt = 0;
        p.backup = backup;
        p.pendingBackup = address(0);
        p.pendingBackupAt = 0;
        p.params[uint256(Param.DailyLimit)] = dailyLimit;
        p.params[uint256(Param.HoldWindow)] = holdWindow;
        p.params[uint256(Param.OffDelay)] = offDelay;
        p.params[uint256(Param.LockDuration)] = lockDuration;
        delete p.pending;
        delete _spend[msg.sender];

        emit FlagOn(msg.sender, backup, dailyLimit, holdWindow, offDelay, lockDuration, fastLane);
    }

    /// @notice Schedule turning protection off after the current `offDelay`.
    function requestFlagOff() external {
        Protection storage p = _requireActive(msg.sender);
        uint64 at = uint64(block.timestamp) + uint64(p.params[uint256(Param.OffDelay)]);
        p.flagOffAt = at;
        emit FlagOffRequested(msg.sender, at);
    }

    /// @notice Cancel a pending flag-off. Instant, because it increases protection.
    function cancelFlagOff() external {
        Protection storage p = _requireActive(msg.sender);
        if (p.flagOffAt == 0) revert NothingPending();
        p.flagOffAt = 0;
        emit FlagOffCancelled(msg.sender);
    }

    /// @notice Change a parameter. Instant if it increases protection, else scheduled after `offDelay`.
    function setParam(Param param, uint256 value) external {
        Protection storage p = _requireActive(msg.sender);
        _checkParam(param, value);
        uint256 i = uint256(param);
        if (_isIncrease(param, value, p.params[i])) {
            p.params[i] = value;
            delete p.pending[i];
            emit ParamUpdated(msg.sender, param, value);
        } else {
            uint64 at = uint64(block.timestamp) + uint64(p.params[uint256(Param.OffDelay)]);
            p.pending[i] = PendingChange(value, at);
            emit ParamChangeRequested(msg.sender, param, value, at);
        }
    }

    /// @notice Cancel a pending (protection-decreasing) parameter change.
    function cancelParamChange(Param param) external {
        Protection storage p = _requireActive(msg.sender);
        uint256 i = uint256(param);
        if (p.pending[i].effectiveAt == 0) revert NothingPending();
        delete p.pending[i];
        emit ParamChangeCancelled(msg.sender, param);
    }

    /// @notice Turn the fast lane off (instant) or on (a loosening: scheduled after `offDelay`).
    function setFastLane(bool enabled) external {
        Protection storage p = _requireActive(msg.sender);
        if (!enabled) {
            p.fastLane = false;
            p.fastLaneAt = 0;
            emit FastLaneUpdated(msg.sender, false);
        } else if (!p.fastLane) {
            uint64 at = uint64(block.timestamp) + uint64(p.params[uint256(Param.OffDelay)]);
            p.fastLaneAt = at;
            emit FastLaneChangeRequested(msg.sender, at);
        }
    }

    /// @notice Schedule a backup wallet change. Always delayed by `offDelay`.
    function requestBackupChange(address newBackup) external {
        Protection storage p = _requireActive(msg.sender);
        _checkBackup(msg.sender, newBackup);
        uint64 at = uint64(block.timestamp) + uint64(p.params[uint256(Param.OffDelay)]);
        p.pendingBackup = newBackup;
        p.pendingBackupAt = at;
        emit BackupChangeRequested(msg.sender, newBackup, at);
    }

    /// @notice Cancel a pending backup change.
    function cancelBackupChange() external {
        Protection storage p = _requireActive(msg.sender);
        if (p.pendingBackupAt == 0) revert NothingPending();
        p.pendingBackup = address(0);
        p.pendingBackupAt = 0;
        emit BackupChangeCancelled(msg.sender);
    }

    /// @notice Write any matured delayed changes for `account` to storage. Anyone can call this.
    function sync(address account) external {
        _sync(account);
    }

    // ═════════════════════════ queued transfers ═════════════════════════

    /// @notice Queue a transfer that can be executed after the hold window. The tokens stay reserved
    ///         in the sender's balance until then.
    function queueTransfer(address to, uint256 amount) external nonReentrant returns (uint256 id) {
        return _queue(msg.sender, to, amount);
    }

    /// @notice Plain ERC-20 transfer, with one protected-account twist (design note 15): when a normal wallet (EOA)
    ///         sends directly and the amount is over its remaining daily limit, the transfer is scheduled exactly like
    ///         `queueTransfer` instead of reverting, and `true` is returned. No `Transfer` event is emitted until it
    ///         executes, so nobody (exchanges, explorers) sees the tokens as delivered early.
    ///         `transferFrom` never does this: DEXs and other contracts get a clean revert.
    function transfer(address to, uint256 value) public virtual override returns (bool) {
        address owner = _msgSender();
        if (_shouldAutoQueue(owner, value)) {
            _queue(owner, to, value);
            return true;
        }
        return super.transfer(to, value);
    }

    function _shouldAutoQueue(address owner, uint256 value) private returns (bool) {
        _sync(owner);
        if (!_protection[owner].active) return false;
        // Only a plain EOA sending its own transaction. Contracts and code-bearing accounts (incl. EIP-7702) get a
        // revert, because a contract caller might treat "returned true" as "tokens moved".
        if (owner != tx.origin || owner.code.length != 0) return false;
        return value > dailyLimitRemaining(owner) && value <= availableBalanceOf(owner);
    }

    function _queue(address from, address to, uint256 amount) private returns (uint256 id) {
        Protection storage p = _requireActive(from);
        if (to == address(0) || to == from) revert InvalidRecipient(to);
        if (amount == 0) revert ZeroAmount();
        uint256 available = availableBalanceOf(from);
        if (amount > available) revert InsufficientUnlockedBalance(from, amount, available);

        _reserved[from] += amount;
        id = ++queuedTransferCount;
        uint64 executableAt = uint64(block.timestamp) + uint64(p.params[uint256(Param.HoldWindow)]);
        _queued[id] = QueuedTransfer({
            from: from,
            executableAt: executableAt,
            to: to,
            epoch: _epoch[from],
            amount: amount,
            status: TransferStatus.Pending
        });
        _queuedIds[from].push(id);
        emit TransferQueued(id, from, to, amount, executableAt);
    }

    /// @notice Cancel a pending queued transfer. Callable by the sender or the sender's backup wallet.
    function cancelTransfer(uint256 id) external nonReentrant {
        QueuedTransfer storage q = _queued[id];
        if (!_isPending(q)) revert TransferNotPending(id);
        _sync(q.from);
        if (msg.sender != q.from && msg.sender != _protection[q.from].backup) revert Unauthorized(msg.sender);

        q.status = TransferStatus.Cancelled;
        _reserved[q.from] -= q.amount;
        emit TransferCancelled(id, msg.sender);
    }

    /// @notice Execute a queued transfer whose hold window has passed. Anyone can call this.
    function executeTransfer(uint256 id) external nonReentrant {
        QueuedTransfer storage q = _queued[id];
        if (!_isPending(q)) revert TransferNotPending(id);
        if (block.timestamp < q.executableAt) revert HoldNotExpired(id, q.executableAt);
        _executeQueued(id, q);
    }

    /// @notice Fast lane: the sender's backup wallet approves a queued transfer, which executes immediately.
    /// @dev Only works while the sender is protected and has the fast lane enabled (design note 14).
    function approveTransfer(uint256 id) external nonReentrant {
        QueuedTransfer storage q = _queued[id];
        if (!_isPending(q)) revert TransferNotPending(id);
        address from = q.from;
        _sync(from);
        Protection storage p = _protection[from];
        if (!p.active) revert NotProtected(from);
        if (msg.sender != p.backup) revert Unauthorized(msg.sender);
        if (!p.fastLane) revert FastLaneOff(from);
        emit TransferApproved(id, msg.sender);
        _executeQueued(id, q);
    }

    function _executeQueued(uint256 id, QueuedTransfer storage q) private {
        (address from, address to, uint256 amount) = (q.from, q.to, q.amount);
        q.status = TransferStatus.Executed;
        _reserved[from] -= amount;
        emit TransferExecuted(id, msg.sender);

        _skipDailyLimit = true;
        _transfer(from, to, amount);
        _skipDailyLimit = false;
    }

    // ═════════════════════════════ stress ═════════════════════════════

    /// @notice Emergency sweep: cancel everything pending, move the whole spendable balance of `account`
    ///         to its backup wallet and lock it there for the account's `lockDuration`.
    /// @dev Callable by `account` itself or its current backup wallet.
    function stress(address account) external nonReentrant {
        Protection storage p = _requireActive(account);
        address backup = p.backup;
        if (msg.sender != account && msg.sender != backup) revert Unauthorized(msg.sender);

        // (a) Cancel every pending queued transfer in O(1).
        unchecked {
            ++_epoch[account];
        }
        _reserved[account] = 0;

        // (b) Cancel every pending protection decrease.
        p.flagOffAt = 0;
        p.fastLaneAt = 0;
        p.pendingBackup = address(0);
        p.pendingBackupAt = 0;
        delete p.pending;

        // (c) + (d) Lock the swept amount in the backup wallet, then move it.
        uint256 amount = availableBalanceOf(account);
        Lock storage l = _locks[backup];
        if (block.timestamp >= l.until) {
            l.amount = amount;
            l.until = uint64(block.timestamp) + uint64(p.params[uint256(Param.LockDuration)]);
        } else {
            l.amount += amount; // join the active lock, never extend it (see design note 9)
        }
        emit StressTriggered(account, backup, msg.sender, amount, l.until);

        if (amount != 0) {
            _skipDailyLimit = true;
            _transfer(account, backup, amount);
            _skipDailyLimit = false;
        }
    }

    // ═════════════════════════════ views ═════════════════════════════

    /// @notice Whether `account` is protected right now (counts a flag-off that matured but hasn't synced yet).
    function isProtected(address account) public view returns (bool) {
        return _isActiveNow(_protection[account]);
    }

    /// @notice Effective protection settings for `account`, with matured delayed changes applied.
    function protectionOf(address account) external view returns (ProtectionView memory v) {
        Protection storage p = _protection[account];
        v.active = _isActiveNow(p);
        v.backup = _effectiveBackup(p);
        v.dailyLimit = _effectiveParam(p, Param.DailyLimit);
        v.holdWindow = uint64(_effectiveParam(p, Param.HoldWindow));
        v.offDelay = uint64(_effectiveParam(p, Param.OffDelay));
        v.lockDuration = uint64(_effectiveParam(p, Param.LockDuration));
        v.flagOffAt = v.active ? p.flagOffAt : 0;
        bool laneMatured = p.fastLaneAt != 0 && block.timestamp >= p.fastLaneAt;
        v.fastLane = v.active && (p.fastLane || laneMatured);
        v.fastLaneAt = v.active && !laneMatured ? p.fastLaneAt : 0;
    }

    /// @notice Time at which a pending flag-off takes effect (0 if none is pending).
    function flagOffTime(address account) external view returns (uint64) {
        Protection storage p = _protection[account];
        return _isActiveNow(p) ? p.flagOffAt : 0;
    }

    /// @notice A pending (not yet matured) decrease for `param`, as (value, effectiveAt). (0, 0) if none.
    function pendingParamChange(address account, Param param)
        external
        view
        returns (uint256 value, uint64 effectiveAt)
    {
        Protection storage p = _protection[account];
        PendingChange storage c = p.pending[uint256(param)];
        if (_isActiveNow(p) && c.effectiveAt > block.timestamp) return (c.value, c.effectiveAt);
    }

    /// @notice A pending (not yet matured) backup change, as (newBackup, effectiveAt). (0, 0) if none.
    function pendingBackupChange(address account) external view returns (address newBackup, uint64 effectiveAt) {
        Protection storage p = _protection[account];
        if (_isActiveNow(p) && p.pendingBackupAt > block.timestamp) return (p.pendingBackup, p.pendingBackupAt);
    }

    /// @notice How much `account` can still send in plain transfers in the current 24h window.
    ///         `type(uint256).max` if the account is not protected.
    function dailyLimitRemaining(address account) public view returns (uint256) {
        Protection storage p = _protection[account];
        if (!_isActiveNow(p)) return type(uint256).max;
        uint256 limit = _effectiveParam(p, Param.DailyLimit);
        SpendWindow storage s = _spend[account];
        uint256 spent = block.timestamp >= uint256(s.start) + limitPeriod() ? 0 : s.spent;
        return limit > spent ? limit - spent : 0;
    }

    /// @notice Active lock on `account` as (amount, until). (0, 0) if there is no active lock.
    function lockOf(address account) external view returns (uint256 amount, uint64 until) {
        Lock storage l = _locks[account];
        if (block.timestamp < l.until) return (l.amount, l.until);
    }

    /// @notice Tokens in `account`'s balance reserved for pending queued transfers.
    function reservedOf(address account) external view returns (uint256) {
        return _reserved[account];
    }

    /// @notice Balance that is neither reserved for queued transfers nor locked.
    function availableBalanceOf(address account) public view returns (uint256) {
        uint256 bal = balanceOf(account);
        uint256 encumbered = _encumbered(account);
        return bal > encumbered ? bal - encumbered : 0;
    }

    /// @notice A queued transfer by id, plus whether it is still pending.
    function getQueuedTransfer(uint256 id) external view returns (QueuedTransfer memory q, bool pending) {
        q = _queued[id];
        pending = _isPending(_queued[id]);
    }

    /// @notice Ids of all still-pending queued transfers from `account`. Meant for off-chain use.
    function pendingTransferIds(address account) external view returns (uint256[] memory ids) {
        uint256[] storage all = _queuedIds[account];
        uint256 n = 0;
        ids = new uint256[](all.length);
        for (uint256 i; i < all.length; ++i) {
            if (_isPending(_queued[all[i]])) ids[n++] = all[i];
        }
        assembly ("memory-safe") {
            mstore(ids, n)
        }
    }

    // ═════════════════════════════ internals ═════════════════════════════

    /// @dev Every balance move goes through here, so every outgoing path (transfer, transferFrom, permit
    ///      spends, burns, queued executes, stress) is checked here.
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from != address(0)) {
            _sync(from);

            // Reserved and locked tokens never move, protected or not.
            uint256 encumbered = _encumbered(from);
            if (encumbered != 0) {
                uint256 bal = balanceOf(from);
                // value > bal is left to OZ's standard ERC20InsufficientBalance (design note 13).
                if (value <= bal && value > bal - encumbered) {
                    revert InsufficientUnlockedBalance(from, value, bal - encumbered);
                }
            }

            if (!_skipDailyLimit && _protection[from].active) _consumeDailyLimit(from, value);
        }
        super._update(from, to, value);
    }

    function _consumeDailyLimit(address account, uint256 value) private {
        SpendWindow storage s = _spend[account];
        if (block.timestamp >= uint256(s.start) + limitPeriod()) {
            s.start = uint64(block.timestamp);
            s.spent = 0;
        }
        uint256 limit = _protection[account].params[uint256(Param.DailyLimit)];
        uint256 remaining = limit > s.spent ? limit - s.spent : 0;
        if (value > remaining) revert ExceedsDailyLimit(account, value, remaining);
        s.spent += value;
    }

    /// @dev Write matured delayed changes for `account` to storage and emit their events.
    function _sync(address account) internal {
        Protection storage p = _protection[account];
        if (!p.active) return;

        if (p.flagOffAt != 0 && block.timestamp >= p.flagOffAt) {
            p.active = false;
            p.flagOffAt = 0;
            p.fastLane = false;
            p.fastLaneAt = 0;
            p.pendingBackup = address(0);
            p.pendingBackupAt = 0;
            delete p.pending;
            emit FlagOff(account);
            return;
        }

        if (p.pendingBackupAt != 0 && block.timestamp >= p.pendingBackupAt) {
            address old = p.backup;
            p.backup = p.pendingBackup;
            p.pendingBackup = address(0);
            p.pendingBackupAt = 0;
            emit BackupChanged(account, old, p.backup);
        }

        if (p.fastLaneAt != 0 && block.timestamp >= p.fastLaneAt) {
            p.fastLane = true;
            p.fastLaneAt = 0;
            emit FastLaneUpdated(account, true);
        }

        for (uint256 i; i < PARAM_COUNT; ++i) {
            PendingChange storage c = p.pending[i];
            if (c.effectiveAt != 0 && block.timestamp >= c.effectiveAt) {
                p.params[i] = c.value;
                emit ParamUpdated(account, Param(i), c.value);
                delete p.pending[i];
            }
        }
    }

    function _requireActive(address account) private returns (Protection storage p) {
        _sync(account);
        p = _protection[account];
        if (!p.active) revert NotProtected(account);
    }

    function _isPending(QueuedTransfer storage q) private view returns (bool) {
        return q.status == TransferStatus.Pending && q.epoch == _epoch[q.from];
    }

    function _encumbered(address account) private view returns (uint256) {
        Lock storage l = _locks[account];
        uint256 locked = block.timestamp < l.until ? l.amount : 0;
        return _reserved[account] + locked;
    }

    function _isActiveNow(Protection storage p) private view returns (bool) {
        return p.active && (p.flagOffAt == 0 || block.timestamp < p.flagOffAt);
    }

    function _effectiveParam(Protection storage p, Param param) private view returns (uint256) {
        PendingChange storage c = p.pending[uint256(param)];
        if (c.effectiveAt != 0 && block.timestamp >= c.effectiveAt) return c.value;
        return p.params[uint256(param)];
    }

    function _effectiveBackup(Protection storage p) private view returns (address) {
        if (p.pendingBackupAt != 0 && block.timestamp >= p.pendingBackupAt) return p.pendingBackup;
        return p.backup;
    }

    function _isIncrease(Param param, uint256 newValue, uint256 current) private pure returns (bool) {
        return param == Param.DailyLimit ? newValue <= current : newValue >= current;
    }

    function _checkBackup(address account, address backup) private view {
        if (backup == address(0) || backup == account || backup == address(this)) revert InvalidBackup(backup);
    }

    function _checkParam(Param param, uint256 value) private view {
        if (param == Param.DailyLimit) return;
        (uint64 lo, uint64 hi) = paramBounds(param);
        if (value < lo || value > hi) revert InvalidParam(param, value);
    }

    /// @notice Allowed range (seconds) for a time-based parameter. Fixed constants here; only the demo variant
    ///         under `src/demo/` overrides this, and it is never meant for real funds.
    function paramBounds(Param param) public view virtual returns (uint64 lo, uint64 hi) {
        if (param == Param.HoldWindow) return (MIN_HOLD_WINDOW, MAX_HOLD_WINDOW);
        if (param == Param.OffDelay) return (MIN_OFF_DELAY, MAX_OFF_DELAY);
        return (MIN_LOCK_DURATION, MAX_LOCK_DURATION);
    }

    /// @notice Length of the daily-limit window in seconds (`LIMIT_PERIOD` unless overridden by the demo variant).
    function limitPeriod() public view virtual returns (uint64) {
        return LIMIT_PERIOD;
    }
}
