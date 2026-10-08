# What the backend images hold, before and after `backend/.dockerignore`

Checked by hand beside the CI run in `summary.md`, on 2026-10-08, with the
images that run builds (`birka-ci-local-api`, `birka-ci-local-ops`). Docker
Desktop was started for this check before the run, which is why the summary
says it was running when the run started; it was stopped after the check
(`docker desktop stop`).

The checkout the images were built from held 216 bytecode entries
(`__pycache__` folders and `.pyc` files) under `backend/app`, `backend/scripts`
and `backend/migrations`, both times:

    find app scripts migrations \( -name __pycache__ -o -name '*.py[cod]' \) | wc -l
    216

Counted inside each image:

    docker run --rm --pull never --entrypoint find <image> /app -name __pycache__ -o -name '*.py[cod]' | wc -l

| image | before (built for PR #70, at `b8cc4ba`, no ignore file) | after (built by this run, at `a160935`) |
|---|---|---|
| `birka-ci-local-api` | 216 entries, 370 MB | 0 entries, 362 MB |
| `birka-ci-local-ops` | 216 entries, 470 MB | 0 entries, 462 MB |

`/app` holds the same five names in all four images: `alembic.ini`, `app`,
`migrations`, `requirements.lock`, `scripts`. The restore drill (both images)
and the edge job (the compose stack built from the same context) pass on the
new images.
