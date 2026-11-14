import {readFile,writeFile,mkdir,readdir,stat,copyFile} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..');
const types={'.m4a':'audio/mp4','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.woff':'font/woff'};
await mkdir(resolve(root,'dist/vendor'),{recursive:true});
await copyFile(resolve(root,'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs'),resolve(root,'dist/vendor/mediabunny.mjs'));
await copyFile(resolve(root,'node_modules/mediabunny/LICENSE'),resolve(root,'dist/vendor/mediabunny-LICENSE.txt'));
await copyFile(resolve(root,'node_modules/acorn/dist/acorn.mjs'),resolve(root,'dist/vendor/acorn.mjs'));
await copyFile(resolve(root,'node_modules/acorn/LICENSE'),resolve(root,'dist/vendor/acorn-LICENSE.txt'));
const assets={};
async function collect(directory){
  for(const item of await readdir(directory,{withFileTypes:true})){
    if(item.name==='server'||item.name==='.openai')continue;
    const file=resolve(directory,item.name);
    if(item.isDirectory()){await collect(file);continue;}
    if((await stat(file)).size>5e6)throw new Error('Unexpected large asset: '+relative(root,file));
    const key='/'+relative(resolve(root,'dist'),file).split('\\').join('/');
    assets[key]={type:types[extname(file)]||'application/octet-stream',base64:(await readFile(file)).toString('base64')};
  }
}
await collect(resolve(root,'dist'));
await writeFile(resolve(root,'worker/assets.generated.js'),'export const assets='+JSON.stringify(assets)+';\n');
await mkdir(resolve(root,'dist/server'),{recursive:true});
await build({entryPoints:[resolve(root,'worker/index.js')],outfile:resolve(root,'dist/server/index.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
const manifest=JSON.parse(await readFile(resolve(root,'.openai/hosting.json'),'utf8'));delete manifest.static;
await writeFile(resolve(root,'.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Built Worker with '+Object.keys(assets).length+' assets; '+(await stat(resolve(root,'dist/server/index.js'))).size+' bytes.');
