import {handleAPI} from './api.js';
import {assets} from './assets.generated.js';

const security={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: https:; connect-src 'self'; frame-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"
};

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')){
      try{
        const response=await handleAPI(request,env);
        if(response){const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');for(const [key,value]of Object.entries(security))headers.set(key,value);return new Response(response.body,{status:response.status,headers});}
        return Response.json({error:{code:'NOT_FOUND',message:'接口不存在。'}},{status:404,headers:{'Cache-Control':'no-store',...security}});
      }catch{
        return Response.json({error:{code:'INTERNAL_ERROR',message:'服务暂时不可用，请重试。'}},{status:500,headers:{'Cache-Control':'no-store',...security}});
      }
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD',...security}});
    const path=url.pathname==='/'?'/index.html':url.pathname;
    const asset=assets[path];
    if(!asset)return new Response('页面不存在',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8',...security}});
    const routeSecurity=path==='/code-sandbox.html'?{...security,'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"}:security;
    const headers={'Content-Type':asset.type,'Cache-Control':/\.(?:html|m?js|css)$/.test(path)?'no-cache':'public, max-age=300',...routeSecurity};
    if(request.method==='HEAD')return new Response(null,{headers});
    const bytes=Uint8Array.from(atob(asset.base64),character=>character.charCodeAt(0));
    return new Response(bytes,{headers});
  }
};
