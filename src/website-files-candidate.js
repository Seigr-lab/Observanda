import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {FileContent,contentSize,contentHash,contentStream} from './file-content.js';
import {outputName} from './local-export-files.js';
import {hasPrivateTextStream} from './privacy-text-stream.js';
import {digest,serialize} from './storage-format.js';

// This candidate owns saved website bytes. It has no research snapshot, reader,
// catalogue or renderer; its authority is the file store's current revision.
export class WebsiteFilesCandidate {
 constructor(store,siteId,revision,files,{blockedValues=[]}={}){
  this.store=store;this.siteId=siteId;this.revision=revision;this.files=new Map(files);this.blockedValues=blockedValues;
  this.files.delete('publication.json');
  const members=[...this.files].map(([name,value])=>({path:outputName(name),bytes:contentSize(value),sha256:contentHash(value)}));
  this.id=digest(serialize(members));this.reviewId=this.id;this.designOnly=false;this.defaultPage='index.html';
  this.files.set('publication.json',serialize({formatVersion:2,generator:'Observanda',releaseId:this.id,projects:[],entries:[],files:members}));
 }
 static async open(store,siteId,revision,options){
  const value=await store.export(siteId,{expectedRevision:revision});
  return new WebsiteFilesCandidate(store,siteId,value.revision,value.files,options);
 }
 async verify({signal,onFile}={}){
  await this.store.checkRevision(this.siteId,this.revision);
  for(const [name,content] of this.files){
   signal?.throwIfAborted();outputName(name);
   // The privacy scan replays text. Verify each replay as it streams rather
   // than fetching the same file from storage for a separate digest pass.
   async function* checked(){
    const hash=createHash('sha256');let size=0;
    const stream=content instanceof FileContent?content.stream(0,content.size-1,{signal}):contentStream(content);
    for await(const bytes of stream){signal?.throwIfAborted();hash.update(bytes);size+=bytes.length;yield bytes;}
    if(size!==contentSize(content)||hash.digest('hex')!==contentHash(content))throw new AppError('STALE');
   }
   if(/\.(?:html|css|json|svg|csv|js|vtt)$/i.test(name)){
    if(await hasPrivateTextStream(checked,this.blockedValues,{signal}))throw new AppError('PRIVACY',[{field:'website file'}]);
   }else for await(const _ of checked()){ /* Validate binary assets in one pass. */ }
   await onFile?.(contentSize(content));
  }
  await this.store.checkRevision(this.siteId,this.revision);
 }
}
