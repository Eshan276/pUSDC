import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { fmtAmount, fmtDate } from "./format";

export const NEEDS_ETH = "Your wallet needs a little ETH to pay the network fee. Copy your address (top of the wallet) and paste it into a free Base Sepolia faucet, then try again.";

/** Turns a contract/wallet error into a calm, human sentence. Returns null when the user simply cancelled. */
export function friendlyError(err: unknown): string | null {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return null;
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const args = (revert?.data?.args ?? []) as readonly unknown[];
    switch (revert?.data?.errorName) {
      case "ExceedsDailyLimit":
        return `That's more than your daily limit. You can send up to ${fmtAmount(args[2] as bigint)} pUSDC today, or schedule a bigger transfer.`;
      case "InsufficientUnlockedBalance":
        return `Only ${fmtAmount(args[2] as bigint)} pUSDC is free to move right now. The rest is set aside for a scheduled transfer or locked for safety.`;
      case "HoldNotExpired":
        return `Not yet. This transfer unlocks ${fmtDate(args[1] as bigint)}.`;
      case "TransferNotPending":
        return "This transfer was already completed or cancelled.";
      case "Unauthorized":
        return "Only the wallet's owner or its backup wallet can do this.";
      case "NotProtected":
        return "Protection isn't turned on for this wallet.";
      case "AlreadyProtected":
        return "Protection is already on for this wallet.";
      case "InvalidBackup":
        return "That backup wallet won't work. Use a different wallet you control (not this one).";
      case "InvalidParam":
        return "That value is outside the allowed range.";
      case "InvalidRecipient":
        return "Please double-check the recipient address.";
      case "ZeroAmount":
        return "Enter an amount greater than zero.";
      case "ERC20InsufficientBalance":
        return "You don't have enough balance for that.";
    }
    if (/insufficient funds|gas required exceeds allowance/i.test(err.message)) return NEEDS_ETH;
    return err.shortMessage || err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}
