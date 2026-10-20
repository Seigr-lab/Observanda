import {validWebsiteSourceOperation} from './web/website-source-selection.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {emptyPublicationSource,validPublicationSources} from './web/publication-sources-model.js';
import {validWebsiteSelection} from './web/website-selection.js';
import {validEditionSelection,editionRevisionKey,editionAvailabilityKey} from './web/publication-selection.js';
import {WEBSITE_SOURCES_PATH,websiteSourcePosition,websiteSourceHeader,websiteSourceSummary} from './website-source-selections.js';
const invalid=()=>{throw new AppError('INVALID',[{field:'website sources'}]);};
const listPath=(position,...parts)=>[...WEBSITE_SOURCES_PATH,String(position),...parts];
const kindPath={records:['selection','records'],editionRecords:['edition','records'],history:['edition','history'],availability:['edition','availability']};
const key=(kind,value)=>kind==='history'?editionRevisionKey(value):kind==='availability'?editionAvailabilityKey(value):value.id;
// One editor command contains at most 32 operations. Scan each affected saved
// collection once, retaining only those requested identities and positions.
export function websiteSourceCommandLookup(operations){
 const wanted=new Set(operations.flatMap(operation=>operation.type==='source-selection'?[operation.recordId,operation.key].filter(Boolean):[])),tables=new Map();
 return {clear(){tables.clear();},invalidate(path){tables.delete(JSON.stringify(path));},remember(path,id,position){tables.get(JSON.stringify(path))?.set(id,position);},async find(document,path,id,identity,{signal}={}){
  const key=JSON.stringify(path);let table=tables.get(key);
  if(!table){table=new Map();if(await document.tree.select(document.root,path))for await(const item of document.items(path,{signal})){signal?.throwIfAborted();const value=await document.tree.read(item.value),name=identity(value);if(wanted.has(name)){if(table.has(name))invalid();table.set(name,item.index);}}tables.set(key,table);}
  if(!table.has(id))return null;const position=table.get(id),value=(await document.field([...path,String(position)],{signal})).value;if(identity(value)!==id)throw new AppError('CATALOGUE_DAMAGED');return {position,value};
 }};
}
async function find(document,path,id,identity=value=>value.id,{signal,lookup}={}){
 if(lookup)return lookup.find(document,path,id,identity,{signal});
 if(!await document.tree.select(document.root,path))return null;
 for await(const item of document.items(path,{signal})){signal?.throwIfAborted();const value=await document.tree.read(item.value);if(identity(value)===id)return {position:item.index,value};}return null;
}
export async function readWebsiteSources(document,{sourceId=null,sourceIds=[],recordIds=[],collection='owners',offset=0,limit=20,signal}={}){
 if(sourceId!==null&&!researchId(sourceId)||!Array.isArray(sourceIds)||sourceIds.length>100||!sourceIds.every(researchId)||!Array.isArray(recordIds)||recordIds.length>100||!recordIds.every(researchId)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100||!['owners',...Object.keys(kindPath)].includes(collection))invalid();
 const summary=await websiteSourceSummary(document),sources=[],wanted=new Set(sourceIds);
 if(sourceId===null){
  for(let position=0;position<summary.count;position++){
   signal?.throwIfAborted();const source=await websiteSourceHeader(document,position,{signal});
   if(wanted.size?wanted.has(source.workspaceId):position>=offset&&sources.length<limit)sources.push(source);
   if(!wanted.size&&sources.length===limit)break;
  }
  return {summary,sources,offset};
 }
 const position=await websiteSourcePosition(document,sourceId,{signal});if(position===null)return {summary,source:null,rows:[],total:0,offset};
 const source=await websiteSourceHeader(document,position,{signal}),records=new Set(recordIds),path=listPath(position,...kindPath.records);
 if(records.size)for await(const item of document.items(path,{signal})){const value=await document.tree.read(item.value);if(records.has(value.id))source.selection.records.push(value);}
 const rows=[];let total=0;
 if(collection!=='owners'){
  const path=listPath(position,...kindPath[collection]);total=await document.tree.select(document.root,path)?await document.tree.arrayLength(document.root,path):0;
  for(let at=offset;at<Math.min(total,offset+limit);at++){signal?.throwIfAborted();const value=(await document.field([...path,String(at)],{signal})).value;rows.push({position:at,key:key(collection,value),value});}
 }
 return {summary,source,rows,total,offset};
}
// Mutate the selected member in the same authoritative website value tree.
// The existing editor transaction retains its pin, command receipt and undo.
export async function changeWebsiteSources(document,operation,{signal,recordProject,lookup}={}){
 if(!validWebsiteSourceOperation(operation))invalid();const {workspaceId,kind}=operation;
 let position=await websiteSourcePosition(document,workspaceId,{signal});
 if(kind==='remove'){lookup?.clear();return position===null?document:document.splice(WEBSITE_SOURCES_PATH,position,1,[],{signal});}
 if(position===null){
  const source=emptyPublicationSource(workspaceId,operation.labBookId);position=(await websiteSourceSummary(document)).count;
  if(!await document.tree.select(document.root,WEBSITE_SOURCES_PATH))document=await document.property(['document','website'],'researchSources',[],{signal});
  document=await document.splice(WEBSITE_SOURCES_PATH,position,0,[source],{signal});
 }
 const source=await websiteSourceHeader(document,position,{signal});if(source.labBookId!==operation.labBookId)invalid();const base=listPath(position),records=[...base,'selection','records'];
 if(kind==='edition'){
  const {collection,value}=operation;
  if(value!==null){const valid=validEditionSelection({version:1,records:collection==='editionRecords'?[value]:[],...(collection==='history'?{history:[value]}:collection==='availability'?{availability:[value]}:{})});if(!valid||key(collection,value)!==operation.key)invalid();}
  if(!await document.tree.select(document.root,[...base,'edition']))document=await document.property(base,'edition',{version:1,records:[]},{signal});
  const path=listPath(position,...kindPath[collection]);if(!await document.tree.select(document.root,path))document=await document.property(path.slice(0,-1),path.at(-1),[],{signal});
  const item=await find(document,path,operation.key,value=>key(collection,value),{signal,lookup});
  if(value===null){lookup?.invalidate(path);return item?document.splice(path,item.position,1,[],{signal}):document;}
  if(!item)lookup?.remember(path,operation.key,await document.tree.arrayLength(document.root,path));
  return item?document.replace([...path,String(item.position)],value,{signal}):document.splice(path,await document.tree.arrayLength(document.root,path),0,[value],{signal});
 }
 const projectId=operation.projectId;
 if(operation.share&&!source.projectIds.includes(projectId))source.projectIds.push(projectId);
 if(source.labBookId&&source.projectIds.some(id=>id!==projectId)){source.projectIds=[projectId];source.selection.includeProjects=source.selection.includeProjects.length?[projectId]:[];}
 if(kind==='project'){
  lookup?.invalidate(records);
  if(operation.share&&!source.selection.includeProjects.includes(projectId))source.selection.includeProjects.push(projectId);
  if(!operation.share)source.selection.includeProjects=source.selection.includeProjects.filter(id=>id!==projectId);
  let at=await document.tree.arrayLength(document.root,records);
  while(at--){signal?.throwIfAborted();const path=[...records,String(at)],value=(await document.field(path,{signal})).value;
   if(!source.labBookId){if(!recordProject)throw new AppError('ACCESS_LOCKED');if(await recordProject(workspaceId,value.id)!==projectId)continue;}
   if(!value.attachments.length)document=await document.splice(records,at,1,[],{signal});else document=await document.replace(path,{...value,share:null},{signal});
  }
 }else{
  const item=await find(document,records,operation.recordId,undefined,{signal,lookup}),value=item?.value??{id:operation.recordId,share:null,attachments:[]};
  if(kind==='record')value.share=operation.share;
  else{const attachment=value.attachments.find(a=>a.id===operation.attachmentId);if(attachment)attachment.share=operation.share;else value.attachments.push({id:operation.attachmentId,share:operation.share});}
  if(!validWebsiteSelection({defaultShare:false,includeProjects:[],records:[value]}))invalid();
  if(!item)lookup?.remember(records,operation.recordId,await document.tree.arrayLength(document.root,records));
  document=item?await document.replace([...records,String(item.position)],value,{signal}):await document.splice(records,await document.tree.arrayLength(document.root,records),0,[value],{signal});
 }
 if(!validPublicationSources([source]))invalid();document=await document.replace([...base,'projectIds'],source.projectIds,{signal});
 return document.replace([...base,'selection','includeProjects'],source.selection.includeProjects,{signal});
}
