import {readdir,readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..');
for(const directory of ['dist','worker','tools']){
  for(const file of await readdir(resolve(root,directory))){
    if(!/\.(m?js)$/.test(file)||file==='assets.generated.js')continue;
    const child=spawnSync(process.execPath,['--check',resolve(root,directory,file)],{stdio:'inherit'});if(child.status)process.exit(child.status);
  }
}
const html=await readFile(resolve(root,'dist/index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await stat(resolve(root,'dist',match[1]));
if(/assets\/(?:narration\.mp3|music\.wav|sample\.mp4)/.test(html))throw new Error('Unrequested pre-generated media reference remains.');
await build({entryPoints:[resolve(root,'dist/app.js')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
console.log('Syntax, local asset references, and complete client module graph checked.');
