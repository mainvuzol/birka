"""Read-only: for each name:tag@digest on Docker Hub, the manifest's kind, its platforms, and where the tag points now.

Reads manifests only (a few KB each); no layer is downloaded.
"""
import json
import sys
import urllib.request

ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])


def get(url: str, token: str | None = None, method: str = "GET"):
    req = urllib.request.Request(url, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Accept", ACCEPT)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.headers, r.read()


def check(item: str) -> str:
    name, digest = item.split("@")
    repo, tag = name.split(":")
    path = repo if "/" in repo else f"library/{repo}"
    _, body = get(f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{path}:pull")
    token = json.loads(body)["token"]
    _, body = get(f"https://registry-1.docker.io/v2/{path}/manifests/{digest}", token)
    m = json.loads(body)
    headers, _ = get(f"https://registry-1.docker.io/v2/{path}/manifests/{tag}", token, "HEAD")
    now = headers.get("Docker-Content-Digest")
    kind = m.get("mediaType", "?")
    plats = set()
    for p in m.get("manifests", []):
        pl = p.get("platform", {})
        if pl.get("os") == "unknown":
            continue
        plats.add(f"{pl.get('os')}/{pl.get('architecture')}" + (f"/{pl['variant']}" if pl.get("variant") else ""))
    multi = "index" in kind or "list" in kind
    has_amd = "linux/amd64" in plats
    has_arm = any(p.startswith("linux/arm64") for p in plats)
    moved = "tag still points here" if now == digest else f"tag moved to {now}"
    return (f"{name}: {'multi-arch index' if multi else 'single manifest ' + kind}; "
            f"linux/amd64 {'yes' if has_amd else 'NO'}, linux/arm64 {'yes' if has_arm else 'NO'}; "
            f"{len(plats)} platforms; {moved}")


for arg in sys.argv[1:]:
    print(check(arg))
