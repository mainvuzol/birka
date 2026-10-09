"""Read-only: every pin's hashes in both locks equal PyPI's list of that version's files."""
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def parse(path):
    text = open(path, encoding="utf-8").read().replace("\\\n", " ")
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)(.*)$", line)
        if m:
            out[(m.group(1), m.group(2))] = set(re.findall(r"--hash=sha256:([0-9a-f]{64})", m.group(3)))
    return out


def pypi(key):
    name, ver = key
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{ver}/json", timeout=30) as r:
        return key, {f["digests"]["sha256"] for f in json.load(r)["urls"]}


runtime, dev = parse(sys.argv[1]), parse(sys.argv[2])
assert all(dev.get(k) == v for k, v in runtime.items()), "a runtime pin's hashes differ between the locks"
differ = 0
with ThreadPoolExecutor(8) as ex:
    for key, files in ex.map(pypi, sorted(dev)):
        same = dev[key] == files
        differ += not same
        print(f"{key[0]}=={key[1]}: {len(dev[key])} hashes, PyPI {len(files)} files: {'equal' if same else 'DIFFER'}")
print(f"{len(dev)} pins ({len(runtime)} of them runtime) checked against PyPI; {differ} differ")
