// A live manifest can contain arbitrarily many files. Parse descriptors one at
// a time into the existing encrypted scratch store; do not fetch their URLs
// until the caller has authenticated the entire manifest against its receipt.
import {datasetJSONTokens} from './dataset-json-tokens.js';
export const safeLivePath=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\\%?#\x00-\x20]/.test(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!value.includes(':');
const fields=new Set(['path','bytes','sha256']);
export async function retainLiveManifest(chunks,work,releaseId,{signal,fail}={}){
 let root=false,files=false,ended=false,release=null,current=null,count=0,batch=[];
 const reject=()=>{throw fail('manifest');};
 const selected=({path})=>path.length===1&&path[0]==='releaseId'||path.length===3&&path[0]==='files'&&fields.has(path[2]);
 async function flush(){
  if(!batch.length)return;const names=batch.map(file=>file.path);
  if(new Set(names).size!==names.length||(await work.getMany(names)).size)reject();
  await work.putMany(batch.map(file=>[file.path,file]));batch=[];
 }
 try{
  for await(const token of datasetJSONTokens(chunks,selected,{rowChars:65536,keys:1024,depth:64},{signal})){
   const {event,path,type,kind,value}=token;
   if(!path.length){if(event==='begin'){if(root||type!=='object')reject();root=true;}else if(event==='end')ended=true;else reject();continue;}
   if(path.length===1&&path[0]==='files'){if(event==='begin'){if(files||type!=='array')reject();files=true;}else if(event!=='end')reject();continue;}
   if(path.length===1&&path[0]==='releaseId'){if(event!=='value'||kind!=='string'||release!==null)reject();release=value;continue;}
   if(path[0]!=='files')continue;
   if(path.length===2){
    if(event==='begin'){if(type!=='object'||current)reject();current={};}
    else if(event==='end'){
     if(!current||!safeLivePath(current.path)||current.path==='publication.json'||!Number.isSafeInteger(current.bytes)||current.bytes<0||!/^[a-f0-9]{64}$/.test(current.sha256??''))reject();
     batch.push(current);current=null;count++;if(!Number.isSafeInteger(count))reject();if(batch.length===32)await flush();
    }else reject();
   }else if(path.length===3&&fields.has(path[2])){
    if(!current||event!=='value'||kind!==(path[2]==='bytes'?'number':'string'))reject();current[path[2]]=path[2]==='bytes'?Number(value):value;
   }
  }
  if(!root||!ended||!files||current||release!==releaseId)reject();await flush();return count;
 }catch(error){signal?.throwIfAborted();if(error.code==='MATERIAL_TABLE')reject();throw error;}
}
export async function retainRemovedLivePaths(work,removed,{signal,fail}={}){
 let batch=[],count=0;
 async function flush(){
  if(!batch.length)return;const names=batch.map(file=>file.path);
  if(new Set(names).size!==names.length||(await work.getMany(names)).size)throw fail('inventory');
  await work.putMany(batch.map(file=>[file.path,file]));batch=[];
 }
 for await(const path of removed){signal?.throwIfAborted();if(!safeLivePath(path)||path==='publication.json')throw fail('inventory');batch.push({path,absent:true});count++;if(batch.length===32)await flush();}
 await flush();return count;
}
