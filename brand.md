# Brand: Protected USDC

_Status: active. The web app and the browser extension share this theme and layout._

**Feeling:** calm, precise and flat, like a good terminal: lots of air, black ink, one confident blue. Safety without fear.

## Logo
A blue coin (`#005ac5`) holding a split white shield with a dollar sign. Master files are in `brand/`: `logo.svg` (clean vector, traced from the supplied artwork) and transparent PNGs at 16, 32, 48, 128, 256 and 512 px. It is used as the header mark and favicon in the web app and the browser extension (toolbar, notifications, wallet list, welcome screens). Always use the full-colour coin; on a blue background put it inside a white ring.

## Palette (tokens in `frontend/src/index.css`, shared by the extension)
| Token | Value | Use |
| --- | --- | --- |
| background | `#f1f6fd` with a soft blue glow at the top | page |
| card | white, 24px radius, gentle blue-tinted shadow | surfaces |
| muted | `#eaf0fa` | token boxes, inputs |
| foreground | `#0d1426` | text |
| primary | blue `#2272d8` | main actions, active nav, progress, links |
| primary-soft | `#e4eeff` | selected/active surfaces, "you're protected" |
| warning-soft | soft amber | anything waiting: scheduled transfers, pending changes |
| danger | red | emergency only, never decoration |

Light only: there is no dark mode.

## Type
- **DM Sans** (variable, self-hosted, optical sizing): everything, with big tabular numerals for amounts. Headings are medium weight.
- **JetBrains Mono** (variable, self-hosted): addresses and small labels only.
- No Google Fonts or other third-party requests.

## Layout: an exchange in the web app, a wallet in the extension
- **Web app:** a top bar with the logo, a pill nav (Swap, Send, Wallet, Protect, Backup), the network and a Connect / account pill. The swap card is the front page and works before connecting: "You pay" and "You receive" boxes with token pills, a flip arrow, rate / route / fee details and one big blue button whose label walks through Connect wallet, Enter an amount, Insufficient balance, Approve and Swap. USDC to pUSDC wraps 1:1; pUSDC to USDC unwraps 1:1 or, for a protected account, can be scheduled as a real Uniswap v4 swap. Pending scheduled transfers appear under the card.
- **Extension:** a wallet popup: account switcher, one big balance, round actions, assets, activity, settings rows.
- Buttons are large and rounded, filled blue; cards are big, white and softly shadowed.

## Voice
- Plain words, second person: "You're protected", "Bigger transfers wait 3 days".
- Explain *why* before asking: every delay says when it ends and who can stop it.
- Errors are calm sentences with a way forward ("You can send up to 500 today, or schedule a bigger transfer").
- Never blame the user, never use jargon like "revert", "queue" or "stress" in the UI.
