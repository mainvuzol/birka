"""Per-person peaks in requests.jsonl, and the run replayed through token buckets."""
import bisect
import collections
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))
from app.core.rate_limit import TokenBucket  # noqa: E402

rows = [json.loads(line) for line in open(Path(__file__).with_name("requests.jsonl"))]
signed = [r for r in rows if r["sub"] != "anonymous"]
HEAVY = [("POST", r"^/api/v1/catalog/match-decisions$"), ("POST", r"^/api/v1/catalog/match-preview$"),
         ("POST", r"^/api/v1/snapshots$"), ("POST", r"^/api/v1/snapshots/[^/]+/parts$"),
         ("POST", r"^/api/v1/snapshots/[^/]+/approve$")]
heavy = [r for r in signed if any(r["m"] == m and re.match(p, r["p"]) for m, p in HEAVY)]


def peak(times, seconds):
    times, best = sorted(times), 0
    for i, t in enumerate(times):
        best = max(best, bisect.bisect_right(times, t + seconds * 1000 - 1) - i)
    return best


def replay(rs, per_minute, burst, per_journey):
    now, refused, buckets = [0.0], 0, {}
    for r in rs:
        key = (r["sub"], r["test"]) if per_journey else r["sub"]
        bucket = buckets.setdefault(key, TokenBucket(per_minute=per_minute, burst=burst, clock=lambda: now[0]))
        now[0] = r["t"] / 1000
        refused += bucket.take("k") is not None
    return refused


people = collections.defaultdict(list)
for r in signed:
    people[r["sub"]].append(r["t"])
print(f"{len(rows)} requests by the app, {len(signed)} signed in, by {len(people)} people")
for seconds in (1, 10, 60):
    print(f"the busiest person in {seconds} s: {max(peak(ts, seconds) for ts in people.values())}")
journeys = collections.Counter(r["test"] for r in signed)
name, most = journeys.most_common(1)[0]
print(f"the busiest journey: {most} requests ({name})")
print(f"heavy requests: {len(heavy)}, by path {dict(collections.Counter(re.sub(r'/[0-9a-f-]{36}', '/{id}', r['p']) for r in heavy))}")
print(f"the busiest journey's heavy requests: {max(collections.Counter(r['test'] for r in heavy).values())}")
for per_minute in (120, 300, 600):
    print(f"general {per_minute}/min, burst {per_minute}: refused, the whole run as one person "
          f"{replay(signed, per_minute, per_minute, False)}; each journey from a full bucket "
          f"{replay(signed, per_minute, per_minute, True)}")
for per_minute in (10, 20, 30):
    print(f"heavy {per_minute}/min, burst {per_minute}: refused, the whole run {replay(heavy, per_minute, per_minute, False)}; "
          f"each journey from a full bucket {replay(heavy, per_minute, per_minute, True)}")
