#!/usr/bin/env python3
"""Zip the entire generated static hosting folder, INCLUDING hidden .htaccess."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

root = Path(__file__).resolve().parents[1]
source = root / 'dist' / 'cpanel-production'
target = root / 'dist' / 'rd-connect-cpanel.zip'
if not source.is_dir():
    sys.exit('Build first: node scripts/build-cpanel.mjs --site ... --api ...')
if not (source / '.htaccess').is_file():
    sys.exit('Missing required .htaccess in generated hosting package')
if not (source / 'config.js').is_file():
    sys.exit('Missing configured API URL')
target.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            archive.write(file, file.relative_to(source).as_posix())
with ZipFile(target) as check:
    assert '.htaccess' in check.namelist()
    assert 'config.js' in check.namelist()
    assert 'index.html' in check.namelist()
print(f'Created: {target}')
print('Upload ZIP to the desired hosting document-root folder and extract in place.')
