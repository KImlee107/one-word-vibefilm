import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
// zipfile uses only the Python standard library; no runtime or secrets included.
const root=resolve(import.meta.dirname,'..');
const result=spawnSync('python',['-c',String.raw`
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path.cwd()
excluded={'.git','node_modules','artifacts','__pycache__'}
with ZipFile(root/'dist/source.zip','w',compression=ZIP_DEFLATED,compresslevel=9) as archive:
 for path in sorted(root.rglob('*')):
  if not path.is_file(): continue
  rel=path.relative_to(root)
  if any(x in excluded for x in rel.parts): continue
  if str(rel) in ['dist/source.zip','worker/assets.generated.js','CONTRACT.md','UPGRADE.md']: continue
  if str(rel).startswith('dist/server/'): continue
  if path.name.startswith('.env') and path.name!='.env.example': continue
  if path.suffix in ['.log','.mp4','.mp3','.wav']: continue
  archive.write(path,str(Path('vibe-studio')/rel))
print('Packaged reproducible source, dependency lockfile, vendored runtime and licenses.')
`],{cwd:root,encoding:'utf8'});
process.stdout.write(result.stdout||'');if(result.status)throw new Error(result.stderr||'Source packaging failed.');
