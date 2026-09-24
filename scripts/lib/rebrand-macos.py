"""Brand the staged app and its matching Electron helpers, never the reference.

Keep Mach-O payload bytes unchanged (signing happens afterwards). Credential /
profile namespaces and third-party framework identities are deliberately separate.
"""
import argparse
import json
import plistlib
from pathlib import Path

OLD = "Grok Bot"
NEW = "BeeBot"
BUNDLE_ID = "com.yongchaoyin.beebot"
HELPERS = ("", " (Renderer)", " (GPU)", " (Plugin)")


def load(file):
    if file.is_symlink() or not file.is_file():
        raise ValueError("Bundle metadata must be a regular file")
    return plistlib.loads(file.read_bytes())


def rewrite_bundle(bundle, name, identifier):
    info = bundle / "Contents/Info.plist"
    data = load(info)
    previous = data.get("CFBundleExecutable")
    if previous not in (name, name.replace(NEW, OLD, 1)):
        raise ValueError(f"Unexpected executable for {bundle.name}")
    source = bundle / "Contents/MacOS" / previous
    target = bundle / "Contents/MacOS" / name
    if source.is_symlink() or not source.is_file():
        raise ValueError("Executable missing or indirect")
    if source != target:
        if target.exists():
            raise ValueError("Refusing to replace an existing executable")
        source.rename(target)
    data.update(CFBundleName=name, CFBundleDisplayName=name,
                CFBundleExecutable=name, CFBundleIdentifier=identifier)
    for key, value in list(data.items()):
        if key.endswith("UsageDescription") and isinstance(value, str):
            data[key] = value.replace(OLD, NEW)
    data.pop("CFBundleIconName", None)
    if name == NEW:
        data["CFBundleIconFile"] = "icon.icns"
    info.write_bytes(plistlib.dumps(data, sort_keys=False))


def rebrand(app):
    if app.is_symlink() or not app.is_dir() or app.name.startswith(OLD):
        raise ValueError("An explicit staged BeeBot app, not the reference, is required")
    rewrite_bundle(app, NEW, BUNDLE_ID)
    for suffix in HELPERS:
        directory = app / "Contents/Frameworks"
        old = directory / f"{OLD} Helper{suffix}.app"
        new = directory / f"{NEW} Helper{suffix}.app"
        bundle = old if old.exists() else new
        helper_id = BUNDLE_ID + ".helper" + ("." + suffix[2:-1] if suffix else "")
        rewrite_bundle(bundle, f"{NEW} Helper{suffix}", helper_id)
        if bundle != new:
            if new.exists():
                raise ValueError("Duplicate helper application")
            bundle.rename(new)
    verify(app)


def verify(app):
    bundles = [(app, NEW)] + [(app / "Contents/Frameworks" / f"{NEW} Helper{s}.app", f"{NEW} Helper{s}") for s in HELPERS]
    for bundle, name in bundles:
        info = load(bundle / "Contents/Info.plist")
        for key in ("CFBundleName", "CFBundleDisplayName", "CFBundleExecutable"):
            if info.get(key) != name:
                raise ValueError(f"Unbranded {key}: {bundle.name}")
        if not info.get("CFBundleIdentifier", "").startswith(BUNDLE_ID):
            raise ValueError("Unbranded bundle identifier")
        if not (bundle / "Contents/MacOS" / name).is_file():
            raise ValueError("Renamed executable missing")
    if list((app / "Contents/Frameworks").glob(f"{OLD} Helper*.app")):
        raise ValueError("Old helper name is still present")
    return {"product": NEW, "mainExecutable": NEW, "helperCount": len(HELPERS)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if not args.verify:
        rebrand(args.app)
    print(json.dumps(verify(args.app)))
