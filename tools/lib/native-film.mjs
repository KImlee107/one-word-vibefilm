import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createCanvas,Path2D,GlobalFonts} from '@napi-rs/canvas';
import {FILM_ALIAS_NAMES} from '../../dist/film-program.js';
GlobalFonts.registerFromPath(new URL('../../dist/fonts/knowledge-sans.woff',import.meta.url).pathname,'VK Sans');
GlobalFonts.registerFromPath(new URL('../../dist/fonts/knowledge-serif.woff',import.meta.url).pathname,'VK Serif');
export async function nativeWorker(){
  let reply;
  const self={fonts:{add(){}},postMessage(value){reply?.(value);}};
  const context=vm.createContext({self,Path2D,FontFace:class{async load(){return this;}},URLSearchParams,OffscreenCanvas:function(w,h){const canvas=createCanvas(w,h);canvas.transferToImageBitmap=()=>{const copy=createCanvas(canvas.width,canvas.height);copy.getContext('2d').drawImage(canvas,0,0);return copy;};return canvas;}});
  vm.runInContext(await readFile(new URL('../../dist/film-worker.js',import.meta.url),'utf8'),context,{timeout:3000});
  const call=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker test timeout')),8000);reply=value=>{clearTimeout(timer);value.error?reject(Object.assign(new Error(value.error),{code:value.code,phase:value.phase})):resolve(value);};self.onmessage({data:message});});
  await call({type:'init',id:1,engine:await readFile(new URL('../../dist/vendor/vibe-knowledge-film/vk.js',import.meta.url),'utf8'),fonts:[],aliases:FILM_ALIAS_NAMES});return call;
}
