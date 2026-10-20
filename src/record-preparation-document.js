import {RecordAttemptIndex} from './record-attempt-index.js';
// A preparation keeps its authored JSON shape; selected readers traverse the
// existing notebook-key tree without assembling its growing nested arrays.
import {createHash} from 'node:crypto';
import {RecordDocument} from './record-document.js';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {preparationCollections,preparationHeaderFields,validPreparationHeader,validPreparationRow,attemptFactSearchParts} from './web/attempt-model.js';
const invalid=()=>{throw new AppError('INVALID',[{field:'Preparation'}]);};
export const preparationWindowName=(id,collection)=>'preparation:'+id+':'+collection;
export const isPreparationWindow=name=>typeof name==='string'&&/^preparation:[a-f0-9-]{36}:(conditions|inputs|observations|criteria)$/.test(name);
export function preparationDocument(document,reference){return new RecordDocument(document.blocks,reference);}
export async function preparationHeader(document,reference,{signal}={}){
 const value={};for(const name of preparationHeaderFields){signal?.throwIfAborted();const field=await document.tree.selected(reference,[name]);if(field.found)value[name]=field.value;}return value;
}
export async function preparationPage(document,reference,collection,{offset=0,limit=4,signal}={}){
 if(!preparationCollections.includes(collection)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)invalid();
 signal?.throwIfAborted();const source=preparationDocument(document,reference),total=await source.tree.arrayLength(reference,[collection]);offset=Math.min(offset,Math.max(0,total-1));const items=[];
 for await(const row of source.items([collection],{offset,limit,signal}))items.push({position:row.index,revision:row.value,value:await source.tree.read(row.value)});
 return {offset,total,next:offset+items.length<total?offset+items.length:null,items};
}
export async function preparationProjection(document,reference,{windows={},signal,criterionIds=[]}={}){
 const value=await preparationHeader(document,reference,{signal}),pages={};
 for(const collection of preparationCollections){const name=preparationWindowName(value.id,collection),page=await preparationPage(document,reference,collection,{offset:windows[name]??0,signal});value[collection]=page.items.map(row=>row.value);pages[name]={offset:page.offset,total:page.total,count:page.items.length};}
 // Visible assessments need their exact criterion even when its ordinary page
 // is elsewhere. Their bounded context is not a replacement collection.
 for(const id of criterionIds)if(!value.criteria.some(row=>row.id===id)){
  const row=await preparationRowById(document,reference,'criteria',id,{signal});if(!row)throw new AppError('CATALOGUE_DAMAGED');value.criteria.push(row.value);
 }
 return {value,pages};
}
export async function preparationRowById(document,reference,collection,id,{signal}={}){
 const index=await RecordAttemptIndex.open(document,{signal});if(index?.value.version>=3){const preparationId=(await document.tree.selected(reference,['id'])).value,found=await index.nested(preparationId,collection,id);return found?{position:found.position,revision:found.reference,value:await document.tree.read(found.reference)}:null;}
 const source=preparationDocument(document,reference);
 for await(const row of source.items([collection],{signal}))if((await source.tree.selected(row.value,['id'])).value===id)return {position:row.index,revision:row.value,value:await source.tree.read(row.value)};
 return null;
}
export async function validatePreparationDocument(document,reference,{draft=false,signal,identities=null,prefix=''}={}){
 const names=await document.tree.propertyNames(reference);if(names.sort().join()!==[...preparationHeaderFields,...preparationCollections].sort().join())invalid();
 const header=await preparationHeader(document,reference,{signal});if(!validPreparationHeader(header,{draft}))invalid();
 const check=async ids=>{const source=preparationDocument(document,reference);for(const collection of preparationCollections)for await(const row of source.items([collection],{signal})){
  const value=await source.tree.read(row.value);if(!validPreparationRow(collection,value,{draft})||!await ids.add(prefix+collection+':'+value.id,{position:row.index}))invalid();
 }return header;};return identities?check(identities):withScratch(check,{signal});
}
export async function* preparationReferences(document,reference,{signal}={}){
 const header=await preparationHeader(document,reference,{signal});if(header.basedOn)yield header.basedOn;yield* header.protocols;
 const source=preparationDocument(document,reference);for(const collection of ['conditions','inputs'])for await(const row of source.items([collection],{signal})){const ref=(await source.tree.selected(row.value,['reference'])).value;if(ref)yield ref;}
}
export async function* preparationSearchParts(document,reference,{signal}={}){
 const header=await preparationHeader(document,reference,{signal});yield header.applicability;yield header.reason;
 const source=preparationDocument(document,reference),blank={...header,conditions:[],inputs:[],observations:[],criteria:[],applicability:'',reason:''};
 for(const collection of preparationCollections)for await(const row of source.items([collection],{signal}))yield* attemptFactSearchParts('preparation',{...blank,[collection]:[await source.tree.read(row.value)]}).slice(2);
}
export async function preparationValueRevision(document,reference,{signal}={}){
 const hash=createHash('sha256');for await(const part of document.tree.json(reference,{canonical:true,signal}))hash.update(part);return hash.digest('hex');
}
