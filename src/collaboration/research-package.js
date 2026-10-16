import path from 'node:path';
import {AppError} from '../errors.js';
import {privateDirectory,assertRegular} from '../storage.js';
import {contentBuffer,contentStream,describeContent,writeContent} from '../file-content.js';
import {ResearchMaterials} from '../research-materials.js';
import {ResearchTransfer} from './research-transfer.js';
import {validateSelection} from './selection.js';
import {recordRevision} from '../research.js';
import {identityHash} from './identity.js';
import {retainedRecordPointer} from '../retained-record-documents.js';

const fail=()=>{throw new AppError('COLLABORATION_PACKAGE');};
export async function packageSelection(parts){return validateSelection(await parts.value('description','selection'));}
export async function packageRecords(parts){
 const records=new Map();for await(const item of parts.items())if(item.kind==='record'){
  const record=await parts.value('record',item.name);if(record.id!==item.name)fail();records.set(record.id,{id:record.id,notebookId:record.notebookId,revision:recordRevision(record),title:record.title});
 }
 return records;
}
export async function collectResearch(workspace,metadata,parts){
 await workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),notebookIds=new Set(metadata.notebooks.map(n=>n.id)),ids=new Set();
  async function* records(){for await(const row of store.members(snapshot,{notebookIds}))yield store.record(row.id,row.revision);}
  for await(const record of records()){ids.add(record.id);await parts.add({kind:'record',name:record.id,content:JSON.stringify(record)});}
  const transfer=new ResearchTransfer(workspace,ids,notebookIds,part=>parts.add(part));
  await transfer.copy(records(),new ResearchMaterials(workspace).headEntries());
 });
}

// Copy authenticated parts through native storage owners. Immutable names may
// be reused only for identical bytes; head changes are reviewed separately.
export async function admitParts(workspace,parts,{heads=true}={}){
 for await(const item of parts.items()){
  if(item.kind==='metadata'){
   if(!heads&&item.name.endsWith('/head.json'))continue;
   const raw=(await contentBuffer(parts.content(item))).toString('utf8'),old=await workspace.readMetadata(item.name,16*1024*1024);
   if(old!==null&&!item.name.endsWith('/head.json')&&item.name!=='.observanda/fonts/library.json'){
    if(item.name.startsWith('.observanda/media-imports/')){
     const incoming=JSON.parse(raw),prior=JSON.parse(old);if(Object.keys(incoming).some(key=>identityHash(incoming[key])!==identityHash(prior[key])))fail();
    }else if(item.name.startsWith('.observanda/materials/records/')&&retainedRecordPointer(JSON.parse(old))){
     const incoming=JSON.parse(raw),match=/^\.observanda\/materials\/records\/([^/]+)\/([a-f0-9]{64})\.json$/.exec(item.name);
     if(!match||incoming.id!==match[1]||recordRevision(incoming)!==match[2])fail();
     await new ResearchMaterials(workspace).checkReference({kind:'record',id:match[1],revision:match[2]});
    }else if(identityHash(JSON.parse(old))!==identityHash(JSON.parse(raw)))fail();
    continue;
   }
   if(item.name==='.observanda/fonts/library.json'&&old){
    const merged=new Map(JSON.parse(old).map(f=>[f.id,f]));for(const font of JSON.parse(raw)){const prior=merged.get(font.id);if(prior&&JSON.stringify(prior.faces)!==JSON.stringify(font.faces))fail();if(!prior)merged.set(font.id,font);}
    if(merged.size>64)throw new AppError('FONT_LIMIT');await workspace.writeMetadata(item.name,JSON.stringify([...merged.values()]));
   }else await workspace.writeMetadata(item.name,raw);
  }else if(item.kind==='original'){
   const file=workspace.metadataPath(item.name);
   if(await assertRegular(file,{missing:true})){const old=await describeContent(workspace,file);if(old.size!==item.size||old.sha256!==item.sha256)fail();continue;}
   await privateDirectory(workspace.root,path.posix.dirname(item.name));
   await writeContent(workspace,file,contentStream(parts.content(item)),{maxBytes:item.size||1});
  }
 }
}
export async function populateSharedWorkspace(workspace,parts){
 const selection=await packageSelection(parts),records=await packageRecords(parts),notebooks=new Set(selection.metadata.notebooks.map(n=>n.id));
 for(const record of records.values())if(!notebooks.has(record.notebookId))fail();
 await admitParts(workspace,parts);
 await workspace.catalogue(async store=>{
  const head=await store.head(),snapshot=await store.snapshot(head);if(snapshot.count||snapshot.metadata.id!==selection.metadata.id)fail();
  async function* changed(){for(const record of records.values())yield parts.value('record',record.id);}
  await store.commitChanges(head,snapshot,snapshot.metadata,changed());
  await new ResearchMaterials(workspace).index.ensureLocked();
  await store.verify({format:'observanda-research-catalogue',version:2,workspaceId:selection.metadata.id});
 });
 // Prove that every supplied research part belongs to the authenticated
 // selection's reachable evidence. A valid signature cannot smuggle unrelated
 // material, additional records, settings or files into a shared copy.
 const seen=new Set(),transfer=new ResearchTransfer(workspace,new Set(records.keys()),[...notebooks],async part=>{
  const item=await parts.descriptor(part.kind,part.name);if(!item)fail();
  const {contentSize,contentHash}=await import('../file-content.js');
  if(contentSize(part.content)!==item.size||contentHash(part.content)!==item.sha256)fail();seen.add(part.kind+':'+part.name);
 });
 async function* values(){for(const record of records.values())yield parts.value('record',record.id);}
 await transfer.copy(values(),new ResearchMaterials(workspace).headEntries());
 for await(const item of parts.items())if(['metadata','original'].includes(item.kind)&&!seen.has(item.kind+':'+item.name))fail();
 return selection;
}
