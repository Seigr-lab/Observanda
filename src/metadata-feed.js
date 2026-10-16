import {retiredMetadataSourceLocation} from './project-retired-metadata.js';
// Chronological live lists over the shared authenticated metadata index.
// Each entry is immutable; processing progress stays in the domain object.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
const validKey=key=>typeof key==='string'&&/^\d{13}-[a-f0-9-]{36}\.json$/.test(key)&&researchId(key.slice(14,-5));
export class MetadataFeed{
 constructor(workspace,source){workspace.metadataPath(source);this.workspace=workspace;this.source=source;this.order=source+'-order';this.marker=this.order+'.json';}
 key(item){const time=Date.parse(item.createdAt);if(!researchId(item.id)||!Number.isSafeInteger(time)||time<0||time>9999999999999)throw new AppError('CATALOGUE_DAMAGED');return String(9999999999999-time).padStart(13,'0')+'-'+item.id+'.json';}
 async initialized(){const raw=await this.workspace.readMetadata(this.marker,1024);if(raw===null)return false;if(JSON.parse(raw).version!==1)throw new AppError('CATALOGUE_DAMAGED');return true;}
 async retired(file){return this.workspace.projectId||await this.workspace.storageKind()!=='catalogue'?false:this.workspace.catalogue(store=>retiredMetadataSourceLocation(store,'metadata:'+file).then(Boolean));}
 async ensureLocked(){
  if(await this.initialized())return;
  // One in-place index build for previously created imports, committed with its
  // marker. A failed build cannot leave a partial list or duplicate originals.
  for await(const name of this.workspace.metadataNames(this.source)){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))throw new AppError('CATALOGUE_DAMAGED');
   if(await this.retired(this.source+'/'+name))continue;
   const raw=await this.workspace.readMetadata(this.source+'/'+name,8192),item=JSON.parse(raw);
   if(item.id!==name.slice(0,-5))throw new AppError('CATALOGUE_DAMAGED');await this.putLocked(item);
  }
  await this.workspace.writeMetadata(this.marker,JSON.stringify({version:1}));
 }
 async ensure(){if(!await this.initialized())await this.workspace.withLock(()=>this.ensureLocked());}
 async putLocked(item){await this.workspace.writeMetadata(this.order+'/'+this.key(item),JSON.stringify({id:item.id,createdAt:item.createdAt}));}
 async page({cursor=null,limit=20,localOnly=true}={}){
  let after=null;
  if(cursor!==null){
   if(typeof cursor!=='string'||cursor.length>512||!/^[A-Za-z0-9_-]+$/.test(cursor))throw new AppError('INVALID');
   let decoded;try{decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{throw new AppError('INVALID');}
   if(decoded.source!==this.source||(decoded.websiteId??null)!==(this.workspace.websiteId??null)||!validKey(decoded.after)||decoded.version!==1)throw new AppError('INVALID');after=decoded.after;
  }
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError('INVALID');
  return this.workspace.catalogue(async()=>{
  // Reading an empty or older feed must never claim the workspace writer.
  // Writers build the durable ordering index in their own transaction. Until
  // then, select one bounded page from the retained source in this snapshot.
  if(!await this.initialized())return this.legacyPage(after,limit,localOnly);
  const page=await this.workspace.metadataPage(this.order,{after,limit,localOnly}),items=page.items.map(({name,text})=>{
   const item=JSON.parse(text);if(!validKey(name)||name!==this.key(item))throw new AppError('CATALOGUE_DAMAGED');return item;
  });
  return {items,next:this.cursor(page.next)};
  });
 }
 cursor(after){return after?Buffer.from(JSON.stringify({version:1,source:this.source,...(this.workspace.websiteId?{websiteId:this.workspace.websiteId}:{}),after})).toString('base64url'):null;}
 async legacyPage(after,limit,localOnly=true){
  const selected=[];
  for await(const name of this.workspace.metadataNames(this.source)){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))throw new AppError('CATALOGUE_DAMAGED');
   if(localOnly&&await this.retired(this.source+'/'+name))continue;
   const item=JSON.parse(await this.workspace.readMetadata(this.source+'/'+name,8192)),key=this.key(item);
   if(item.id!==name.slice(0,-5))throw new AppError('CATALOGUE_DAMAGED');
   if(after&&key<=after)continue;
   if(selected.length===limit+1&&key>=selected.at(-1).key)continue;
   selected.push({key,item:{id:item.id,createdAt:item.createdAt}});selected.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);if(selected.length>limit+1)selected.pop();
  }
  const more=selected.length>limit;if(more)selected.pop();
  return {items:selected.map(row=>row.item),next:more?this.cursor(selected.at(-1).key):null};
 }
}
