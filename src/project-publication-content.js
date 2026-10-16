// Historical editions resolve immutable blobs through their adopted project.
import path from 'node:path';
import {FileContent} from './file-content.js';
import {OwnedFileContent} from './owned-file-content.js';
import {publicationFiles,publicationFileStamp} from './publication-files.js';
import {retiredMetadataSourceLocation,retainedMetadataValue} from './project-retired-metadata.js';
import {adoptedMetadataFact,exclusiveMetadataFact} from './project-metadata-ownership.js';
import {withRetiredProjectCatalogue} from './project-retired-records.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value)),damaged=()=>{throw new AppError('JOB_DAMAGED');};
export const publicationMetadataKey=(site,id)=>{if(!researchId(site)||!revisionId(id))damaged();return 'metadata:.observanda/websites/'+site+'/release-candidates/'+id+'.json';};
export async function assertPublicationOwner(store,owner,key,revision,site){
 const fact=await adoptedMetadataFact(store,owner,key);if(!exclusiveMetadataFact(fact,owner.projectId)||fact.sourceRevision!==revision)damaged();
 const proof=await store.object('project:website-origin:'+site);if(proof?.version!==1||proof.id!==site||proof.projectId!==owner.projectId||proof.sourceNamespace!==owner.sourceNamespace||proof.namespaceId!==owner.namespaceId)damaged();
}
export async function retainedPublicationCandidate(store,owner,key,revision){
 const match=/^metadata:\.observanda\/websites\/([a-f0-9-]{36})\/release-candidates\/([a-f0-9]{64})\.json$/.exec(key);if(!match)damaged();await assertPublicationOwner(store,owner,key,revision,match[1]);
 const value=await retainedMetadataValue(store,revision);if(typeof value.text!=='string'||Buffer.byteLength(value.text)>16*1024*1024)damaged();let candidate;try{candidate=JSON.parse(value.text);}catch{damaged();}
 if(candidate.websiteId!==match[1]||publicationMetadataKey(candidate.websiteId,candidate.reviewId)!==key)damaged();return candidate;
}
export async function* projectPublicationContents(workspace,stored,{offset=0}={}){
 const files=publicationFiles(stored);if(!Number.isSafeInteger(offset)||offset<0||offset>files.length)throw new AppError('INVALID');
 const base=workspace.baseWorkspace??workspace,site=workspace.websiteId;
 if(site&&stored.websiteId!==site)damaged();
 const location=site&&!base.projectId&&await base.storageKind()==='catalogue'?await base.catalogue(store=>retiredMetadataSourceLocation(store,publicationMetadataKey(site,stored.reviewId))):null;
 const target=location?{kind:'project',id:location.owner.projectId,domain:'research'}:null;
 // Validate the potentially large immutable descriptor once for this iterator.
 // Each deferred file read still authenticates current project access and owner.
 if(location)await base.catalogue(store=>withRetiredProjectCatalogue(store,location.owner,target,async selected=>{if(hash(await retainedPublicationCandidate(selected,location.owner,location.id,location.revision))!==hash(stored))damaged();}));
 for(let index=offset;index<files.length;index++){
  const {file,relative}=files[index];
  const absolute=path.join(base.root,...relative.split('/')),header=file.type==='media'?Buffer.from(file.header,'hex'):undefined;let content;
  if(!location){await publicationFileStamp(base.root,relative);content=new FileContent(base,absolute,file.size,file.sha256,header);}
  else{
   content=new OwnedFileContent(base,absolute,file.size,file.sha256,consume=>base.catalogue(store=>withRetiredProjectCatalogue(store,location.owner,target,async selected=>{
    await assertPublicationOwner(selected,location.owner,location.id,location.revision,site);await publicationFileStamp(selected.workspace.root,relative);return consume(new FileContent(selected.workspace,path.join(selected.workspace.root,...relative.split('/')),file.size,file.sha256,header));
   })));content.header=header;
  }
  yield {file,content};
 }
}
