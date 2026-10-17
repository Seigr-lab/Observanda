import {WebsiteDocumentStore} from './website-document-store.js';
import {serialize} from './storage-format.js';
import {revisionId} from './web/revision-model.js';
import {publicationWorkspace,publicationSnapshot,assertWebsitePin} from './publication-pin.js';

function inputs(snapshot){
 const {revision,updatedAt,...metadata}=snapshot.metadata;void revision;void updatedAt;
 return {metadata,selection:snapshot.websiteSelection,records:snapshot.membership??snapshot.records};
}
// Research membership and the independent website revision are both inputs.
// Other websites may advance without invalidating this site's retained edition.
export async function publicationRevisionCurrent(workspace,source,{current}={}){
 workspace=publicationWorkspace(workspace);
 const revision=typeof source==='string'?source:source?.etag??source?.workspaceEtag,pin=typeof source==='string'?undefined:source?.websitePin;
 if(!revisionId(revision))return false;
 if(pin!==undefined)assertWebsitePin(workspace,pin,revision);
 // An identical owner pair needs no metadata/body comparison. The current
 // directory proves that the pin is a registered, still-open website.
 if(pin?.websiteRevision&&await workspace.storageKind()==='catalogue'){
  const base=workspace.baseWorkspace??workspace;
  if(await base.catalogue(async store=>await store.head()===revision&&(await new WebsiteDocumentStore(store).head(workspace.websiteId??null)).websiteRevision===pin.websiteRevision))return true;
 }
 current??=await workspace.currentOutline();
 if(await workspace.storageKind()!=='catalogue')return revision===current.etag&&(pin===undefined||pin.websiteRevision===null);
 return workspace.catalogue(async store=>{
  let before;
  try{before=await publicationSnapshot(store,workspace,revision,pin);}catch(error){if(['NOT_FOUND','RECORD_HISTORY_MISSING'].includes(error.code))return false;throw error;}
  const after=await publicationSnapshot(store,workspace,current.etag,current.websitePin);
  return serialize(inputs(before))===serialize(inputs(after));
 });
}
