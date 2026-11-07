# Brand: Protected USDC

_Status: active. The web app and the browser extension share this theme and layout._

**Feeling:** calm, precise and flat, like a good terminal: lots of air, black ink, one confident blue. Safety without fear.

## Logo
A blue coin (`#005ac5`) holding a split white shield with a dollar sign. Master files are in `brand/`: `logo.svg` (clean vector, traced from the supplied artwork) and transparent PNGs at 16, 32, 48, 128, 256 and 512 px. It is used as the header mark and favicon in the web app and the browser extension (toolbar, notifications, wallet list, welcome screens). Always use the full-colour coin; on a blue background put it inside a white ring.

## Palette (tokens in `frontend/src/index.css`, shared by the extension)
| Token | Value | Use |
| --- | --- | --- |
| background | `#f3f3f4` | page |
| card | white | surfaces, 1px border `rgb(0 0 0 / 0.14)` |
| foreground / ink | `#0b0b0d` | text, primary buttons |
| muted-foreground | `#55555c` | secondary text |
| primary | USDC blue `#2775ca` | safety, highlights, progress, links |
| primary-soft | `#e7f0fb` | "you're protected" surfaces |
| warning-soft | soft amber | anything waiting: scheduled transfers, pending changes |
| danger | red | emergency only, never decoration |

Light only: there is no dark mode.

## Type
- **DM Sans** (variable, self-hosted, optical sizing): headlines and copy. Headlines are light (300) and tightly tracked (-0.025em).
- **JetBrains Mono** (variable, self-hosted): all UI text: buttons, labels, addresses, stat chips.
- No Google Fonts or other third-party requests.

## Layout: it should feel like a wallet
- A thin flat header: logo and wordmark, a `// Network:` chip.
- Home is a single centred column: an account row (gradient avatar + copyable address), one big balance in dollars with the protection status under it, a row of round black actions (Send, Swap, Add, Receive), an asset list, scheduled transfers, and settings-style rows.
- Every action opens as its own screen with a back button, not as a tab in a dashboard.
- Buttons are black with sentence-case mono text and a 6px radius; cards are flat white with a 12px radius. No shadows, no glass.

## Voice
- Plain words, second person: "You're protected", "Bigger transfers wait 3 days".
- Explain *why* before asking: every delay says when it ends and who can stop it.
- Errors are calm sentences with a way forward ("You can send up to 500 today, or schedule a bigger transfer").
- Never blame the user, never use jargon like "revert", "queue" or "stress" in the UI.
