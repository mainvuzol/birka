# Running catalog evaluation

The evaluation is a regression gate for a synthetic catalog and annotated parser
assertions. It is not an estimate of production matching precision.

From `backend/`, with the project Python environment active:

```sh
# Use a disposable local PostgreSQL database named birka_catalog_eval or birka_test.
# Supply its URL through BIRKA_TEST_DATABASE_URL; never a production URL.
BIRKA_DATABASE_URL="$BIRKA_TEST_DATABASE_URL" alembic upgrade head
python -m scripts.evaluate_catalog --output /tmp/catalog-evaluation.json
```

PostgreSQL must support Unicode lowercase matching; use the locale configuration
in `infra/docker-compose.dev.yml`. A plain C-locale database does not lowercase
Cyrillic correctly. The runner seeds only synthetic evaluation identities inside
a transaction and rolls them back; it must never learn aliases in a real catalog.

## Reading results

- Candidate recall measures how often the expected synthetic target is returned
  within the requested candidate limit. It is not final identity accuracy.
- Decision agreement compares proposals against authored scenario expectations.
- Unsafe SAME_VARIANT proposals include wrong targets and structured conflicts.
  They are not actual merged products: this matcher does not apply identity.
- Human-confirmation requirements and unresolved identity remain safety gates.
- Real source rows carry partial parser annotations. Score only the annotated
  fields and explicit absence assertions. Empty annotations mean unknown, not
  perfect extraction and not an assertion that the row contains no attributes.
- Empty denominators mean unavailable, never 100%. Lexical scores are not
  calibrated probabilities. Report versions, hashes, denominators and exclusions.

The CI job runs this command and retains `catalog-evaluation.json` as an artifact.
A changed expected result is a reviewed dataset change, not an automatic way to
make a failing matcher green. Inspect individual failures and fix the underlying
regression or document why the previous expectation was wrong. Preserve raw text.

## Obtaining real identity ground truth

Before promotion or automatic matching can be evaluated, an authorized shop
reviewer must independently identify the actual variant/family or mark the row
unresolved/new. For each label retain source-row/decision references, store,
reviewer, time, target, rationale and how identity was checked. Do not use the
matcher's own answer as its ground truth. Do not infer that two identical source
rows refer to the same physical product.

Keep sensitive source material private. Group repeated phrases and related
families before separating development and holdout; aliases learned from holdout
must not enter the evaluated catalog. A larger confirmation count is not a larger
independent sample. The exact collection workflow, representative sample and
acceptable error budget remain to be reviewed with the owner.

See [proposed verification policy](../decisions/catalog-alias-verification-policy.md).
No promotion endpoint, automatic verification threshold or stronger matching
authority is enabled by this block.
