import type { Address, Hex } from "viem";

export type ApprovalKind = "connect" | "tx" | "sign" | "typed";
export type Approval = { id: string; kind: ApprovalKind; origin: string; params: unknown[] };

export type AccountInfo = { index: number; address: Address; name: string };

export type WalletState = {
  hasVault: boolean;
  locked: boolean;
  /** Shown after a duress unlock: a believable empty wallet. */
  duress: boolean;
  /** The selected account's address. */
  address?: Address;
  accounts: AccountInfo[];
  selected: number;
  /** Websites you've approved. */
  connected: string[];
  hasDuressPin: boolean;
  /** Minutes of inactivity before locking; 0 = never. */
  autolock: number;
  watch: Address[];
  approvals: Approval[];
};

/** Requests from the popup to the service worker. */
export type Req =
  | { t: "state" }
  | { t: "create"; password: string }
  | { t: "import"; mnemonic: string; password: string }
  | { t: "unlock"; pin: string }
  | { t: "lock" }
  | { t: "reveal"; password: string }
  | { t: "setDuress"; password: string; duressPin: string }
  | { t: "clearDuress" }
  | { t: "send"; to: Address; data: Hex; value?: string }
  | { t: "watch"; list: Address[] }
  | { t: "addAccount" }
  | { t: "selectAccount"; index: number }
  | { t: "renameAccount"; index: number; name: string }
  | { t: "exportKey"; password: string }
  | { t: "disconnectSite"; origin: string }
  | { t: "changePassword"; oldPassword: string; newPassword: string }
  | { t: "autolock"; minutes: number }
  | { t: "wipe"; password: string }
  | { t: "approve"; id: string; approved: boolean; override?: { to: Address; data: Hex } };

export type Res<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
