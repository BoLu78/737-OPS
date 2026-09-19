#!/usr/bin/env python3
"""Build an uploadable site archive using an explicit public-file allowlist."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'index.html', 'app.js', 'manifest.json', 'service-worker.js',
    'manuals.html', 'manuals/assistant.css', 'manuals/assistant.js',
    'assets/tripinfo-logo-neos.png', 'icons/icon-192.png', 'icons/icon-512.png',
)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT / 'dist' / '737-OPS-online.zip')
args = parser.parse_args()
for name in FILES:
    path = ROOT / name
    if path.is_symlink() or not path.is_file():
        raise SystemExit(f'Missing or unsafe public file: {name}')
args.output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.output, 'w', ZIP_DEFLATED) as archive:
    for name in FILES:
        archive.write(ROOT / name, name)
with ZipFile(args.output) as archive:
    assert set(archive.namelist()) == set(FILES)
    assert archive.testzip() is None
print(f'Created {args.output}: {len(FILES)} public files; no manuals or extracted text.')
