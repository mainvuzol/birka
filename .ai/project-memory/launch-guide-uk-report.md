# Instructions in Ukrainian for the launch — 2026-10-11

Baseline: `ca108c5` (a stocktake of a whole warehouse, merged as PR #86).
Status: TODO(final).
Branch: `docs/launch-guide-uk`. Owner: business-rules.md, "instructions in
Ukrainian for the launch" (2026-10-11).

## Why this was next

After PR #86 both of the owner's choices of 2026-10-10 were built, and the
backlog holds only work that waits on real outages or a larger warehouse.
The release waits on steps a person takes on a server (release checklist,
rows 16–20), and the server's instructions were in English. The owner chose
instructions in Ukrainian for the launch, over a reminder for a stocktake
left open, technical debts and fixing sizes in bulk.

## What the owner was asked

On 2026-10-11, each answer the recommended one:
- **who reads the server's instructions:** a technical person, with exact
  commands; or the owner, without them; or both;
- **what they cover:** the first install and the day-to-day running, with
  updates and going back left in English; or a full translation;
- **the managers' guide:** stock on the warehouse; or everything a manager
  does;
- **where:** pages in the project, as the sellers' page; or a «Довідка»
  section in the app.

The same day the owner confirmed the sellers' page's steps 2, 6 and 7 of
2026-10-10 (returns and payments typed from paper), the reading PR #85
left open.

## What exists now

- **[server-setup-uk.md](server-setup-uk.md)**, for the administrator:
  - what the server needs, and Kyiv's time zone;
  - the first install, steps 1–10: the code, the settings, the build and
    the database, the start, the bot's button, the owner and the shop's
    places, the people (a lost phone too), backups (the owner's key, the
    server, the crontab and its rotation, read-only access, the owner's
    computer collecting copies), being told of trouble and what each
    message means, the shops' existing stock summed up, and the check;
  - the day-to-day running, and what to do when the server does not
    answer;
  - what it leaves to the English runbooks: a new version, going back, a
    full restore, a pinned version changed on purpose, and security.
- **[managers-stock-uk.md](managers-stock-uk.md)**, for managers and the
  owner: receiving a delivery, the selling price, correcting one balance, a
  stocktake of a whole warehouse, «Брак», and what to do when the app
  refuses.
- **The sellers' page** says its steps 2, 6 and 7 were confirmed on
  2026-10-11; release checklist row 25 too.
- **The English runbooks** say the Ukrainian page exists and that a change
  to those steps is made in both; release checklist row 14 links both
  pages.

## How it was built and proven

- **Translated from the runbooks, not rewritten:** every command is the
  English runbook's, character for character, with its comment in
  Ukrainian; every rule is one the owner decided, with its date.
- **The managers' guide names the screens' words,** read from the
  components (`Receive.tsx`, `SuggestedPrice.tsx`, `Correction.tsx`,
  `Stock.tsx`, `Stocktake.tsx`, `Damaged.tsx`).
- **A check** ([`check_guides.py`](../../output/verification/2026-10-11-launch-guide-uk/check_guides.py)):
  - each of the Ukrainian page's 57 command lines is in the English server
    or backup runbook, as written there;
  - each relative link on both pages points at a file that exists;
  - each of the managers' guide's 84 «…» is a word the app's source holds.
  It found five on its first run: three quotes broken across a line (the
  check now joins them), an inflected «Браком», and «В обліку: N» for
  «В обліку: …».
- **The check's mutants:** eight ways of breaking the pages, one at a time,
  each caught: a migration command, the crontab's hour, the backup
  directory's owner, `--no-deps` dropped, a link to nowhere on each page,
  and two buttons named wrongly
  ([list](../../output/verification/2026-10-11-launch-guide-uk/mutants.txt)).

## Review

TODO(final).

## Evidence

TODO(final).

## Not covered here

- **Nobody has installed a server from the Ukrainian page.** Its commands
  are those rehearsed in English on 2026-10-09.
- **Two copies of the install steps** can drift; each page says the English
  is the source. The check proves the commands match today, and runs only
  when someone runs it.
- **Step 9** is summed up; its detail stays in the English runbook.
- **The managers' guide is not in the app.** It is printed or sent, as the
  sellers' page is.
