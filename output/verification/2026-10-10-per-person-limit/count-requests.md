# How the requests were counted (2026-10-10)

`e2e/fixtures.ts` was given, for one run only and never committed, a listener
on every browser context: each request the app made to `/api/v1/…` was written
to a JSON line with its time, method, path, the journey, and the person (the
`sub` of the session token in its `Authorization` header; `anonymous` without
one). Requests a journey makes itself, through Playwright's own client, to set
up its data are not the app's and were not counted. The run: all 265 journeys,
at `519b264`, on a freshly seeded E2E database, `BIRKA_E2E_MEASURE` naming the
file: `requests.jsonl` here.

The listener, as it was added inside the `context` fixture:

```ts
const measure = process.env.BIRKA_E2E_MEASURE;
if (measure)
  context.on("request", (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith("/api/v1/")) return;
    const auth = r.headers()["authorization"] ?? "";
    let sub = "anonymous";
    try {
      if (auth.startsWith("Bearer "))
        sub = JSON.parse(Buffer.from(auth.slice(7).split(".")[1], "base64url").toString()).sub;
    } catch { /* not a session token */ }
    appendFileSync(measure, JSON.stringify({ t: Date.now(), sub, m: r.method(), p: url.pathname,
      test: `${testInfo.file.split("/").pop()} › ${testInfo.title}` }) + "\n");
  });
```

`analyse.py` reads it, and replays it through the app's own `TokenBucket`.
