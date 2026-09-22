"""Apply reviewed source changes; leave the existing repository workflow unchanged."""
from pathlib import Path
import base64, gzip, hashlib, json, subprocess, sys
root = Path.cwd().resolve()
payload_dir = Path(__file__).resolve().parent
encoded = ''.join((payload_dir / f'part-{i}.b64').read_text() for i in range(5))
raw = gzip.decompress(base64.b64decode(encoded, validate=True))
assert hashlib.sha256(raw).hexdigest() == '45463cc030a34ff9c86312d128256bde383dcea744e85e2f33803e741aa2844e', 'Payload checksum mismatch'
data = json.loads(raw)
assert data['base'] == '6ca9d5ecc8ce1f01f376e730909f4b2892c218d1'
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == data['base'], 'Wrong base commit'
verify = '--verify' in sys.argv
paths = []
manifest = {}
assert len(data['operations']) == 36
for op in data['operations']:
    rel = Path(op['path'])
    assert not rel.is_absolute() and '..' not in rel.parts and '.git' not in rel.parts
    target = root / rel
    assert target.resolve().is_relative_to(root)
    assert not target.is_symlink()
    # This cosmetic step-title change is unnecessary. Preserve existing CI and its permissions.
    if op['path'] == '.github/workflows/check.yml':
        assert hashlib.sha256(target.read_bytes()).hexdigest() == op['old_sha256']
        continue
    paths.append(op['path'])
    if not verify:
        old = target.read_bytes() if target.exists() else b''
        assert hashlib.sha256(old).hexdigest() == op['old_sha256'], f'Base file mismatch: {rel}'
        lines = old.decode('utf-8').splitlines(keepends=True)
        last_end = 0
        for e in op['edits']:
            assert 0 <= last_end <= e['start'] <= e['end'] <= len(lines)
            last_end = e['end']
        for e in reversed(op['edits']):
            lines[e['start']:e['end']] = e['text'].splitlines(keepends=True)
        content = ''.join(lines).encode('utf-8')
        assert hashlib.sha256(content).hexdigest() == op['new_sha256'], f'Edited checksum mismatch: {rel}'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == op['new_sha256'], f'Candidate changed during validation: {rel}'
    manifest[op['path']] = op['new_sha256']
assert len(set(paths)) == len(paths) == 35
if not verify:
    subprocess.run(['git', 'add', '--', *paths], check=True)
assert set(subprocess.check_output(['git', 'diff', '--cached', '--name-only'], text=True).splitlines()) == set(paths), 'Unexpected staged source'
subprocess.run(['git', 'diff', '--check'], check=True)
subprocess.run(['git', 'diff', '--cached', '--check'], check=True)
report = Path('/tmp/presence-report')
report.mkdir(exist_ok=True)
(report / 'source-manifest.json').write_text(json.dumps({'base': data['base'], 'files': manifest}, indent=2))
print(f'{"Verified" if verify else "Applied"} {len(paths)} exact source files; existing CI unchanged')
