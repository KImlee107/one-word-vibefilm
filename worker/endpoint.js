/** A custom endpoint must resolve only to public addresses before a request. */
const checked=new Map();
export function isPublicAddress(address){
  if(typeof address!=='string')return false;
  if(address.includes(':')){
    const a=address.toLowerCase();return /^[23][0-9a-f]{0,3}:/.test(a)&&!a.startsWith('2001:db8:')&&!a.startsWith('2001:0:')&&!a.startsWith('2002:')&&!a.includes('.');
  }
  const parts=address.split('.');if(parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255))return false;
  const [a,b,c]=parts.map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&[0,2].includes(c))||(b===88&&c===99)))||(a===198&&[18,19].includes(b))||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
}
export async function checkPublicEndpoint(config,{fetcher=fetch,signal}={}){
  if(!config.requiresDNSCheck)return;
  const host=new URL(config.baseURL).hostname;if((checked.get(host)||0)>Date.now())return;
  const responses=await Promise.all(['A','AAAA'].map(async type=>{
    const response=await fetcher('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,{headers:{Accept:'application/dns-json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('无法验证自定义接口的公开域名。');
    const raw=await response.text();if(raw.length>32768)throw new Error('自定义接口的 DNS 响应异常。');const data=JSON.parse(raw);
    if(data.Status!==0&&data.Status!==3)throw new Error('自定义接口域名解析失败。');
    return (data.Answer||[]).filter(a=>a.type===1||a.type===28).map(a=>a.data);
  }));
  const addresses=responses.flat();if(!addresses.length||addresses.some(a=>!isPublicAddress(a)))throw new Error('自定义接口必须解析到公开互联网地址，不能使用内网或保留地址。');
  if(checked.size>=64)checked.delete(checked.keys().next().value);checked.set(host,Date.now()+30000);
}
