// Read-only discovery runs outside the application's filesystem worker pool.
import {readdir,realpath,lstat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function directory(folder) {
  const stat=await lstat(folder);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw Object.assign(new Error(),{code:'UNSAFE'});
}
async function places() {
  const home=os.homedir(),seen=new Set();let count=0;
  async function offer(item) {
    if(seen.has(item.path)||count>=256)return;
    seen.add(item.path);count++;
    try{await directory(item.path);send({place:item});}catch{} // Optional shortcuts may be offline.
  }
  const candidates=[{name:'Home',path:home,kind:'home'}];
  for(const name of ['Desktop','Documents','Downloads'])candidates.push({name,path:path.join(home,name),kind:'folder'});
  for(const base of [process.env.OneDrive,process.env.OneDriveConsumer,process.env.OneDriveCommercial].filter(Boolean)){
    candidates.push({name:'OneDrive',path:base,kind:'folder'});
    for(const name of ['Desktop','Documents'])candidates.push({name:name+' (OneDrive)',path:path.join(base,name),kind:'folder'});
  }
  const scans=[];
  if(process.platform==='win32')for(let i=65;i<=90;i++)candidates.push({name:String.fromCharCode(i)+':',path:String.fromCharCode(i)+':'+path.sep,kind:'drive'});
  else{
    candidates.push({name:'Computer',path:'/',kind:'drive'});
    for(const root of ['/Volumes','/mnt','/media','/run/media',path.join('/media',path.basename(home)),path.join('/run/media',path.basename(home))]){
      scans.push((async()=>{try{const entries=await readdir(root,{withFileTypes:true});await Promise.all(entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()).slice(0,256).map(e=>offer({name:e.name,path:path.join(root,e.name),kind:'drive'})));}catch{}})());
    }
  }
  await Promise.all([...candidates.map(offer),...scans]);
}
try{
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw new Error();}
  const {path:requested,search,offset,hidden,discover}=JSON.parse(input);
  const folder=await realpath(requested||os.homedir());await directory(folder);
  const entries=await readdir(folder,{withFileTypes:true});
  const directories=entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&(hidden||!e.name.startsWith('.'))&&e.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const breadcrumbs=[];let current=folder;
  while(true){breadcrumbs.unshift({name:path.basename(current)||current,path:current});const parent=path.dirname(current);if(parent===current)break;current=parent;}
  send({listing:{folder,parent:path.dirname(folder),breadcrumbs,folders:directories.slice(offset,offset+200).map(e=>({name:e.name,path:path.join(folder,e.name)})),offset,total:directories.length,hasMore:offset+200<directories.length}});
  if(discover)await places();
  send({done:true});
}catch(error){send({error:['ENOENT','ENOTDIR','EACCES','EPERM','UNSAFE'].includes(error.code)?error.code:'IO'});}
