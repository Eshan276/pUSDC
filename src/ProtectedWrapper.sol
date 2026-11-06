// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ProtectedERC20} from "./ProtectedERC20.sol";

/// @title ProtectedWrapper
/// @notice Wraps an existing ERC-20 1:1 into a ProtectedERC20 (e.g. USDC -> pUSDC).
/// @dev Unwrapping burns pUSDC from the caller, so it is an outgoing transfer under the protection rules:
///      it uses up the daily limit and fails for reserved or locked funds.
///      Sending pUSDC to this contract's own address also unwraps it, paying the underlying to the sender.
///      That is how a protected holder queues a large unwrap:
///      `queueTransfer(address(pUSDC), amount)`, then `executeTransfer(id)` after the hold.
///      Fee-on-transfer underlyings are handled by minting only what was received.
///      Rebasing underlyings are NOT supported.
contract ProtectedWrapper is ProtectedERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    uint8 private immutable _decimals;

    event Deposit(address indexed caller, address indexed to, uint256 amount);
    event Withdraw(address indexed from, address indexed to, uint256 amount);

    error InvalidUnderlying();

    constructor(IERC20Metadata underlying_, string memory name_, string memory symbol_) ProtectedERC20(name_, symbol_) {
        if (address(underlying_) == address(0)) revert InvalidUnderlying();
        underlying = IERC20(address(underlying_));
        _decimals = underlying_.decimals();
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Wrap `amount` of the underlying for yourself.
    function deposit(uint256 amount) external returns (uint256) {
        return depositFor(msg.sender, amount);
    }

    /// @notice Wrap `amount` of the underlying and credit `to`. Incoming, so always instant.
    function depositFor(address to, uint256 amount) public nonReentrant returns (uint256 minted) {
        if (to == address(0) || to == address(this)) revert InvalidRecipient(to);
        if (amount == 0) revert ZeroAmount();
        uint256 before = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        minted = underlying.balanceOf(address(this)) - before;
        _mint(to, minted);
        emit Deposit(msg.sender, to, minted);
    }

    /// @notice Unwrap `amount` to yourself.
    function withdraw(uint256 amount) external {
        withdrawTo(msg.sender, amount);
    }

    /// @notice Unwrap `amount` from the caller and send the underlying to `to`.
    function withdrawTo(address to, uint256 amount) public nonReentrant {
        if (to == address(0) || to == address(this)) revert InvalidRecipient(to);
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount); // runs every protection check (effects first)
        emit Withdraw(msg.sender, to, amount);
        underlying.safeTransfer(to, amount); // interaction last
    }

    /// @dev Sending pUSDC to this contract unwraps it for the sender instead of leaving it stuck here.
    function _update(address from, address to, uint256 value) internal override {
        if (to == address(this) && from != address(0)) {
            super._update(from, address(0), value); // burn, with every protection check
            emit Withdraw(from, from, value);
            underlying.safeTransfer(from, value);
        } else {
            super._update(from, to, value);
        }
    }
}
