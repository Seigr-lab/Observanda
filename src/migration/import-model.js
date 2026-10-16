import {AppError} from '../errors.js';
import {digest} from '../storage-format.js';
import {revisionText} from '../web/revision-model.js';
import {researchId} from '../web/research-reference.js';
import {RECORD_TYPES} from '../web/record-types.js';
import {validRecordDate} from '../web/record-date.js';
import {WORKFLOW_ROLES} from '../web/record-workflow.js';
import {datasetMapping} from '../dataset-reader.js';
import {validColumns} from '../research-materials.js';
import {validNativeMapping} from '../native-mapping.js';
import {validResearchMapping,mergeImportedAttempt} from './import-research-mapping.js';

export const importHash=value=>digest(revisionText(value));
export const identityKey=(namespace,id)=>importHash([namespace,id]);
export const revisionKey=(namespace,id,revision)=>importHash([namespace,id,revision]);
export const sourceFingerprint=(source,attributesText)=>{
 const {status,issues,attributes,...declaration}=source;void status;void issues;void attributes;
 return importHash({...declaration,files:source.files.map(({verification,...file})=>{void verification;return file;}),attributesText});
};
export const hashValue=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const importId=researchId;
export function mappedId(...parts){
 const hex=importHash(parts).split('');hex[12]='4';hex[16]='8';const h=hex.join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);
}
export const defaultTypes=Object.freeze({record:'note',concept:'concept',chapter:'note',method:'protocol',investigation:'experiment',run:'run',decision:'decision',comparison:'analysis',artifact:'reference',dataset:'dataset',analysis:'analysis',figure:'analysis',preparation:'note',assessment:'analysis'});
export function initialMapping(object,notebookId,{multiple=false}={}){
 const file=object.files[0],occurrences=object.dates.map((d,i)=>({d,i})).filter(({d})=>d.meaning==='occurrence');
 return {disposition:object.disposition==='exclude'?'exclude':'import',reason:object.reason??'',notebookId,type:defaultTypes[object.mapping?.kind]??'note',
  title:object.title,current:!multiple,contentFile:0,contentMode:object.mapping?.kind==='artifact'?'original':file.selector.kind==='json-pointer'?'json':file.selector.kind==='anchor'?'html':'text',
  occurrence:occurrences.length===1?occurrences[0].i:-1,contributors:[],links:object.links.map(()=>({mode:'exact',role:'',reason:''})),resolution:'merge',acknowledgeConversion:false,dataset:null,metadataMode:'provenance',research:null};
}
const string=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function validateMapping(mapping,object){
 const expected=Object.keys(initialMapping(object,'')).filter(key=>!['metadataMode','research'].includes(key)||Object.hasOwn(mapping??{},key)).sort();
 if(!mapping||Object.keys(mapping).sort().join()!==expected.join()||!['import','exclude'].includes(mapping.disposition)||!string(mapping.reason,2000)||mapping.disposition==='exclude'&&!mapping.reason.trim()||
  !researchId(mapping.notebookId)||!RECORD_TYPES.some(t=>t.id===mapping.type)||!string(mapping.title,180)||!mapping.title.trim()||typeof mapping.current!=='boolean'||
  !Number.isInteger(mapping.contentFile)||mapping.contentFile<0||mapping.contentFile>=object.files.length||!['original','text','json','html','html-book','dataset','figure'].includes(mapping.contentMode)||
  !Number.isInteger(mapping.occurrence)||mapping.occurrence< -1||mapping.occurrence>=object.dates.length||
  !Array.isArray(mapping.contributors)||mapping.contributors.length>100||mapping.contributors.some(c=>!c||Object.keys(c).sort().join()!=='name,role'||!string(c.name,160)||!c.name.trim()||!string(c.role,160))||
  !Array.isArray(mapping.links)||mapping.links.length!==object.links.length||mapping.links.some(l=>!l||Object.keys(l).sort().join()!=='mode,reason,role'||!['exact','current','omit'].includes(l.mode)||!string(l.reason,2000)||l.mode==='omit'&&!l.reason.trim()||!['',...WORKFLOW_ROLES.map(r=>r.id)].includes(l.role)||l.role==='run-of'&&l.mode!=='current'||l.role&&l.role!=='run-of'&&l.mode!=='exact')||
  !['merge','source','local'].includes(mapping.resolution)||typeof mapping.acknowledgeConversion!=='boolean'||mapping.metadataMode!==undefined&&!['provenance','section'].includes(mapping.metadataMode))throw new AppError('IMPORT_MAPPING');
 if(mapping.contentMode==='original'&&object.mapping?.kind!=='artifact'&&mapping.disposition!=='exclude')throw new AppError('IMPORT_MAPPING');
 if(mapping.research!==undefined&&!validResearchMapping(mapping.research))throw new AppError('IMPORT_RESEARCH');
 if(mapping.dataset!==null){
  if(!mapping.dataset||!Object.keys(mapping.dataset).every(k=>['columns','sourceMapping','nativeMapping'].includes(k))||mapping.dataset.columns!==null&&(!Array.isArray(mapping.dataset.columns)||!validColumns(mapping.dataset.columns,mapping.dataset.columns.length)))throw new AppError('IMPORT_MAPPING');
  if(mapping.dataset.nativeMapping){const {file,...native}=mapping.dataset.nativeMapping;if(Object.hasOwn(native,'artifact')||!Number.isInteger(file)||file<0||file>=object.files.length||!validNativeMapping({...native,artifact:{kind:'artifact',id:mapping.notebookId,revision:'0'.repeat(64)}}))throw new AppError('IMPORT_MAPPING');}
  datasetMapping(mapping.dataset.sourceMapping);
 }
 if(mapping.contentMode==='dataset'){
  const file=object.files[mapping.contentFile],source=mapping.dataset?.sourceMapping;
  if(!source||file.selector.kind==='anchor'||file.selector.kind==='bytes'||file.selector.kind==='json-pointer'&&(source.format!=='json'||source.rowsPath!==file.selector.value))throw new AppError('IMPORT_MAPPING');
 }
 return mapping;
}
export function importOccurrence(object,mapping){
 const value=object.dates[mapping.occurrence]?.value;
 if(value===null||value===undefined)return {kind:'unknown'};
 for(const kind of ['day','month','year']){const date={kind,value,estimated:false};if(validRecordDate(date))return date;}
 throw new AppError('IMPORT_DATE');
}
export const importedFields=['notebookId','type','title','body','contributors','relations','tags','occurredOn','figures','status','sections','attachments','outcome','template','attempt','results'];
const equal=(a,b)=>revisionText(a??null)===revisionText(b??null);
// Conflicts concern authored fields, not storage timestamps. Publication is
// never enabled by importing; a previously published record becomes private.
export function mergeImport(base,current,incoming,resolution='merge'){
 if(!current)return {record:incoming,conflicts:[],changed:importedFields.filter(k=>incoming[k]!==undefined)};
 const record=structuredClone(current),conflicts=[],changed=[];
 for(const field of importedFields){
  if(equal(current[field],incoming[field]))continue;
  if(base&&equal(base[field],incoming[field]))continue;
  if(field==='attempt'){
   const merged=mergeImportedAttempt(base?.attempt,incoming.attempt,current.attempt);
   if(!merged){conflicts.push(field);continue;}
   if(!equal(merged,current.attempt)){record.attempt=structuredClone(merged);changed.push(field);}continue;
  }
  if(!base||!equal(current[field],base[field])){
   conflicts.push(field);if(resolution!=='source')continue;
  }
  if(incoming[field]===undefined)delete record[field];else record[field]=structuredClone(incoming[field]);changed.push(field);
 }
 record.share=false;
 return {record,conflicts,changed};
}
