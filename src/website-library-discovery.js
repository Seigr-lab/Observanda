import {AppError} from './errors.js';
import {PublicationConversion} from './publication-conversion.js';
import {RecordPublicationIndex} from './record-publication-index.js';
import {withRecordDocument} from './record-document.js';
import {SnapshotIndex} from './snapshot-index.js';
import {researchId} from './web/research-reference.js';
import {sourceNotebookAllowed} from './web/source-publication-permissions.js';
import {runWebsiteUpgrade,upgradeControl} from './website-upgrade-lease.js';
import {indexHistoricalSources,reconcileHistoricalMembership} from './website-feed-discovery.js';
import {setTimeout as delay} from 'node:timers/promises';

const windowSize=40;
const discoveryVersion=2;
const locked=error=>['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code);
function* flatMembers(records,after){for(let i=(after??-1)+1;i<records.length;i++)yield records[i];}

// New grants are materialized by the research writer. The initial sweep also
// covers grants made before that writer existed, independently of site usage.
async function grantWindow(store,snapshot,after,signal){
 const books=new Map(snapshot.metadata.notebooks.filter(book=>sourceNotebookAllowed(book)).map(book=>[book.id,book]));
 const grants=[];
 if(!books.size)return {grants,after:null};
 const indexed=RecordPublicationIndex.valid(snapshot.publicationIndex);
 const members=indexed?new RecordPublicationIndex(store).rows(snapshot,new Map([...books.keys()].map(id=>[id,'shared'])),{after,signal}):
  snapshot.indexVersion?new SnapshotIndex(store).members(snapshot.membership,{after}):flatMembers(snapshot.records,after);
 let count=0,last;
 for await(const row of members){
  signal?.throwIfAborted();
  const info=row.share!==undefined&&row.notebookId!==undefined?row:await withRecordDocument(store,row.id,row.revision,async document=>({
   share:(await document.field(['share'])).value,notebookId:(await document.field(['notebookId'])).value
  }));
  const book=books.get(info.notebookId);
  if(info.share===true&&book)grants.push({workspaceId:snapshot.metadata.id,projectId:book.projectId,notebookId:book.id,recordId:row.id,target:'website'});
  last=indexed?row.position:snapshot.indexVersion?row.id:(after??-1)+count+1;
  if(++count===windowSize)return {grants,after:last};
 }
 return {grants,after:null};
}

export async function seedEligibleWebsiteOwner(store,reader,namespace,{signal}={}){
 if(!researchId(namespace))throw new AppError('INVALID');
 const name='eligible-entries-'+namespace,control=upgradeControl(name);
 const read=()=>store.scope(()=>store.control(control,{missing:true}),{signal});
 const receipt=await read();if(receipt?.version===discoveryVersion&&receipt.complete===true)return;
 return runWebsiteUpgrade(store,name,async()=>{
  const converter=new PublicationConversion(store.workspace,{store});let saved=await read();
  if(saved?.version===discoveryVersion&&saved.complete===true)return;
  await indexHistoricalSources(store,signal);
  let retries=0;
  for(;;){
   signal?.throwIfAborted();
   const {value:page}=await reader.use(namespace,undefined,async(catalogue,snapshot,{snapshotId})=>{
    if(snapshot.metadata.id!==namespace)throw new AppError('DATABASE_LOCATION');
    const after=saved?.version===discoveryVersion&&saved.snapshotId===snapshotId?saved.after:null;
    return {...await grantWindow(catalogue,snapshot,after,signal),snapshotId};
   });
   try{
    if(page.grants.length)await converter.seedWebsites(page.grants,consume=>reader.use(namespace,undefined,(catalogue,snapshot,context)=>{
     if(context.snapshotId!==page.snapshotId)throw new AppError('RECORD_CHANGED');
     return consume(catalogue,snapshot,context);
    }),{signal,refreshHistoricalLive:true});
    if(page.after===null)await reconcileHistoricalMembership(store,reader,namespace,page.snapshotId,converter,signal);
   }catch(error){
    if(!['RECORD_CHANGED','CONFLICT','PUBLICATION_PERMISSIONS_CHANGED'].includes(error.code)||++retries>4)throw error;
    await delay(100*retries,undefined,{signal});continue;
   }
   retries=0;
   saved={version:discoveryVersion,snapshotId:page.snapshotId,after:page.after,complete:page.after===null};
   await store.scope(()=>store.writeControl(control,saved,{signal}),{write:true,signal});
   if(saved.complete)return;
  }
 },{signal,shareResult:false});
}

async function walkOwners(store,reader,signal){
 let deferred=0;
 await seedEligibleWebsiteOwner(store,reader,reader.host.workspaceId,{signal});
 let projectCursor=null;
 do{
  const projects=await reader.projectOwners(projectCursor);
  for(const {projectId,namespaceId} of projects.items){
   try{
    await seedEligibleWebsiteOwner(store,reader,namespaceId,{signal});
    let after=null,revision=null;
    do{
     const books=await reader.bookOwners(projectId,namespaceId,{after,revision});
     for(const book of books.items){
      try{await seedEligibleWebsiteOwner(store,reader,book.namespaceId,{signal});}
      catch(error){if(!locked(error))throw error;deferred++;}
     }
     after=books.next;revision=books.revision;
    }while(after!==null);
   }catch(error){if(!locked(error))throw error;deferred++;}
  }
  projectCursor=projects.next;
 }while(projectCursor!==null);
 return {state:deferred?'locked':'ready',deferred};
}

const libraryReceipt=upgradeControl('eligible-library');
export function lastWebsiteLibraryDiscovery(store,signal){
 return store.scope(()=>store.control(libraryReceipt,{missing:true}),{signal});
}
export async function discoverEligibleWebsiteSources(store,reader,{signal}={}){
 const remember=value=>store.scope(async()=>{
  const prior=await store.control(libraryReceipt,{missing:true});
  if(prior?.state!==value.state||prior?.deferred!==value.deferred||prior?.code!==value.code)await store.writeControl(libraryReceipt,value,{signal});
 },{write:true,signal});
 try{
  const result=await walkOwners(store,reader,signal);await remember(result);return result;
 }catch(error){
  if(!signal?.aborted)await remember({state:'failed',code:error instanceof AppError?error.code:'IO'});
  throw error;
 }
}
