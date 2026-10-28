# «Усе на бірці», the design system: tokens, the face, Telegram's colours, icons, money — 2026-10-28

Baseline: `57bfde2` (#146, on main), and the frame's task list
([P0-1](redesign/2026-10-27-redesign-tz-all-on-the-tag.md)).
Status: built and reviewed; every journey passes locally. CI is GitHub's
again since 2026-10-28, so it runs there on the pull request. Not yet seen
on a real phone.
Branch: `feat/design-system`. Task: the frame's P0-1.
Chosen: business-rules.md, "Chosen in chat — 2026-10-28 (the design
system of «Усе на бірці»)"; the face fetched and subset as the user
allowed in chat.

## What exists now

- **The design's tokens** (`frontend/src/styles.css`): greyboard, ink and
  the lime thread, light and dark, each meaning with its tint and its
  on-colour; spacing, radii 3–16, shadows 1–3, motion and layers, as
  `concept-all-on-the-tag/tokens.css` has them. The olive is not taken,
  and neither is the canvas's mimic of Telegram (`--tg-*`). The old names
  are aliases of the new (`--bg` → `--paper`, 19 in all), so a screen not
  yet redrawn takes the new colours without its own change. The theme is
  chosen as before: Telegram's background decides light or dark; outside
  Telegram, the device does.
- **Telegram in the app's colours.** Before `web_app_ready`, and again on
  each `theme_changed`, Telegram is told the header and background
  (`paper`) and the bottom bar (`card`). Each is told only where the
  version knows it: background from 6.1, header from 6.9, bottom bar from
  7.10. Nothing is told outside Telegram, and nothing is told twice for the
  same colours.
- **One face of the app's own.** Fira Sans Extra Condensed 800 is a single
  woff2 in `frontend/src/assets/fonts/`, with its OFL. It is preloaded and
  declared with `font-display: optional`. It draws headings (tab 34/800,
  screen 28/800) and sums; text keeps the system face, and `Inter` is
  gone. The other text roles exist as classes (`.t-sheet`, `.t-row`,
  `.t-button`, `.t-meta`, `.t-label`, `.t-tab`, the money sizes) for the
  screens' tasks to use.
- **Money in one piece.** `money()` writes «1 850,00 грн» with a no-break
  space between thousands and before «грн», every kopeck kept, and a true
  minus where `signed()` gives one. `Sum` draws the figures in the face,
  «,00» at 0.55 and «грн» at 0.6, both in pencil. A sum that changes in
  front of you shows the fold behind it for 400 ms. A sum shown for the
  first time does not, and with reduced motion none does. The figures
  never move.
- **The icon set**: 61 icons in `shared/icons.ts`, from the concept's
  `icons.js` (24 grid, 1.75 stroke, `currentColor`), and `Icon` at
  24/20/16, hidden from screen readers. «Товар»'s two tiles use `arrived`
  and `damaged`.
- **The tag's silhouette**: `.tag-row` (10 px off the left corners) and
  `.tag-hero` (14 px off the top ones). `.tag-outline` adds the light
  theme's hairline. A tag's focus ring is drawn inside its cut.
- **The status sticker**: 14/600 at radius 3. A sticker in a colour of its
  own:
  - «Клієнт забрав» and «Сплачено» are paid;
  - «Збіглося» is match.

  One with no colour of its own is ink on the fold. Its glyph comes with
  P0-2.
- **The switches** (way and mode) use spec §6.7's colours. The chosen
  segment is the card with its edge in ink; the others are pencil. Their
  sizes come with P0-3.
- **The skeleton**: a block's place has a lighter sweep every 1.2 s. A
  line inside text breathes in the same 1.2 s. Nothing moves with reduced
  motion.

No backend change. Words change in one way only: a plain space before
«грн» becomes a no-break space, in `money()`, the zero-price hint, the
drawer's reason hint and the drawer's placeholders.

## Decided here, not by the owner

- **Roles are applied only to headings and sums.** Buttons stay 16/650,
  fields and rows as they are, until their screens' tasks, so that each
  change of size comes with that screen's pictures (the task list, item 9).
- **Aliases the concept has no name for:** `--accent-soft` → `fold`,
  `--warn-line` → `warning`. The two old shadows become levels 1 and 2
  where they are used.
- **The owner's "accent", in the new palette.** «Клієнт забрав» and
  «Сплачено» are the accent's green, which is the design's paid; that
  green is also the drawer's «Збіглося до копійки» in text. The «Збіглося»
  pill is the design's match: thread on ink in light, ink on thread in
  dark, as spec §6.18 has it.
- **A sticker with no meaning of its own** is ink on the fold in both
  themes; it is no longer the accent.
- **Inline skeleton lines breathe rather than sweep.** A line inside text
  cannot clip a sweep, which would run past the screen's edge. Its opacity
  moves, which is still within the design's rule that only transform,
  opacity and a stroke's dash move.
- **Telegram's colours are read as the page draws them**, as `#rrggbb`.
  The build writes white as `#fff`.
- **The icon set is a file of its own** (6.6 kB). It loads at start, as
  the libraries do, and keeps the app's own file under the 500 kB warning
  (498 kB).

## The face

- **Source:** `FiraSansExtraCondensed-ExtraBold.ttf` from google/fonts
  (`ofl/firasansextracondensed`, main at `9862abc066c9`), SHA-256
  `056cad28b3697bf0a093eb49e55d02e873b1de1eb4ed64467c8c80b10c6750e9`. It
  is under OFL 1.1 with no reserved font name; the licence ships beside
  the font.
- **Subset:** fonttools 4.59.0 with brotli 1.1.0, in
  `~/.cache/birka-runtime/fonttools/venv`, outside the repository and the
  host.
  - Unicode ranges: U+0020–007E, 00A0–00FF, 0400–045F, 0490–0491,
    2010–2027, 2030–203A, 20B4, 2116, 2190–2193, 2212.
  - Features kept: kern, liga, calt, case, ccmp, locl, lnum, tnum, pnum,
    mark, mkmk.
  - No hinting.
- **Result:** `fira-sans-extra-condensed-800.woff2`, 409 glyphs, 20 004
  bytes, SHA-256
  `ed4f06847bcf82c39c88a6e2495ea591801f2182b0fa29498f1f33123956c40e`.
  Tabular figures all have the same advance, 460. The build holds exactly
  one font file, and the page loads it from its own origin.

## How it was built and proven

- **Files:**
  - `styles.css`: tokens, aliases, roles, `Sum`, sticker, switches,
    skeleton, silhouettes;
  - `shared/telegram.ts`: `paintTelegram`, `colourOf`;
  - `shared/Sum.tsx`;
  - `orders/types.ts`: `money()`;
  - `shared/icons.ts` and `shared/Icon.tsx`, both new;
  - `inventory/Goods.tsx`;
  - `index.html`: the preload;
  - `vite.config.ts`: the icons' chunk;
  - `e2e/fixtures.ts`: `grn()` with U+00A0.
- **Journeys:** `design-system.spec.ts` is new, with 13 journeys:
  - the bridge before «ready» and on a change of theme;
  - a colour written short still reaches Telegram as `#rrggbb`;
  - Telegram 6.0, 6.1, 6.9 and 7.10, each asked only what it knows;
  - nothing is told outside Telegram;
  - every text pair at 4.5:1 and every edge at 3:1, in both themes, with
    the 19 aliases checked;
  - the device's dark is the dark Telegram gets, and Telegram's light wins
    over a dark device;
  - one font file from the app's own origin;
  - the heading is drawn in the face, not in the fallback;
  - the written sums, including 1 234 567 890,99 and 0,07.

  `till-money-words.spec.ts` checks the sum's parts and their sizes, the
  flash on a change and none on first show, and none with reduced motion.
  21 regular expressions in 11 specs now read the no-break space, and the
  pill checks name `paid` and `match`.
- **Journeys:** 690.

## Review

An independent review of the uncommitted tree found the following. All of
it was fixed before the first commit:
- **The bottom bar was never painted in light, once built.** The minifier
  writes `--card` as `#fff`, which the `#rrggbb` check refused. Colours are
  now read through a probe, as drawn, and a journey sets them short.
- **An inline skeleton line's sweep ran outside its box**, and could
  widen the page past 360 px. Such lines breathe now.
- **Meaning was lost through the aliases:**
  - the chosen switch segment, fold on fold, could no longer be seen;
  - «Клієнт забрав», «Сплачено» and «Збіглося», which the owner chose in
    the accent, had become plain.

  These now follow spec §6.7 and §6.18, as above.
- **Journeys that proved less than they said:**
  - the face was checked only as loaded, now also as drawn;
  - 7 of 19 aliases were checked, now all;
  - the device's dark was not checked, now it is;
  - `Sum`'s parts were not checked, now they are.
- **Three no-break spaces were missing** outside `money()`: the
  zero-price hint, the drawer's reason hint and the drawer's placeholders.
- **The changed sum's 400 ms** was in the task list but not built; it is
  built now.

## Evidence

- Locally on `feat/design-system`, against the E2E API and PostgreSQL 17
  on a fresh seed:
  - 690 journeys: 689 passed. `backups.spec.ts` alone failed, finding 14
    nights rather than 3: the local seed only adds, so earlier runs' nights
    stay. It is not this change, and it passed on GitHub for #146;
  - eslint, tsc and the build are clean: one woff2, app 498.33 kB,
    vendor 207.60 kB, icons 6.56 kB.
- **CI:** GitHub Actions on the pull request.

## Not covered here

- **On a real phone:**
  - Telegram's header, background and bottom bar in the app's colours, on
    iOS and Android;
  - the face on a first open, where `optional` may keep the fallback
    until the next open.
- **«До відправлення»** is still a warning, as the owner chose on
  2026-10-23 (В5 (а)). The design approved on 2026-10-27 draws it
  `online`. To ask the owner; not changed here.
- **Left to the screens' tasks:**
  - buttons 17/700, rows, fields and the sheet's title;
  - stickers' glyphs (P0-2);
  - the switch's size (P0-3);
  - the tag silhouettes on their screens (P0-4 onwards).
- **Next in the frame's order:** P0-2 → P0-3 → P0-4 → P1-1.
