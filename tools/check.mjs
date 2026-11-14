import {readdir,readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build,transform} from 'esbuild';
const root=resolve(import.meta.dirname,'..');
for(const directory of ['dist','worker','tools']){
  for(const file of await readdir(resolve(root,directory))){
    if(!/\.(m?js)$/.test(file)||file==='assets.generated.js')continue;
    const child=spawnSync(process.execPath,['--check',resolve(root,directory,file)],{stdio:'inherit'});if(child.status)process.exit(child.status);
  }
}
for(const name of ['index.html','studio.html']){
 const html=await readFile(resolve(root,'dist',name),'utf8');
 for(const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await stat(resolve(root,'dist',match[1].split('?')[0]));
 if(/assets\/(?:narration\.mp3|music\.wav|sample\.mp4)/.test(html))throw new Error('Unrequested pre-generated media reference remains.');
 for(const inline of html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g))await transform(inline[1],{loader:'js',target:'es2022'});
}
const studio=await readFile(resolve(root,'dist/studio.html'),'utf8'),app=await readFile(resolve(root,'dist/app.js'),'utf8');
const ids=new Set([...studio.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
for(const match of app.matchAll(/\$\('([^']+)'\)/g))if(!ids.has(match[1]))throw new Error('Missing editor element: '+match[1]);
await transform(await readFile(resolve(root,'dist/workbench.css'),'utf8'),{loader:'css',logLevel:'error'});
await build({entryPoints:[resolve(root,'dist/app.js')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
console.log('Syntax, local asset references, editor IDs, stylesheet, and client module graph checked.');
