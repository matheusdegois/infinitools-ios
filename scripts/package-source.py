"""Package reviewable source and bundled public engines, excluding ignored development files."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode('utf-8').split('\0')
output = root / 'output/Infinitools-iOS-source.zip'
output.parent.mkdir(parents=True, exist_ok=True)
count = 0
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in sorted(set(paths)):
        if not name:
            continue
        source = (root / name).resolve()
        if not source.is_relative_to(root) or source.is_symlink() or not source.is_file():
            raise RuntimeError('Unsafe source path: ' + name)
        if any(part in {'.git', 'node_modules', '.tools', 'output', '.secrets'} for part in source.relative_to(root).parts):
            raise RuntimeError('Unexpected development/private path: ' + name)
        archive.write(source, 'Infinitools-iOS/' + Path(name).as_posix())
        count += 1
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Archive CRC mismatch')
digest = hashlib.file_digest(output.open('rb'), 'sha256').hexdigest()
report = {'file': output.name, 'files': count, 'bytes': output.stat().st_size, 'sha256': digest, 'containsSignedIPA': False}
(output.parent / 'source-package.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
