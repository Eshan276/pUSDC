#!/usr/bin/env bash
# Live test of Protected Token on Base Sepolia (real time, no time travel).
#
#   ./script/testnet-demo.sh status     balances and protection state
#   ./script/testnet-demo.sh setup      mint demo USDC to alice, wrap, approve, give backup gas
#   ./script/testnet-demo.sh run        steps b-d: swap, protect, small/large swap, queued drain + cancel,
#                                       then queue a legit transfer that unlocks after the 1-day hold
#   ./script/testnet-demo.sh execute ID run a queued transfer once its hold has passed
#   ./script/testnet-demo.sh stress     backup sweeps alice's funds to itself (locked 1 day)
#   ./script/testnet-demo.sh unlock     after the lock: backup unwraps to USDC
#
# Wallets come from .env.testnet (gitignored): ALICE(_KEY), BACKUP(_KEY), ATTACKER.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; source .env.testnet; set +a

RPC=${RPC:-https://sepolia.base.org}
USDC=0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be     # demo USDC (anyone can mint)
PUSDC=${PUSDC:-0xCabC4016cc24d2A2509552378dE6e232241295a3}
ROUTER=0x1689E7B1F10000AE47eBfE339a4f69dECd19F602   # Uniswap V2 router, Base Sepolia
EXPLORER=https://sepolia.basescan.org

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
usd()  { awk -v v="$1" 'BEGIN{printf "%\047.2f", v/1e6}'; }
num()  { awk '{print $1}'; }
call() { cast call --rpc-url "$RPC" "$@" | num; }
pbal() { call $PUSDC 'balanceOf(address)(uint256)' "$1"; }
ubal() { call $USDC 'balanceOf(address)(uint256)' "$1"; }
deadline() { echo $(( $(date +%s) + 3600 )); }

# Send a tx that must succeed; print its explorer link.
send() {
  local out st hash
  out=$(cast send --rpc-url "$RPC" --gas-limit 3000000 --json "$@" 2>&1) || true
  st=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("status",""))' "$out" 2>/dev/null || true)
  hash=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("transactionHash",""))' "$out" 2>/dev/null || true)
  if [[ "$st" != "0x1" ]]; then echo "   !! transaction failed: $(sed -E "s/0x[0-9a-fA-F]{64}/<key>/g" <<<"$*")"; echo "   $out" | head -c 800; echo; exit 1; fi
  note "tx: $EXPLORER/tx/$hash"
}
# A tx that must be refused. It fails at gas estimation, so nothing is sent and no gas is spent.
expect_fail() {
  local out
  if out=$(cast send --rpc-url "$RPC" "$@" 2>&1); then echo "   !! expected a revert but it succeeded"; exit 1; fi
  local helper; helper=$(grep -oE 'TransferHelper(: [A-Z_]+|::transferFrom: transferFrom failed)' <<<"$out" | head -1 || true)
  local decoded; decoded=$(grep -oE '[A-Z][A-Za-z]+\([^()]*\)$' <<<"$out" | tail -1 | sed -E 's/ \[[^]]*\]//g' || true)
  if [[ -n "$helper" ]]; then note "REFUSED: \"$helper\" (Uniswap's wrapper around our error)"
  elif [[ -n "$decoded" ]]; then note "REFUSED: $decoded"
  else echo "   !! failed for an unexpected reason:"; echo "$out" | head -5; exit 1; fi
}
swap() { send --private-key "$1" $ROUTER 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)' \
         "$2" 0 "[$3,$4]" "$5" "$(deadline)"; }

status() {
  say "Status ($(date -u '+%Y-%m-%d %H:%M UTC'))"
  note "alice    $ALICE: $(usd "$(pbal $ALICE)") pUSDC  $(usd "$(ubal $ALICE)") USDC  available $(usd "$(call $PUSDC 'availableBalanceOf(address)(uint256)' $ALICE)")"
  note "backup   $BACKUP: $(usd "$(pbal $BACKUP)") pUSDC  $(usd "$(ubal $BACKUP)") USDC"
  note "attacker $ATTACKER: $(usd "$(pbal $ATTACKER)") pUSDC"
  note "isProtected(alice) = $(call $PUSDC 'isProtected(address)(bool)' $ALICE)"
  local rem; rem=$(call $PUSDC 'dailyLimitRemaining(address)(uint256)' $ALICE)
  [[ ${#rem} -lt 30 ]] && note "dailyLimitRemaining(alice) = $(usd "$rem") pUSDC"
  note "pending transfer ids (alice) = $(cast call --rpc-url "$RPC" $PUSDC 'pendingTransferIds(address)(uint256[])' $ALICE)"
  local lk; lk=$(cast call --rpc-url "$RPC" $PUSDC 'lockOf(address)(uint256,uint64)' $BACKUP | num | tr '\n' ' ')
  set -- $lk; [[ "$1" != 0 ]] && note "lockOf(backup) = $(usd "$1") pUSDC until $(date -u -d @"$2" '+%Y-%m-%d %H:%M UTC')"
  note "gas ETH: alice $(cast balance $ALICE --rpc-url "$RPC" --ether), backup $(cast balance $BACKUP --rpc-url "$RPC" --ether)"
}

case "${1:-status}" in
status) status ;;

setup)
  say "Setup: backup gets gas; alice mints 100k demo USDC, wraps it, approves Uniswap"
  [[ "$(cast balance $BACKUP --rpc-url "$RPC")" == 0 ]] && send --private-key $ALICE_KEY $BACKUP --value 0.002ether
  send --private-key $ALICE_KEY $USDC 'mint(address,uint256)' $ALICE 100000000000
  send --private-key $ALICE_KEY $USDC 'approve(address,uint256)' $PUSDC 100000000000
  send --private-key $ALICE_KEY $PUSDC 'deposit(uint256)' 100000000000
  send --private-key $ALICE_KEY $PUSDC 'approve(address,uint256)' $ROUTER 1000000000000
  send --private-key $ALICE_KEY $USDC 'approve(address,uint256)' $ROUTER 1000000000000
  status ;;

run)
  say "b. Unprotected: alice swaps 20,000 pUSDC -> USDC on Uniswap (instant)"
  swap $ALICE_KEY 20000000000 $PUSDC $USDC $ALICE

  say "c. Alice turns protection ON: 1,000/day limit, 1-day hold, 7-day off-delay, 1-day lock"
  send --private-key $ALICE_KEY $PUSDC 'protect(address,uint256,uint64,uint64,uint64,bool)' $BACKUP 1000000000 86400 604800 86400 false
  note "isProtected(alice) = $(call $PUSDC 'isProtected(address)(bool)' $ALICE)"
  note "Small swap, 500 pUSDC:"; swap $ALICE_KEY 500000000 $PUSDC $USDC $ALICE
  note "Large swap, 10,000 pUSDC:"
  expect_fail --private-key $ALICE_KEY $ROUTER 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)' 10000000000 0 "[$PUSDC,$USDC]" $ALICE "$(deadline)"
  note "Large plain send, 10,000 pUSDC (like MetaMask 'Send'): scheduled instead of sent, then the backup cancels it:"
  send --private-key $ALICE_KEY $PUSDC 'transfer(address,uint256)' $ATTACKER 10000000000
  ID=$(call $PUSDC 'queuedTransferCount()(uint256)')
  note "Scheduled as #$ID; reserved $(usd "$(call $PUSDC 'reservedOf(address)(uint256)' $ALICE)") pUSDC"
  send --private-key $BACKUP_KEY $PUSDC 'cancelTransfer(uint256)' "$ID"

  say "d. Attacker (alice's stolen key) queues everything to themselves; backup cancels"
  ALL=$(call $PUSDC 'availableBalanceOf(address)(uint256)' $ALICE)
  send --private-key $ALICE_KEY $PUSDC 'queueTransfer(address,uint256)' $ATTACKER "$ALL"
  ID=$(call $PUSDC 'queuedTransferCount()(uint256)')
  note "Queued #$ID for $(usd "$ALL") pUSDC. Attacker tries to execute now:"
  expect_fail --private-key $ALICE_KEY $PUSDC 'executeTransfer(uint256)' "$ID"
  note "Backup cancels:"; send --private-key $BACKUP_KEY $PUSDC 'cancelTransfer(uint256)' "$ID"
  note "Attacker tries again:"
  expect_fail --private-key $ALICE_KEY $PUSDC 'executeTransfer(uint256)' "$ID"

  say "Real-time clock: alice queues a legitimate 5,000 pUSDC payment to the backup wallet"
  send --private-key $ALICE_KEY $PUSDC 'queueTransfer(address,uint256)' $BACKUP 5000000000
  ID=$(call $PUSDC 'queuedTransferCount()(uint256)')
  AT=$(cast call --rpc-url "$RPC" $PUSDC 'getQueuedTransfer(uint256)((address,uint64,address,uint64,uint256,uint8),bool)' "$ID" | head -1 | tr -d '()' | cut -d, -f2 | awk '{print $1}')
  note "Transfer #$ID executable after $(date -u -d @"$AT" '+%Y-%m-%d %H:%M UTC'). Then run: ./script/testnet-demo.sh execute $ID"
  status ;;

execute)
  ID=${2:?usage: execute ID}
  say "Execute queued transfer #$ID (anyone can call this after the hold)"
  send --private-key $BACKUP_KEY $PUSDC 'executeTransfer(uint256)' "$ID"
  status ;;

stress)
  say "f. STRESS: backup sweeps alice's whole balance to itself, locked for 1 day"
  send --private-key $BACKUP_KEY $PUSDC 'stress(address)' $ALICE
  B=$(pbal $BACKUP); L=$(cast call --rpc-url "$RPC" $PUSDC 'lockOf(address)(uint256,uint64)' $BACKUP | num | head -1)
  note "Backup tries to unwrap the locked funds:"
  expect_fail --private-key $BACKUP_KEY $PUSDC 'withdraw(uint256)' "$L"
  status ;;

unlock)
  say "After the lock: backup unwraps its pUSDC to USDC"
  send --private-key $BACKUP_KEY $PUSDC 'withdraw(uint256)' "$(pbal $BACKUP)"
  status ;;

*) sed -n 2,13p "$0"; exit 1 ;;
esac
