// Deployment helper. Credential is accepted only over stdin and never persisted.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
if(process.stdin.isTTY)spawnSync('stty',['-echo'],{stdio:'inherit'});
process.stdout.write('Ready for repository credential JSON on stdin (input is hidden).\n');
let input='';const lines=createInterface({input:process.stdin,terminal:false});
for await(const line of lines){input=line;break;}
lines.close();
if(process.stdin.isTTY)spawnSync('stty',['echo'],{stdio:'inherit'});
const {credential}=JSON.parse(input);
if(!credential?.remote_url)throw new Error('Missing repository access.');
const env={...process.env};
env.GIT_TERMINAL_PROMPT='0';
if(credential.auth_mode!=='work_proxy'){
  if(!credential.token)throw new Error('Missing repository token.');
  env.GIT_CONFIG_COUNT='1';env.GIT_CONFIG_KEY_0='http.extraHeader';env.GIT_CONFIG_VALUE_0=`Authorization: Bearer ${credential.token}`;
}
function git(args,{allowFailure=false}={}){return new Promise((resolve,reject)=>{
  const child=spawn('git',args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  child.on('error',reject);child.on('close',code=>{
    if(credential.token)output=output.split(credential.token).join('[REDACTED]');
    if(code&&!allowFailure)reject(new Error('Git '+args[0]+' failed: '+output));else resolve({code,output});
  });
});}
if(!existsSync('.git'))await git(['init','-b',credential.branch||'main']);
await git(['config','user.name','Codex']);await git(['config','user.email','codex@local']);
const remote=await git(['remote','get-url','origin'],{allowFailure:true});
if(remote.code)await git(['remote','add','origin',credential.remote_url]);
else if(remote.output.trim()!==credential.remote_url)throw new Error('Repository origin mismatch.');
await git(['fetch','origin']);
const head=await git(['rev-parse','--verify','HEAD'],{allowFailure:true});
if(head.code){const upstream=await git(['rev-parse','--verify','origin/'+(credential.branch||'main')],{allowFailure:true});if(!upstream.code)await git(['reset','--soft',upstream.output.trim()]);}
await git(['add','.']);
const changes=await git(['diff','--cached','--quiet'],{allowFailure:true});
if(changes.code)await git(['commit','-m','Build knowledge video studio with request-scoped model APIs']);
const sha=(await git(['rev-parse','HEAD'])).output.trim();
await git(['push','origin','HEAD:'+(credential.branch||'main')]);
process.stdout.write(JSON.stringify({commit_sha:sha,project_id:JSON.parse(await (await import('node:fs/promises')).readFile('.openai/hosting.json','utf8')).project_id})+'\n');
