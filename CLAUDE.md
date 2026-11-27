# Far West Masters

## Colour: use the palette first

The app has a six-colour palette. Reach for one of these before anything else.

| Hex | What it is | What it does |
| --- | --- | --- |
| `#F6F1E9` | cream | the page |
| `#C8C9C2` | light grey | borders and fills |
| `#767374` | mid grey | secondary text |
| `#183246` | navy | structure, links, primary actions |
| `#50A1A9` | teal | the good and the merely informational — a send that worked, an empty queue |
| `#B8691A` | amber | something is waiting for you, and nothing has gone wrong |

Burgundy `#8b0000` may also be used, but it is **not** one of the six and comes
second. It is the club's print colour, and here it means one thing: **this
failed or cannot be undone** — a failed delivery, an opt-out, Reject, Delete.

The four registers, so they don't drift back into each other:

| Register | Colour | Example |
| --- | --- | --- |
| structure, links, done | navy | nav, buttons, the "Imported" panel |
| confirmed good, nothing to do | teal | `delivered`, "Nobody is waiting" |
| waiting for you | amber | stale membership list, nav badge counts |
| failed | burgundy | bad number, an export that will be refused |

**Do not introduce a colour outside this list.** If a job seems to need one, say
so and explain why none of the six will do, rather than adding one.

Amber callouts use a **3px left rule** (`border-l-[3px] border-fwm-amber
bg-fwm-amber/10`), not a full border — so the waiting register differs from the
burgundy failure register in shape as well as hue, which survives being
colour-blind.

Three things that are easy to get wrong:

- **The app navy is `#183246`, not `#003366`.** The emails still use `#003366`;
  the app softened it. See `email-templates/examples/README.md` for the print
  pair.
- **Teal and amber cannot carry text.** Teal is 2.7:1 on cream and amber 3.7:1.
  Use `--fwm-teal-text` / `--fwm-amber-text`, the same hues taken to where they
  pass.
- **Measure a text colour against the wash, not the page.** A callout heading
  sits on the tint, which is darker than the page behind it. `#A25C17` clears
  cream at 4.6:1 and then fails on its own 10% wash at 4.1:1 — which is exactly
  why `--fwm-amber-text` is darker than it first looks like it needs to be.

The tokens, the measured contrast ratios and the dark-mode lifts live in
`web/src/app/globals.css`. Change them there, not in components — the Tailwind
`neutral-*` ramp is overridden in one place and used 642 times.

## Checks

Run the test suite **from the repository root**:

```bash
npx vitest run
```

From `web/` it finds no test files and still exits 0, which looks like a pass.
