import {catalogueRequiresConfigurationDocuments,restoreConfigurationCatalogueFormat,catalogueRequiresRecordOwnerTransfers,restoreRecordOwnerTransferCatalogueFormat,catalogueRequiresPublicationDocuments,restorePublicationCatalogueFormat} from './catalogue-format.js';
import {databaseSchemaSession} from './database-schema-session.js';
import {moduleDomains} from './modules/domains.js';
import {projectDomainSchema,projectDomainSchemas,projectDomainTables,createProjectDomainSchema} from './project-domain-schema.js';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {encrypted} from './encryption.js';
import {cataloguePayloadRows} from './catalogue-payload-rows.js';
import {catalogueFormat,catalogueRequiresDomains,requireRecordBlocks,requireRecordQueryBlocks,requireMemberCollections,requireSelectedValueDrafts,requireRetainedRecordDocuments,requireRunReceiptStore,requireDraftEdits,requireAttemptIndexes,requireCurrentAttemptIndexes,requireRecordTypeDrafts,requireRecordMethodIndexes,requireFigureCopyDrafts,requireSearchVocabulary,requireJoinedQueryText,requireKeyedQueryArrays,requireReferenceQueries,requireAttemptQueries,requireStarterDocuments,requireProjectDomains,requireRetiredProjectRecords,requireWorkspaceDomains,requireWorkspaceSettings,requireRecordResultIndexes,requireWebsiteDocuments,requireStagedEvidence,requireWebsiteEditor,requireWebsitePresentation} from './catalogue-format.js';
import {operationStage,operationAdvance,operationWork,operationTotal} from './operation-progress.js';
const CHUNK=1024*1024,MAX_LINE=32*1024*1024;
// Includes the JSON-escaped envelope around any admitted 64 MiB module or
// checkpoint. A corrupt declaration must not allocate an arbitrary buffer.
const MAX_PAYLOAD=256*1024*1024;
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===names;
const hash=value=>createHash('sha256').update(value).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function* lines(stream,{countBytes=true}={}){
 let parts=[],length=0;
 try{for await(const chunk of stream){
  let offset=0;
  while(offset<chunk.length){
   const end=chunk.indexOf(10,offset),part=chunk.subarray(offset,end<0?chunk.length:end);
   length+=part.length;if(length>MAX_LINE)fail();parts.push(part);
   if(end<0)break;
   yield Buffer.concat(parts,length).toString('utf8');parts=[];length=0;offset=end+1;
  }
  if(countBytes)operationAdvance(chunk.length);operationWork({bytes:chunk.length});
 }if(length)fail();}finally{stream.destroy();}
}
export async function writeCatalogueArchive(db,handle,tables,{observe=true,stage='archive',tableStage='archive-table'}={}){
 const scoped=observe?operationStage:(_stage,_options,run)=>run();
 return scoped(stage,{unit:'rows'},async()=>{
 const format=await catalogueFormat(db),domains=await projectDomainSchemas(db),session=databaseSchemaSession(db);
 if(catalogueRequiresDomains(format)&&!domains.length||(format<22||[26,29,32,35,38,41,44,47].includes(format)||(catalogueRequiresConfigurationDocuments(format)||catalogueRequiresRecordOwnerTransfers(format)||catalogueRequiresPublicationDocuments(format))&&!catalogueRequiresDomains(format))&&domains.length)fail();
 try{
 await handle.writeFile(JSON.stringify({format:'observanda-postgresql-archive',version:catalogueRequiresConfigurationDocuments(format)?15:catalogueRequiresRecordOwnerTransfers(format)?14:catalogueRequiresPublicationDocuments(format)?13:format>=44?12:format>=38?11:format>=32?10:format>=29?9:format>=26?8:format>=25?7:format>=24?6:format>=23?5:format>=22?4:format>=4?3:2,...(format>=4?{catalogueVersion:format}:{}),...(format>=22?{domains}:{})})+'\n');
 let rows=0,parts=[],buffered=0;const digest=createHash('sha256');
 const flush=async()=>{if(parts.length)await handle.writeFile(parts.join(''));parts=[];buffered=0;};
 const write=async value=>{
  const line=JSON.stringify(value)+'\n',size=Buffer.byteLength(line);digest.update(line);
  if(buffered+size>256*1024)await flush();
  if(size>256*1024)await handle.writeFile(line);else{parts.push(line);buffered+=size;}
 };
 for(const domain of [null,...domains]){
 const selected=session.schema(domain?projectDomainSchema(db.id,domain):db.schema);
 for(const [table,columns] of Object.entries(domain?projectDomainTables:tables)){
  await scoped(tableStage,{unit:'rows',item:table},async()=>{
  const before=rows;
  // The footer verifies the measured count; a preliminary count would scan
  // large tables twice and can time out before transport even starts.
  // One database payload, one transport chunk. The archive never materializes
  // a base64 string or cursor batch containing several large stored objects.
  for await(const row of cataloguePayloadRows(selected,table,columns)){
   const payload=row.payload;if(!Buffer.isBuffer(payload)||!encrypted(payload))fail();
   if(payload.length>MAX_PAYLOAD)throw new AppError('LIMIT');
   await write({...(domain?{domain}:{}),table,values:columns.slice(0,-1).map(name=>row[name]),bytes:payload.length,sha256:hash(payload)});
   for(let offset=0;offset<payload.length;offset+=CHUNK)await write({chunk:payload.subarray(offset,offset+CHUNK).toString('base64')});
   await write({rowEnd:true});rows++;if(observe){operationAdvance();operationWork({objects:1,bytes:payload.length});}
  }
  if(observe)operationTotal(rows-before);
  });
 }
 }
 await flush();await handle.writeFile(JSON.stringify({end:true,rows,digest:digest.digest('hex')})+'\n');
 }finally{session.close();await db.run('SET LOCAL search_path TO "'+db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
 });
}
export async function readCatalogueArchive(file,db,tables){
 const archiveSize=(await stat(file)).size;
 return readCatalogueStream(createReadStream(file,{highWaterMark:64*1024}),db,tables,{archiveSize});
}
export async function readCatalogueStream(stream,db,tables,{archiveSize,totalRows}={}){
 const direct=archiveSize===undefined;
 return operationStage(direct?'transfer-database':'read-archive',{total:direct?totalRows:archiveSize,unit:direct?'rows':'bytes'},async()=>{
 let version=null,finished=false,count=0,pending=null,batchTable=null,batchDomain=null,batch=[],batchBytes=0,domains=[];const session=databaseSchemaSession(db);
 const selected=domain=>session.schema(domain?projectDomainSchema(db.id,domain):db.schema),columnsFor=(domain,table)=>(domain?projectDomainTables:tables)[table];const digest=createHash('sha256');
 const flush=async()=>{
  if(!batch.length)return;const columns=columnsFor(batchDomain,batchTable),values=batch.flat();
  const tuples=batch.map((_,i)=>'('+columns.map((_,n)=>'$'+(i*columns.length+n+1)).join(',')+')');
  await selected(batchDomain).run('INSERT INTO '+batchTable+' ('+columns.join(',')+') VALUES '+tuples.join(','),...values);if(direct)operationAdvance(batch.length);operationWork({objects:batch.length});batch=[];batchBytes=0;
 };
 const insert=async(domain,table,values)=>{
  if(!encrypted(values.at(-1))||values.slice(0,-1).some(v=>!['string','number'].includes(typeof v)))fail();
  const bytes=values.at(-1).length;
  if(batch.length&&(batchDomain!==domain||batchTable!==table||batch.length===32||batchBytes+bytes>256*1024))await flush();
  batchDomain=domain;batchTable=table;batch.push(values);batchBytes+=bytes;count++;
  if(bytes>256*1024)await flush();
 };
 try{
 for await(const line of lines(stream,{countBytes:!direct})){
  if(finished)fail();let value;try{value=JSON.parse(line);}catch{fail();}
  if(version===null){
   if(value?.format!=='observanda-postgresql-archive'||![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].includes(value.version))fail();
   if(value.version>=3){if(value.version>=4){
    if(!keys(value,'catalogueVersion,domains,format,version')||(value.version===15?!catalogueRequiresConfigurationDocuments(value.catalogueVersion):value.version===14?(!catalogueRequiresRecordOwnerTransfers(value.catalogueVersion)||catalogueRequiresConfigurationDocuments(value.catalogueVersion)):value.version===13?(!catalogueRequiresPublicationDocuments(value.catalogueVersion)||catalogueRequiresRecordOwnerTransfers(value.catalogueVersion)||catalogueRequiresConfigurationDocuments(value.catalogueVersion)):value.version===12?![44,45,46,47,48,49].includes(value.catalogueVersion):value.version===11?![38,39,40,41,42,43].includes(value.catalogueVersion):value.version===10?![32,33,34,35,36,37].includes(value.catalogueVersion):value.version===9?![29,30,31].includes(value.catalogueVersion):value.version===8?![26,27,28].includes(value.catalogueVersion):value.catalogueVersion!==({4:22,5:23,6:24,7:25}[value.version]))||!Array.isArray(value.domains)||catalogueRequiresDomains(value.catalogueVersion)&&!value.domains.length||([26,29,32,35,38,41,44,47].includes(value.catalogueVersion)||(catalogueRequiresConfigurationDocuments(value.catalogueVersion)||catalogueRequiresRecordOwnerTransfers(value.catalogueVersion)||catalogueRequiresPublicationDocuments(value.catalogueVersion))&&!catalogueRequiresDomains(value.catalogueVersion))&&value.domains.length||new Set(value.domains).size!==value.domains.length||!value.domains.every(domain=>moduleDomains.includes(domain))||[...value.domains].sort().join()!==value.domains.join())fail();
    domains=value.domains;for(const domain of domains)await createProjectDomainSchema(selected(domain));
   }else if(!keys(value,'catalogueVersion,format,version')||![4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].includes(value.catalogueVersion))fail();if(catalogueRequiresConfigurationDocuments(value.catalogueVersion))await restoreConfigurationCatalogueFormat(selected(null),value.catalogueVersion);else if(catalogueRequiresRecordOwnerTransfers(value.catalogueVersion))await restoreRecordOwnerTransferCatalogueFormat(selected(null),value.catalogueVersion);else if(catalogueRequiresPublicationDocuments(value.catalogueVersion))await restorePublicationCatalogueFormat(selected(null),value.catalogueVersion);else await ({4:requireRecordBlocks,5:requireRecordQueryBlocks,6:requireMemberCollections,7:requireSelectedValueDrafts,8:requireRetainedRecordDocuments,9:requireRunReceiptStore,10:requireDraftEdits,11:requireAttemptIndexes,12:requireCurrentAttemptIndexes,13:requireRecordTypeDrafts,14:requireRecordMethodIndexes,15:requireFigureCopyDrafts,16:requireSearchVocabulary,17:requireJoinedQueryText,18:requireKeyedQueryArrays,19:requireReferenceQueries,20:requireAttemptQueries,21:requireStarterDocuments,22:requireProjectDomains,23:requireRetiredProjectRecords,24:requireWorkspaceDomains,25:requireWorkspaceSettings,26:requireRecordResultIndexes,27:async db=>{await requireWorkspaceDomains(db);await requireRecordResultIndexes(db);},28:async db=>{await requireWorkspaceSettings(db);await requireRecordResultIndexes(db);},29:requireWebsiteDocuments,30:async db=>{await requireWorkspaceDomains(db);await requireWebsiteDocuments(db);},31:async db=>{await requireWorkspaceSettings(db);await requireWebsiteDocuments(db);},32:requireStagedEvidence,33:async db=>{await requireWorkspaceDomains(db);await requireStagedEvidence(db);},34:async db=>{await requireWorkspaceSettings(db);await requireStagedEvidence(db);},35:async db=>{await requireWebsiteDocuments(db);await requireStagedEvidence(db);},36:async db=>{await requireWorkspaceDomains(db);await requireWebsiteDocuments(db);await requireStagedEvidence(db);},37:async db=>{await requireWorkspaceSettings(db);await requireWebsiteDocuments(db);await requireStagedEvidence(db);},38:requireWebsiteEditor,39:async db=>{await requireWorkspaceDomains(db);await requireWebsiteEditor(db);},40:async db=>{await requireWorkspaceSettings(db);await requireWebsiteEditor(db);},41:async db=>{await requireStagedEvidence(db);await requireWebsiteEditor(db);},42:async db=>{await requireWorkspaceDomains(db);await requireStagedEvidence(db);await requireWebsiteEditor(db);},43:async db=>{await requireWorkspaceSettings(db);await requireStagedEvidence(db);await requireWebsiteEditor(db);},44:requireWebsitePresentation,45:async db=>{await requireWorkspaceDomains(db);await requireWebsitePresentation(db);},46:async db=>{await requireWorkspaceSettings(db);await requireWebsitePresentation(db);},47:async db=>{await requireStagedEvidence(db);await requireWebsitePresentation(db);},48:async db=>{await requireWorkspaceDomains(db);await requireStagedEvidence(db);await requireWebsitePresentation(db);},49:async db=>{await requireWorkspaceSettings(db);await requireStagedEvidence(db);await requireWebsitePresentation(db);}}[value.catalogueVersion])(selected(null));}
   else if(!keys(value,'format,version'))fail();
   version=value.version;continue;
  }
  if(value?.end===true){if(pending||!keys(value,'digest,end,rows')||value.rows!==count||value.digest!==digest.digest('hex'))fail();finished=true;continue;}
  if(version===1){
   if(!keys(value,'table,values')||!Object.hasOwn(tables,value.table))fail();const columns=tables[value.table];
   if(!Array.isArray(value.values)||value.values.length!==columns.length)fail();
   const values=value.values.slice(),encoded=values.at(-1);
   if(typeof encoded!=='string'||Buffer.from(encoded,'base64').toString('base64')!==encoded)fail();
   values[values.length-1]=Buffer.from(encoded,'base64');await insert(null,value.table,values);
  }else if(pending){
   if(value?.rowEnd===true){
    if(!keys(value,'rowEnd')||pending.offset!==pending.bytes||pending.hash.digest('hex')!==pending.sha256)fail();
    await insert(pending.domain??null,pending.table,[...pending.values,pending.payload]);pending=null;
   }else{
    if(!keys(value,'chunk')||typeof value.chunk!=='string'||value.chunk.length>Math.ceil(CHUNK/3)*4)fail();
    const chunk=Buffer.from(value.chunk,'base64');
    if(chunk.toString('base64')!==value.chunk||chunk.length!==Math.min(CHUNK,pending.bytes-pending.offset)||!chunk.length)fail();
    chunk.copy(pending.payload,pending.offset);pending.offset+=chunk.length;pending.hash.update(chunk);
   }
  }else{
   const domain=value?.domain??null;
   if(domain!==null&&(version<4||!domains.includes(domain)))fail();
   if(!keys(value,domain?'bytes,domain,sha256,table,values':'bytes,sha256,table,values')||!Object.hasOwn(domain?projectDomainTables:tables,value.table)||!Array.isArray(value.values)||value.values.length!==columnsFor(domain,value.table).length-1||
    value.values.some(v=>!['string','number'].includes(typeof v))||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>MAX_PAYLOAD||archiveSize!==undefined&&value.bytes>archiveSize||!validHash(value.sha256))fail();
   pending={...value,payload:Buffer.allocUnsafe(value.bytes),offset:0,hash:createHash('sha256')};
  }
  digest.update(line+'\n');
 }
 if(!finished||!count||totalRows!==undefined&&count!==totalRows)fail();await flush();if(!(await selected(null).get("SELECT 1 FROM state WHERE slot='head'")))fail();
 if(direct)operationTotal(count);
 }finally{session.close();await db.run('SET LOCAL search_path TO "'+db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
 });
}
