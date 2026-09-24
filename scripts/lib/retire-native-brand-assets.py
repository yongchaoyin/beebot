"""Retire an inspected icon-only catalog from a staged BeeBot bundle, not input.

This is an exact hash allowlist, not a glob over third-party frameworks. The own
ICNS must already be installed and selected before any inherited file is removed.
"""
import argparse
import hashlib
import json
import plistlib
import stat
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name("retired-native-brand-assets.json").read_text())


def regular_bytes(file):
    if not stat.S_ISREG(file.lstat().st_mode):
        raise ValueError(f"Expected a regular file: {file.name}")
    return file.read_bytes()


def resources_for(app, expected_icon):
    if app.name != "BeeBot.app":
        raise ValueError("An explicit staged BeeBot.app is required")
    for directory in (app, app / "Contents", app / "Contents/Resources"):
        if not stat.S_ISDIR(directory.lstat().st_mode):
            raise ValueError("Bundle directories must not be symbolic links")
    info = plistlib.loads(regular_bytes(app / "Contents/Info.plist"))
    if info.get("CFBundleExecutable") != "BeeBot" or info.get("CFBundleIdentifier") != "com.yongchaoyin.beebot":
        raise ValueError("Brand the staged application before retiring its old artwork")
    if "CFBundleIconName" in info or info.get("CFBundleIconFile") not in ("icon", "icon.icns"):
        raise ValueError("Bundle must select the owned ICNS, not an asset catalog")
    resources = app / "Contents/Resources"
    expected = regular_bytes(expected_icon)
    actual = regular_bytes(resources / "icon.icns")
    if len(expected) < 8 or expected[:4] != b"icns" or int.from_bytes(expected[4:8], "big") != len(expected):
        raise ValueError("The generated icon must be a complete ICNS file")
    if actual != expected:
        raise ValueError("Packaged icon differs from the generated BeeBot icon")
    return resources


def planned_catalogs(resources):
    seen = set()
    for entry in POLICY:
        # This policy only retires the inspected top-level icon catalog. A future
        # framework catalog or different filename needs a separate reviewed change.
        if entry.get("file") != "Assets.car" or entry["file"] in seen:
            raise ValueError("Native artwork policy contains an unreviewed or duplicate path")
        if len(entry.get("sha256", "")) != 64 or any(c not in "0123456789abcdef" for c in entry["sha256"]):
            raise ValueError("Native artwork policy needs an exact SHA-256")
        seen.add(entry["file"])
        yield resources / entry["file"], entry


def retire(app, expected_icon):
    resources = resources_for(app, expected_icon)
    plan = []
    # Validate the entire policy and all inputs before the first unlink. Missing
    # input is a failure, not permission to silently claim a successful cleanup.
    for file, entry in planned_catalogs(resources):
        content = regular_bytes(file)
        if hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise ValueError(f"Native artwork changed; inspect it before removal: {file.name}")
        plan.append((file, {**entry, "bytes": len(content)}))
    for file, _ in plan:
        file.unlink()
    verify(app, expected_icon)
    return {"retired": [record for _, record in plan]}


def verify(app, expected_icon):
    resources = resources_for(app, expected_icon)
    for file, _ in planned_catalogs(resources):
        try:
            file.lstat()
        except FileNotFoundError:
            continue
        raise ValueError(f"Retired native artwork is still present: {file.name}")
    return {"retiredNativeArtworkAbsent": True, "ownedIconMatches": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument("--expected-icon", required=True, type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    print(json.dumps(verify(args.app, args.expected_icon) if args.verify else retire(args.app, args.expected_icon)))
