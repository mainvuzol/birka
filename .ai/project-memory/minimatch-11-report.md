# minimatch 11 under typescript-eslint; picomatch's exception removed — 2026-11-19

Baseline: `d81c9277` (main after #232).

Two things left outside the audit 2026-11-18 lists (named in the set-off's
report): Dependabot alert 6, and the npm audit exception for picomatch
until 2026-12-17.

Nothing in the app changes. The app's own dependencies, its bundle, its
requests and its words are as before. Only tools that lint moved.

Status: built and proven; not committed.
- Journeys: 1212 (none added; no source or spec changed).
- Branch: `chore/minimatch-11`.

## What was open

- **Dependabot alert 6**, minimatch GHSA-g3hv-75wg-m249 (moderate: a
  denial of service through globparts amplification, `>= 7.0.0, < 11.0.1`).
  The only affected copy was minimatch 10.2.6 under
  `@typescript-eslint/typescript-estree` 8.70.0, which takes `^10.2.2`.
  eslint's own minimatch 3.1.5 is outside the advisory's range.
- **picomatch's GHSA-fc5q-39xc-vjpf**, let through by name in
  `.github/scripts/npm-audit.mjs` on 2026-11-17 because no release fixed it.
  GitHub withdrew the advisory on 2026-11-18. `npm audit` no longer reports
  it, and the script said so on every run ("remove its exception").

## What changed

- `typescript-eslint` 8.70.0 → 8.73.0 (`package.json` `^8.8.0` → `^8.73.0`,
  so a fresh lock cannot fall back below it). 8.73.0 (2026-11-16) is the
  first whose `typescript-estree` takes `minimatch ^11.0.1`; 8.71 and 8.72
  still took `^10.2.2`. Its peers (`eslint ^9`, `typescript <6.1`) match
  ours.
- With it, in the lock: every `@typescript-eslint/*` 8.73.0; under
  `typescript-estree`: minimatch 11.0.9, brace-expansion 5.0.13, semver
  7.8.6 and a new `@isaacs/nonrecursive-glob-match` 1.1.0; under
  `eslint-plugin`: ignore 7.0.16. Each one is only under typescript-eslint.
  `npm ls --omit=dev` of each is empty.
- `npm-audit.mjs`: the picomatch exception removed; the list is empty, with
  the shape of one kept in its comment.
- ADR-0010 §5: the withdrawal and the removal; the moderate advisory closed.

## How it was proven

- `npm ci` from the new lock: clean.
- `npm audit`: 0 vulnerabilities of any level (7 moderate before, all
  this one). `node ../.github/scripts/npm-audit.mjs`: passes, no notice.
- `npm run lint` (eslint with the new typescript-eslint and its rules):
  no findings.
- `npm run typecheck`: clean. `tsc -p tsconfig.eslint.json`: 45 errors, as
  on main.
- `npm run build`: builds. vite, rolldown, react and every package the bundle
  holds are the same versions in the lock.
- Prettier: `npm-audit.mjs` and `package.json` formatted, as on main.
- E2E: no local run (no source or spec changed); CI runs all 1212.
