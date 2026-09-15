# M1B gate assessment — 2026-09-15

Gate M1B exits on one sentence: **a product can be created, stock received and sold — including `FOUND_DURING_SALE` — with every M1B invariant proven by test.**

Until today the first verb had no implementation. Products existed only where a test inserted catalog rows directly, so "a product can be created" was true of the schema and false of the system. This change adds the structured creation path and proves the whole chain over HTTP.

## What the gate asked for, and where it stands

| M1B task | State | Evidence |
|---|---|---|
| M1-010 catalog identity schema, independent `ProductFamily` id, non-unique signature | done | migration `0002`; `test_m1b_schema_behaviour.py::test_two_families_may_share_a_signature`; now also reachable through the API |
| M1-011 size systems, sizes, aliases, size-unknown as a domain state | schema done, intake partial | `test_unknown_size_is_a_normal_stockable_size`. `POST /catalog/products` creates sizes; it deliberately does **not** create `SizeAlias` rows or `is_unknown` sizes — those belong to alias evidence (M1-022) and legacy import (M1-023) |
| M1-012 `raw_input` append-only, processing lifecycle, parse-result uniqueness | schema done, no runtime path | `test_raw_input_cannot_be_updated` / `..._deleted`. Nothing writes these tables until the parser lands (M1-020) — as planned |
| M1-013 inventory, stock movement, stock lot, `CHECK`, reconciliation | done | `test_inventory_cannot_be_driven_negative`, reconciliation asserted empty in the new end-to-end tests |
| M1-014 idempotency: fingerprint, claim/replay, conflict, namespacing | done | `test_sale_regressions.py`; new HTTP replay tests for both sale and product creation |
| M1-015 inventory service + `POST /inventory/receipts` | done | `test_inventory_api_regressions.py`; new end-to-end receipt against a freshly created variant |
| M1-016 sale service + `POST /sales` + `Decimal` money + immutable snapshots | done | `test_sale_command.py`, `test_sale_money.py`, `test_catalog_sale_snapshot.py` |
| M1-019 `FOUND_DURING_SALE` + `inventory:adjust` + audit | done | `test_found_during_sale_corrects_exactly_the_shortfall` now proves it over HTTP, including the refusal to over-correct |
| **the gate sentence itself** | **done** | `test_product_lifecycle_api.py::test_create_receive_and_sell_a_product` — one run, nothing pre-seeded, every identifier taken from the previous response |

## What was added

`POST /api/v1/catalog/products`. A person names the product in the shop's own words — concept, optional source, optional category and garment type, optional colour/material/texture/fur/collar/length, and the sizes it comes in — and gets back the variant and size identifiers that `POST /inventory/receipts` and `POST /sales` already take.

The decisions inside it, and why they are what they are:

- **A repeated name is the same row; a repeated product is not.** Categories, garment types, concepts, sources, attribute terms and sizes are keyed by normalized text inside the organization, so naming one twice returns the row that exists. `ProductFamily` is not keyed that way (ADR-0002). When a family **could be** this product the command **refuses** with `CATALOG_AMBIGUOUS` and hands back the candidate ids. The caller either points at one of them with `product_family_id`, or says `new_model` and writes a `distinction_note`. There is no third path, and nothing merges on its own.
- **"Could be" is deliberately generous.** `NULL` means *not stated*, not a value of its own. A stated field matches a family that states the same thing or states nothing; an unstated field narrows nothing. So the command refuses more often than strictly necessary, and every refusal hands back rows a person can look at. A duplicate family is a bad day and a merge; a wrongly merged product is not recoverable.
- **A concept's classification is written once, when the concept is created, and never revised here.** A later caller's words do not rewrite what a name already means; the response returns what is actually in force rather than echoing what was typed. `garment_type` belongs to the *family* signature, not the concept — two families under one name are allowed to differ on it, which is the whole reason the dimension exists.
- **A variant is its attributes.** `uq_product_variant_attributes` with `NULLS NOT DISTINCT` already declares that identity, so restating the same attributes resolves to the same variant rather than creating a near-duplicate. That is the schema's decision being honoured, not a guess.
- **Normalization is deliberately shallow**: casefold and collapse whitespace, nothing else. No transliteration, no Cyrillic/Latin folding, no diacritic stripping, no splitting on a slash. Those are decisions about real shop data and they belong to the parser (M1-020), made against a real corpus. The cost is accepted and stated: `Лоран` typed with a Latin `o` becomes a second concept, which a human can merge — the opposite mistake cannot be undone.
- **A slash stays inside the value.** `L/XL` is one size here (invariant I15); nothing expands it.
- **Nothing is inferred about a source.** `semantic_type` stays `UNKNOWN` until a human confirms whether Belardi is a brand, a supplier or a factory.
- **No item code is accepted.** Owner confirmation of 2026-09-14: staff very rarely record one. When codes arrive they will be optional, evidence-backed identifiers — never required, never assumed unique or attributed to an issuer, never inferred from a bare number, never a reason to merge two products. An optional-looking field today is the fastest way to end up with codes treated as identity.
- **Authorization uses the store as working context.** `store_id` in the request authorizes the call (`catalog:create` is granted to sellers through a store membership); the rows written belong to the organization. A store outside the caller's scope is refused before anything is read, and the check runs before the idempotency key is claimed so a revoked grant cannot replay an old success.
- **Family creation serializes per concept.** `product_family` has no unique constraint by design, so the candidate check and the insert are a check-then-act two simultaneous sellers would both pass. A `pg_advisory_xact_lock` keyed on the concept closes that window without a schema change, and only ever makes two people entering the same product name at the same moment wait for each other.
- **Sizes are inserted in a total order, not the caller's.** Two requests naming the same new sizes in opposite orders would otherwise hold each other's speculative inserts and deadlock. Same fix as the global ordering in `inventory/service.py`; the response still lists sizes the way the person asked for them.
- **A merged catalog row is refused, not followed.** Nothing writes `merged_into_id` before M1C, and the pointer is a plain self-reference with no tenant key — following it would have let a row whose target sits in another organization hand one shop another shop's product. The merge command owns that redirect, with its own tenant check.
- **Length is checked after normalization.** `casefold()` can make a string longer (`ß` → `ss`), so a name inside the request cap could overflow its column and turn into a 500. It is now a 422 that says what to do.
- **The command is idempotent.** Most of it repeats harmlessly, but `new_model` deliberately creates a second family, so a retry without a key would create a third. The key stops that for seven days. Unlike a sale there is no permanent `command_id`: a duplicate family is recoverable by merging (invariant I14), a duplicate sale is not. That asymmetry is intentional and stated in the code.

## Verification

Everything below was run on 2026-09-15 on this machine. PostgreSQL was a throwaway **17.9** cluster created for the session on port 55439 and destroyed afterwards.

| Check | Command | Result |
|---|---|---|
| Full suite, real database | `BIRKA_TEST_DATABASE_URL=… pytest -q` | **278 passed, 0 skipped** (254 at `1683dfb` plus 24 new) |
| Suite without a database | `pytest -q` | 152 passed, 126 skipped (skips are explicit, never silent) |
| Lint | `ruff check .` | clean |
| Format | `ruff format --check .` | 84 files, clean |
| Types | `mypy app` | 52 source files, no issues |
| Module boundaries | `lint-imports` | 8 contracts kept, 0 broken |
| Migrations, fresh cluster | `alembic upgrade head` | 3 revisions applied to an empty PostgreSQL 17.9 |
| Migration round trip | `upgrade head` → `downgrade base` → `upgrade head` on a disposable database | 3 / 3 / 3, database dropped afterwards |
| Model drift | `alembic check` | no new upgrade operations |
| Frontend | `npm ci`, `npm run lint`, `npm run build` | 143 packages, lint clean, built in 238 ms |
| Frontend advisories | `npm audit --omit=dev` | 0 vulnerabilities |
| Compose stack | YAML parsed; every `${VAR}` cross-checked against `.env.example`; referenced Dockerfiles and Caddyfile present | consistent — **but never executed** |

Two long-standing `NOT VERIFIED` items closed with evidence:

- `UNIQUE NULLS NOT DISTINCT` on PostgreSQL 17 — migrations apply, `pg_index` reports 4 such indexes, and the behaviour tests pass against 17.9.
- The ICU locale in `infra/docker-compose.yml` — on a cluster initialised with `--locale-provider=icu --icu-locale=uk-UA`, `lower('ОЛЯ')` returns `оля`. Under the C locale it would have returned the input unchanged and the matcher would have missed silently. The compose comment was right.

## Independent review

Three fresh-context reviewers read the change against the governing documents and the live database, per `.ai/OPERATING_MANUAL.md` §6: a code reviewer working to `code-reviewer` and `adversarial-reviewer`, a security reviewer, and a concurrency/database reviewer. None of them wrote the code. Between them they produced four blocking findings, and every one was a real defect this author had missed.

| Finding | What actually broke | Fix | Test that now fails without it |
|---|---|---|---|
| **Omitting an optional field silently split a product in two** | The candidate query compared `NULL` with `IS NOT DISTINCT FROM`, so "garment type not stated" was treated as a value. Creating "Лоран / Belardi / Парка" and then the same coat with the garment type left out produced two families, no refusal, no note. Every identity field is optional, so this was the ordinary case | A stated field matches a family that states the same thing *or* states nothing; an unstated field narrows nothing | `test_leaving_a_field_out_does_not_quietly_make_a_second_product`, `test_a_bare_family_is_offered_as_a_candidate_to_a_stated_request` |
| **The concept froze one garment type per name, forever** | `_resolve_concept` wrote the stated classification onto an existing concept and then refused anything different — including with `new_model`. ADR-0002 §4.2 puts `garment_type` in the *family* signature precisely so two families under one name can differ on it, so "Лоран / Косуха" became unrepresentable once someone typed "Лоран / Парка". A seller holds `catalog:create`, and no endpoint could undo it | An existing concept is never modified here. Classification is written once, at creation; `garment_type` goes to the family | `test_one_name_can_carry_two_garment_types`, `test_an_existing_concept_keeps_its_own_classification` |
| **Two simultaneous sellers could both create the family** | The candidate check and the insert are a check-then-act on a deliberately non-unique index. Reproduced: two families for one signature, both with `distinction_note = NULL`, neither caller asked | `pg_advisory_xact_lock` keyed on the concept, held to commit | `test_two_sellers_naming_one_product_at_once_get_one_family` |
| **A name that grows when normalized returned a 500** | `casefold()` expands: `'ß' * 101` passes the 200-character cap and becomes 202 characters, overflowing `varchar(200)`. An unhandled driver error, raised at will by the lowest-privileged role | Length is validated after normalization and refused as a 422 | `test_a_name_that_grows_when_normalized_is_refused_not_crashed` |

Each of those tests was run against the pre-fix code to confirm it fails there. Two of the concurrency tests had to be rewritten to do that: racing requests with `asyncio.gather` passed with the fix *removed*, because whether the two transactions overlap at the critical moment is a coin flip. They now hold one transaction open deliberately, and watch the statements the request issues.

Also fixed from the same reviews: a merged catalog row is refused rather than followed (the walk had no tenant guard, and a cross-organization merge target would have handed one shop another shop's product and frozen its label onto their receipts); `NEEDS_REVIEW` families are now visible to the ambiguity check, so the one family actually awaiting a decision cannot be the one the check misses; the Python class name no longer leaks into the client error contract; and three assertions that would have passed with the behaviour they named broken were tightened.

Reviewers also confirmed, with evidence, what holds: tenant isolation (a foreign family is a 404 identical to a missing one, a foreign store a 403 before any read, no cross-organization identifier in any error payload); `ON CONFLICT DO NOTHING` is genuinely race-safe on every table it is used on, and each conflict target matches its fallback lookup, including the `NULLS NOT DISTINCT` one; transaction ownership, rollback and audit placement; that a failed command releases its idempotency claim; and that no query is unindexed.

## Not verified, and not claimed

- **`docker compose up` has never been run** — not here, not in CI. Docker is not installed on this machine. The stack is reviewed design; the first real execution will be the first time anyone learns whether it works. Worth stating plainly: this is the literal wording of the **M1A** exit criterion, not M1B's. M1B's sentence says nothing about Docker and is met. M1A's remains open on this one point, and no report should be read as having closed it.
- **The libc locale differs locally.** Windows rejects `C.UTF-8`, so the local cluster used `--locale=C` beside ICU `uk-UA`. The ICU half — the half catalog matching depends on — matches production exactly; the libc fallback does not and is not exercised here.
- **No frontend for this endpoint.** Creating a product from Telegram is gate M1D (M1-024/M1-025). Today the endpoint is reachable only by an API client.
- **No end-to-end Telegram run.** Sign-in is proven by unit tests against the real signature algorithm; the browser journey is M1D.
- **No backup or restore drill** (M1-028), no rate limiting, no session revocation. None of these are M1B exit conditions, and none should be mistaken for done.
- **Error responses are absent from the OpenAPI schema.** Every endpoint declares only its success code and 422; 403/404/409 are real and tested but undiscoverable from the schema. Schema-level refusals also come back in FastAPI's `detail` shape while domain refusals use `code`/`message`, so a client has to handle both. Pre-existing across the whole API, not introduced here.

## Open decisions and deferred risks

Raised by the reviews, deliberately not decided here:

- **Size codes are the one label stored with no normalization at all.** `M` and `m` become two `Size` rows in the same system, and inventory is keyed on `size_id`, so the same physical size would hold two separate stock buckets. Normalizing would fix that, but picking the rule — casefold, uppercase, or a separate display/key pair needing a migration — is a decision about the shop's data, and `SizeAlias.normalized_text` already exists for the alias layer in M1C. **This needs an owner decision, not an assumption.** Invariant I15 justifies not *splitting* `L/XL`; it says nothing about case.
- **No rate limiting or quota anywhere in the application.** One authorized request can create up to 63 catalog rows, and nothing bounds request count. A seller can mint unlimited organization-wide identity, and cleaning up duplicate families needs `CATALOG_MERGE`, which a seller does not hold.
- **`catalog:create` on `SELLER` is an asymmetric grant.** It lets the cheapest role create duplicates that only a manager can merge away. `CATALOG_CONFIRM` is defined in `permissions.py` and used nowhere; whether it should gate parts of this endpoint is open, and it touches the default role matrix, which is the owner's call (open question Q4).
- **`IdempotencyRecord.expires_at` is written but never read.** There is no purge job, so the "7-day cache" is in practice unbounded growth, and a stuck `IN_PROGRESS` row would block its key indefinitely. Pre-existing: it affects receipts, adjustments and sales equally.
- **A non-`new_model` retry after the retention window returns 409, not the original 201.** Safe — the family exists and nothing is duplicated — but it is a different answer to the same request, and a client should expect it.

## Known coverage regression, inherited

`backend/tests/integration/test_api_endpoints.py` exists only on the unmerged local branch `feat/m1b-sale-command` (commit `33d32c8`). It held 20 HTTP-level tests; the M1B review work in PR #10 replaced them with service-level regression tests and the file never reached `main`. Most of its scenarios are covered elsewhere at service level. One was not covered anywhere: the `MAX_UNIT_PRICE` guard that keeps a schema-valid request from overflowing `NUMERIC(12,2)` — a fix from the earlier review whose only regression test lived on that branch. It is re-covered here at HTTP level.

`output/reviews/2026-09-14-m1b/` was committed to `main` in PR #10. It holds a review report and three throwaway scripts that depend on an undocumented `REVIEW_DATABASE_URL` and are outside every lint and test path. That is scratch output living in version control; whether to keep it as evidence or delete it is the owner's call, not something this change decided.
