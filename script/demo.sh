#!/usr/bin/env bash
# Interactive terminal demo of Protected Token on a local mainnet fork (anvil).
#
#   Terminal 1:  anvil --fork-url "$MAINNET_RPC_URL" --auto-impersonate
#   Terminal 2:  ./script/demo.sh            (press Enter between steps)
#                DEMO_AUTO=1 ./script/demo.sh  (no pauses)
#
# Uses real mainnet USDC and the real Uniswap V2 router, copied into the local fork.
# Nothing touches the real chain.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

RPC=${RPC:-http://127.0.0.1:8545}
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
ROUTER=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
WHALE=0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341
DEADLINE=99999999999

# Anvil's default dev accounts (public test keys, never use them on a real network).
ALICE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ALICE=$(cast wallet address --private-key $ALICE_KEY)
BACKUP_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
BACKUP=$(cast wallet address --private-key $BACKUP_KEY)
ATTACKER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC   # attacker stole ALICE_KEY

say()   { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
note()  { printf '   %s\n' "$*"; }
pause() { [[ "${DEMO_AUTO:-}" == 1 ]] || read -rp $'\n   [Enter] to continue... '; }
usd()   { awk -v v="$1" 'BEGIN{printf "%\047.2f", v/1e6}'; }
num()   { awk '{print $1}'; }   # strip cast's "[1e6]" suffix
pbal()  { cast call "$PUSDC" 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC" | num; }
ubal()  { cast call "$USDC" 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC" | num; }
show()  { note "alice:    $(usd "$(pbal $ALICE)") pUSDC   $(usd "$(ubal $ALICE)") USDC"
          note "backup:   $(usd "$(pbal $BACKUP)") pUSDC   $(usd "$(ubal $BACKUP)") USDC"
          note "attacker: $(usd "$(pbal $ATTACKER)") pUSDC"; }
send()  { local st; st=$(cast send --rpc-url "$RPC" --gas-limit 5000000 --json "$@" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
          [[ "$st" == "0x1" ]] || { echo "   !! transaction failed on-chain (status $st): $*"; exit 1; }; }
# Run a tx that is expected to fail and print the decoded reason.
expect_fail() {
  local out
  if out=$(cast send --rpc-url "$RPC" "$@" 2>&1); then echo "   !! expected a revert but it succeeded"; exit 1; fi
  local reason; reason=$(grep -oE 'TransferHelper: [A-Z_]+' <<<"$out" | head -1 || true)
  local decoded; decoded=$(grep -oE '[A-Z][A-Za-z]+\([^()]*\)$' <<<"$out" | tail -1 | sed -E 's/ \[[^]]*\]//g' || true)
  if [[ -n "$reason" ]]; then note "REVERTED: \"$reason\" (Uniswap's wrapper around our error)"
  elif [[ -n "$decoded" ]]; then note "REVERTED: $decoded"
  else note "REVERTED: $(grep -m1 -iE 'revert|error' <<<"$out")"; fi
}
warp()  { cast rpc evm_increaseTime "$1" --rpc-url "$RPC" >/dev/null; cast rpc evm_mine --rpc-url "$RPC" >/dev/null; }
swap()  { send --private-key "$1" "$ROUTER" 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)' "$2" 0 "[$3,$4]" "$5" $DEADLINE; }

cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 || { echo "No node at $RPC. Start: anvil --fork-url \"\$MAINNET_RPC_URL\" --auto-impersonate"; exit 1; }

say "Setup: deploy pUSDC on the fork"
forge build --silent
PUSDC=$(forge create src/ProtectedWrapper.sol:ProtectedWrapper --rpc-url "$RPC" --private-key $ALICE_KEY --broadcast \
        --constructor-args $USDC "Protected USDC" pUSDC | awk '/Deployed to:/{print $3}')
note "pUSDC deployed at $PUSDC"

say "a. Whale wraps 1M USDC, seeds a pUSDC/USDC Uniswap V2 pool, sends alice 100k USDC; alice wraps it"
cast rpc anvil_setBalance $WHALE 0x56BC75E2D63100000 --rpc-url "$RPC" >/dev/null   # 100 ETH for gas
send --unlocked --from $WHALE $USDC 'approve(address,uint256)' $PUSDC 2000000000000
send --unlocked --from $WHALE $PUSDC 'deposit(uint256)' 1000000000000
send --unlocked --from $WHALE $USDC  'approve(address,uint256)' $ROUTER 2000000000000
send --unlocked --from $WHALE $PUSDC 'approve(address,uint256)' $ROUTER 2000000000000
send --unlocked --from $WHALE $ROUTER 'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)' \
     $PUSDC $USDC 1000000000000 1000000000000 0 0 $WHALE $DEADLINE
send --unlocked --from $WHALE $USDC 'transfer(address,uint256)' $ALICE 100000000000
send --private-key $ALICE_KEY $USDC  'approve(address,uint256)' $PUSDC 100000000000
send --private-key $ALICE_KEY $PUSDC 'deposit(uint256)' 100000000000
send --private-key $ALICE_KEY $PUSDC 'approve(address,uint256)' $ROUTER 1000000000000
send --private-key $ALICE_KEY $USDC  'approve(address,uint256)' $ROUTER 1000000000000
show; pause

say "b. Flag OFF: alice swaps 20,000 pUSDC -> USDC on Uniswap. Plain ERC-20, instant."
swap $ALICE_KEY 20000000000 $PUSDC $USDC $ALICE
show; pause

say "c. Alice turns protection ON (instant): backup wallet, 1,000/day limit, 72h hold, 7d off-delay, 14d lock"
send --private-key $ALICE_KEY $PUSDC 'protect(address,uint256,uint64,uint64,uint64)' $BACKUP 1000000000 259200 604800 1209600
note "isProtected(alice) = $(cast call $PUSDC 'isProtected(address)(bool)' $ALICE --rpc-url "$RPC")"
note "Small swap of 500 pUSDC:"
swap $ALICE_KEY 500000000 $PUSDC $USDC $ALICE; note "OK"
note "Large swap of 10,000 pUSDC:"
expect_fail --private-key $ALICE_KEY $ROUTER 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)' 10000000000 0 "[$PUSDC,$USDC]" $ALICE $DEADLINE
note "Large plain transfer of 10,000 pUSDC:"
expect_fail --private-key $ALICE_KEY $PUSDC 'transfer(address,uint256)' $ATTACKER 10000000000
show; pause

say "d. ATTACKER (using alice's stolen key) queues a transfer of everything to themselves"
ALL=$(cast call $PUSDC 'availableBalanceOf(address)(uint256)' $ALICE --rpc-url "$RPC" | num)
send --private-key $ALICE_KEY $PUSDC 'queueTransfer(address,uint256)' $ATTACKER "$ALL"
ID=$(cast call $PUSDC 'queuedTransferCount()(uint256)' --rpc-url "$RPC" | num)
note "Queued transfer #$ID for $(usd "$ALL") pUSDC. It waits 72h; the funds stay in alice's wallet, reserved."
note "Attacker tries to execute it right away:"
expect_fail --private-key $ALICE_KEY $PUSDC 'executeTransfer(uint256)' "$ID"
note "Backup wallet sees the TransferQueued event and cancels it:"
send --private-key $BACKUP_KEY $PUSDC 'cancelTransfer(uint256)' "$ID"; note "Cancelled."
warp 259200; note "(72h later) Attacker tries again:"
expect_fail --private-key $ALICE_KEY $PUSDC 'executeTransfer(uint256)' "$ID"
show; pause

say "e. Attacker requests flag-off, then waits 6 days (the delay is 7)"
send --private-key $ALICE_KEY $PUSDC 'requestFlagOff()'
warp 518400
note "isProtected(alice) = $(cast call $PUSDC 'isProtected(address)(bool)' $ALICE --rpc-url "$RPC")"
expect_fail --private-key $ALICE_KEY $PUSDC 'transfer(address,uint256)' $ATTACKER 10000000000
pause

say "f. STRESS: backup sweeps everything to itself and locks it for 14 days"
send --private-key $BACKUP_KEY $PUSDC 'stress(address)' $ALICE
show
note "lockOf(backup) = $(cast call $PUSDC 'lockOf(address)(uint256,uint64)' $BACKUP --rpc-url "$RPC" | num | head -1 | xargs -I{} awk -v v={} 'BEGIN{printf "%\047.2f pUSDC", v/1e6}')"
note "flagOffTime(alice) = $(cast call $PUSDC 'flagOffTime(address)(uint64)' $ALICE --rpc-url "$RPC") (attacker's flag-off request was cancelled)"
LOCKED=$(pbal $BACKUP)
note "Even the backup can't move locked funds (protects against a wrench attack on the backup holder):"
expect_fail --private-key $BACKUP_KEY $PUSDC 'withdraw(uint256)' "$LOCKED"
warp 1209600; note "(14 days later) Backup unwraps to USDC:"
send --private-key $BACKUP_KEY $PUSDC 'withdraw(uint256)' "$LOCKED"
show; pause

say "g. Threat over. Alice requests flag-off and waits the 7 days"
send --private-key $ALICE_KEY $PUSDC 'requestFlagOff()'
warp 604800
note "isProtected(alice) = $(cast call $PUSDC 'isProtected(address)(bool)' $ALICE --rpc-url "$RPC")"
UB=$(ubal $ALICE)
swap $ALICE_KEY "$UB" $USDC $PUSDC $ALICE
PB=$(pbal $ALICE)
note "Alice buys $(usd "$PB") pUSDC, then sells it all in one large swap:"
swap $ALICE_KEY "$PB" $PUSDC $USDC $ALICE; note "OK, instant again."
show
say "Demo complete."
