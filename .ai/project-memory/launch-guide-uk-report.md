# Instructions in Ukrainian for the launch — 2026-10-11

Baseline: `ca108c5` (a stocktake of a whole warehouse, merged as PR #86).
Status: written, reviewed and checked: every command matches the English
runbooks, every link resolves, every quoted word is the app's, and the
whole CI run locally passed.
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

- **Translated from the runbooks, not rewritten:** every command line is
  the English runbook's, as written there, apart from its placeholders and
  its comment, which are in Ukrainian; every rule is one the owner decided,
  with its date.
- **The managers' guide names the screens' words,** read from the
  components (`Receive.tsx`, `SuggestedPrice.tsx`, `Correction.tsx`,
  `Stock.tsx`, `Stocktake.tsx`, `Damaged.tsx`).
- **A check** ([`check_guides.py`](../../output/verification/2026-10-11-launch-guide-uk/check_guides.py)):
  - each of the Ukrainian page's 57 command lines is in the English server
    or backup runbook, as written there;
  - each relative link on both pages points at a file that exists;
  - each of the managers' guide's 83 «…» is a word the app's source holds.
  It found five on its first run: three quotes broken across a line (the
  check now joins them), an inflected «Браком», and «В обліку: N» for
  «В обліку: …». It checks one way only: a command on the Ukrainian page
  must be in the English runbooks, not every English command on the page
  (the review read that way round by hand); a quoted word passes if any
  source file holds it, a comment or a test included.
- **The check's mutants:** eight ways of breaking the pages, one at a time,
  each caught: a migration command, the crontab's hour, the backup
  directory's owner, `--no-deps` dropped, a link to nowhere on each page,
  and two buttons named wrongly
  ([list](../../output/verification/2026-10-11-launch-guide-uk/mutants.txt)).

## Review

An independent review read the first commit (`624af2e`) against the English
runbooks, the screens' code and the business rules. Every command of the
covered English sections is on the Ukrainian page, in its step, and every
date and attribution holds. It found, all addressed:
- **The managers' guide told a manager to approve or reject a waiting
  opening list.** Only the owner approves one, and rejecting it throws its
  whole review away; the owner's rule is to receive the delivery after the
  approval. It now says so, and not to reject a list to receive goods.
- **A stocktake on a warehouse that still has no history** closes it to its
  opening list, as any count that differs does: the guide now says nothing
  is counted there either.
- **The order of a late delivery and its paper sales was dropped,** on both
  pages: the delivery is received first, or the till finds the shelf short.
- **Two ways to enter goods found on a shelf, with no rule.** Asked of the
  owner, who decided the same day: known where from, «Приймання»; not
  known, a surplus of a count (business rules, 2026-10-11).
- **Dropped from the translation:** the validator needs its requirements;
  a copy moved by hand is the owner's to delete; an archive found damaged
  is not collected again on its own; who the drawer's and the stocktake's
  messages are never sent to; sizes created before answering by size; a
  line with several sizes takes an answer per each; the photos keep the
  parser's names; the API's log shows the seller's address; the
  administrator not named yet; a pointer to the English "Security" for the
  firewall and SSH keys.
- **Misleading:** a reserved balance is corrected by hand after the order,
  not by itself; a phone held in a blocked store now reads as the English
  says, with what happens after; «власник бази» is the PostgreSQL role;
  only «Змінити ціну продажу» shows in «Залишки»; «Брак» is listed but
  disabled at receiving; a return to a supplier needs one chosen; a unit
  sold from another store's own warehouse goes back to one of this store's.
- **Ukrainian:** screen names after a preposition («у «Звіт»») now say
  «у розділі «Звіт»»; «той, хто…» and «кожен, хто…» are plural; «Швидкі
  команди», a dangling participle, the ports' TCP and UDP, and smaller
  wording.
- **Docs:** the #85 report's status still said the sellers' page waited;
  the English 8a now names the stocktake's message, which the Ukrainian
  page already did; the English runbook and the risk register name every
  section translated; the checklist's links moved after the line they
  belong to; the check's one-way reach and what it accepts are stated.

## Evidence

- [`output/verification/2026-10-11-launch-guide-uk/`](../../output/verification/2026-10-11-launch-guide-uk/):
  `check_guides.py` and `check.txt` (57 command lines, 83 quoted words,
  OK), `mutants.py` and `mutants.txt` (8 of 8 caught).
- **CI, run locally at `624af2e`** ([summary](../../output/verification/2026-10-11-launch-guide-uk-ci-local/summary.md)):
  every job passed, the backend with its declared gap; the commits after it
  change only these pages and the evidence.
  - backend: 3 400 on PostgreSQL 17;
  - e2e: 278 journeys;
  - hot path: worst p95 65.9 ms (catalogue read) and 123.4 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **Nobody has installed a server from the Ukrainian page.** Its commands
  are those rehearsed in English on 2026-10-09.
- **Two copies of the install steps** can drift; each page says the English
  is the source. The check proves the commands match today, and runs only
  when someone runs it.
- **Step 9** is summed up; its detail stays in the English runbook.
- **The managers' guide is not in the app.** It is printed or sent, as the
  sellers' page is.
