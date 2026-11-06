# Brand: Protected USDC

_Status: active_

**Feeling:** calm, warm and reassuring, like a seatbelt, not a vault door. Safety without fear.

## Palette (OKLCH tokens in `frontend/src/index.css`)
| Token | Light | Use |
| --- | --- | --- |
| background | warm cream `oklch(0.985 0.008 85)` | page |
| card | white | surfaces |
| foreground | warm charcoal `oklch(0.25 0.02 60)` | text |
| muted-foreground | `oklch(0.47 0.02 60)` | secondary text (AA on cream) |
| primary | deep teal `oklch(0.47 0.09 185)` | safety, "you're protected", main actions |
| warning-soft / -foreground | soft amber | anything waiting: scheduled transfers, pending changes |
| danger | red `oklch(0.54 0.19 27)` | emergency only, never decoration |

Dark mode uses the same hues with lifted teal (`oklch(0.74 0.11 180)`) and warm near-black surfaces.

## Type
- Plus Jakarta Sans (variable, self-hosted): UI and headings, extrabold for big numbers.
- JetBrains Mono (variable, self-hosted): addresses only.
- No Google Fonts or other third-party requests.

## Voice
- Plain words, second person: "You're protected", "Bigger transfers wait 3 days".
- Explain *why* before asking: every delay says when it ends and who can stop it.
- Errors are calm sentences with a way forward ("You can send up to 500 today, or schedule a bigger transfer").
- Never blame the user, never use jargon like "revert", "queue" or "stress" in the UI.
