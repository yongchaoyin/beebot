import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
const exec = promisify(execFile);
const setup = String.raw`
import importlib.util, pathlib, tempfile, plistlib, hashlib, json
from unittest.mock import patch
spec=importlib.util.spec_from_file_location("retire", "scripts/lib/retire-native-brand-assets.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix="bb-native-art-") as temp:
    root=pathlib.Path(temp);app=root/"BeeBot.app";resources=app/"Contents/Resources";resources.mkdir(parents=True)
    icon=b"icns"+(12).to_bytes(4,"big")+b"test";expected=root/"generated.icns";expected.write_bytes(icon)
    (resources/"icon.icns").write_bytes(icon)
    info={"CFBundleExecutable":"BeeBot","CFBundleIdentifier":"com.yongchaoyin.beebot","CFBundleIconFile":"icon.icns"}
    (app/"Contents/Info.plist").write_bytes(plistlib.dumps(info))
    catalog=resources/"Assets.car";catalog.write_bytes(b"reviewed icon-only fixture")
    policy=[{"file":"Assets.car","sha256":hashlib.sha256(catalog.read_bytes()).hexdigest(),"reason":"unit fixture"}]
    def rejected(action):
        try: action()
        except (ValueError, FileNotFoundError): return
        raise AssertionError("expected rejection")
    with patch.object(m,"POLICY",policy):
`;
async function scenario(body) {
  await exec("python3", ["-B", "-c", setup + body.split("\n").map(line => "        " + line).join("\n")], { timeout: 15_000 });
}

test("native artwork retirement requires reviewed bytes and leaves every other resource intact", async () => {
  await scenario(`
other=resources/"ThirdParty.car";other.write_bytes(b"keep this framework input")
copy=root/"reference.car";copy.write_bytes(catalog.read_bytes())
result=m.retire(app,expected)
assert result["retired"][0]["sha256"]==policy[0]["sha256"]
assert not catalog.exists() and copy.read_bytes()==b"reviewed icon-only fixture"
assert other.read_bytes()==b"keep this framework input"
assert (resources/"icon.icns").read_bytes()==icon
assert m.verify(app,expected)["ownedIconMatches"]
rejected(lambda:m.retire(app,expected))
`);
});
test("unknown or missing catalog is not silently deleted or reported as cleaned", async () => {
  await scenario(`
catalog.write_bytes(b"unreviewed new artwork")
rejected(lambda:m.retire(app,expected));assert catalog.read_bytes()==b"unreviewed new artwork"
catalog.unlink();rejected(lambda:m.retire(app,expected))
`);
});
test("catalog, icon and resources symlinks cannot redirect cleanup outside the staging area", async () => {
  await scenario(`
outside=root/"outside.car";outside.write_bytes(catalog.read_bytes());catalog.unlink();catalog.symlink_to(outside)
rejected(lambda:m.retire(app,expected));assert outside.exists()
catalog.unlink();catalog.write_bytes(outside.read_bytes())
(resources/"icon.icns").unlink();(resources/"icon.icns").symlink_to(expected)
rejected(lambda:m.retire(app,expected));assert catalog.exists()
(resources/"icon.icns").unlink();(resources/"icon.icns").write_bytes(icon)
moved=root/"moved-resources";resources.rename(moved);resources.symlink_to(moved,target_is_directory=True)
rejected(lambda:m.retire(app,expected));assert (moved/"Assets.car").exists()
`);
});
test("owned icon must match and be selected; reference-named app is never a retirement target", async () => {
  await scenario(`
info["CFBundleIconName"]="icon";(app/"Contents/Info.plist").write_bytes(plistlib.dumps(info))
rejected(lambda:m.retire(app,expected));assert catalog.exists()
info.pop("CFBundleIconName");(app/"Contents/Info.plist").write_bytes(plistlib.dumps(info))
(resources/"icon.icns").write_bytes(b"old icon")
rejected(lambda:m.retire(app,expected));assert catalog.exists()
(resources/"icon.icns").write_bytes(icon)
old=root/"Grok Bot.app";app.rename(old);rejected(lambda:m.retire(old,expected))
assert (old/"Contents/Resources/Assets.car").exists()
`);
});
test("duplicate or unreviewed policy path fails before deleting the original catalog", async () => {
  await scenario(`
policy.append({**policy[0],"file":"../unreviewed.car"})
rejected(lambda:m.retire(app,expected));assert catalog.exists()
policy[1]=dict(policy[0]);rejected(lambda:m.retire(app,expected));assert catalog.exists()
`);
});
test("packager retires native artwork before signing and verifies it after package integrity", async () => {
  const source = await readFile("scripts/package-macos.mjs", "utf8");
  assert.ok(source.indexOf('await run("python3", nativeArtworkArgs)') < source.indexOf("await signAppBundleAdHoc(outputApp)"));
  assert.ok(source.indexOf('await run("python3", [...nativeArtworkArgs, "--verify"])') > source.indexOf("await verifyReconstructedMacPackage"));
  for (const guard of ["verifyOfficialMacReference", "verifyChecksumPinnedRendererPackage", "verifyReconstructedMacPackage"]) assert.ok(source.includes(guard));
  const policy = JSON.parse(await readFile("scripts/lib/retired-native-brand-assets.json", "utf8"));
  assert.equal(policy.length, 1);
  assert.equal(policy[0].file, "Assets.car");
  assert.equal(policy[0].sha256, "95de5001cddd503a354f471c772d09fd2501e9c37abfeeb078ad6f33994507ed");
});
