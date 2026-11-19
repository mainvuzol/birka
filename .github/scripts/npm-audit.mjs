// The frontend's `npm audit --audit-level=high`, with named exceptions.
//
// npm has no flag to let one advisory through, so this reads
// `npm audit --json` and fails on every high or critical advisory but the
// ones listed below. As the backend's `--ignore-vuln` rule says, an
// exception names its advisory, why it is let through and until when, and
// is never silent: each one let through is printed on every run, as a
// warning on the run's page. After its day it fails again, so someone
// looks at it again. One no longer reported is printed too, to be removed.
//
// Run from `frontend/`: `node ../.github/scripts/npm-audit.mjs`.
import { spawnSync } from "node:child_process";

const FAILING = new Set(["high", "critical"]);

// Each one: { id, package, why, until: "YYYY-MM-DD" }. None now: the first,
// picomatch's GHSA-fc5q-39xc-vjpf (let through on 2026-11-17), was
// withdrawn by GitHub on 2026-11-18 and removed (ADR-0010 §5).
const EXCEPTIONS = [];

const run = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  report = undefined;
}
if (!report || typeof report.vulnerabilities !== "object") {
  // The registry was not reached or npm failed: no answer is not a pass.
  console.error("npm audit gave no report:");
  console.error(run.stdout || run.stderr || `exit ${String(run.status)}`);
  process.exit(1);
}

// Each advisory once, from the package it is about; the packages that only
// depend on that one carry its name as a string and add nothing new.
const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities)) {
  for (const via of vulnerability.via) {
    if (typeof via !== "object" || !FAILING.has(via.severity)) continue;
    const id = String(via.url).split("/").pop();
    advisories.set(`${via.name} ${id}`, { ...via, id });
  }
}

const today = new Date().toISOString().slice(0, 10);
const failing = [];
for (const advisory of advisories.values()) {
  const exception = EXCEPTIONS.find(
    (e) => e.id === advisory.id && e.package === advisory.name,
  );
  const line = `${advisory.severity}: ${advisory.name} ${advisory.range}, ${advisory.title} (${advisory.url})`;
  if (!exception) {
    failing.push(line);
  } else if (today > exception.until) {
    failing.push(
      `${line}: its exception ended on ${exception.until}; look at it again`,
    );
  } else {
    console.log(
      `::warning title=npm audit exception until ${exception.until}::${line}. ${exception.why}`,
    );
  }
}

for (const exception of EXCEPTIONS) {
  if (
    ![...advisories.values()].some(
      (a) => a.id === exception.id && a.name === exception.package,
    )
  ) {
    console.log(
      `::notice title=npm audit exception no longer needed::${exception.id} (${exception.package}) is no longer reported; remove its exception.`,
    );
  }
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `npm audit: ${String(counts.critical ?? 0)} critical, ${String(counts.high ?? 0)} high, ${String(counts.moderate ?? 0)} moderate, ${String(counts.low ?? 0)} low.`,
);
if (failing.length > 0) {
  console.error(
    `High or critical advisories not let through (${String(failing.length)}):`,
  );
  for (const line of failing) console.error(`  ${line}`);
  console.error("Run `npm audit` in frontend/ for the whole report.");
  process.exit(1);
}
console.log("No high or critical advisory but the named exceptions.");
