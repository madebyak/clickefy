#!/usr/bin/env python3
"""
Fail the build when a `t("key")` has no matching entry in every locale.

next-intl resolves keys at RENDER time, so a missing one is invisible to
tsc, invisible to lint, and only shows up as a MISSING_MESSAGE crash when
a user reaches that exact branch — a toast on a rarely-used button can
ship broken. Two such keys did.

Each translator variable is checked against the namespace it was bound
with, because a file may hold several (`t` = studio, `ta` = account).

Run from apps/web:  python3 scripts/check-messages.py
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCALES = ("en", "ar")

msgs = {loc: json.loads((ROOT / "messages" / f"{loc}.json").read_text()) for loc in LOCALES}
missing = []

for f in ROOT.rglob("*.tsx"):
    if "node_modules" in f.parts or ".next" in f.parts:
        continue
    src = f.read_text()
    binds = dict(re.findall(r'const\s+(\w+)\s*=\s*useTranslations\("([^"]+)"\)', src))
    for var, ns in binds.items():
        for key in sorted(set(re.findall(rf'\b{var}\("([A-Za-z0-9_]+)"', src))):
            for loc, pool in msgs.items():
                if key not in pool.get(ns, {}):
                    missing.append(f"{f.relative_to(ROOT)}  [{loc}]  {ns}.{key}")

if missing:
    print("Missing translation keys:\n")
    for m in sorted(set(missing)):
        print("  " + m)
    sys.exit(1)
print(f"All t() keys resolve in: {', '.join(LOCALES)}")
