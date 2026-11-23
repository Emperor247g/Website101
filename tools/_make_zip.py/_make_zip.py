from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(r'C:\Users\ADMIN\Desktop\coding\Default Project')
out = Path(r'C:\Users\ADMIN\AppData\Local\Temp\opencode\CrownAndOak-website.zip')
parts = ['CrownAndOak.html', 'index.html', 'css', 'js', 'tools', 'vendor']

with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for part in parts:
        path = root / part
        if path.is_file():
            archive.write(path, part)
        else:
            for file in sorted(path.rglob('*')):
                if file.is_file() and file.name != '_make_zip.py':
                    archive.write(file, file.relative_to(root).as_posix())

print(out)
print(out.stat().st_size)
