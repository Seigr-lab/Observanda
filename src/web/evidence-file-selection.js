import {fingerprintFile} from './evidence-fingerprint.js';
import {compareEvidenceFiles,evidenceFileMetadata} from './evidence-files.js';
import {t} from './i18n/index.js';
const fail=()=>{throw Error(t('evidenceIntake','selectionUnavailable'));};
export async function createFileSelection(call,recordId,files,{signal,checking=()=>{},progress=()=>{}}={}){
 let source={recordId,selection:null,count:0,bytes:0},items=[];
 for(let i=0;i<files.length;i++){
  signal?.throwIfAborted();const file=files[i];checking(file,i);
  const fingerprint=await fingerprintFile(file,{signal,progress:n=>progress(n,file.size)});
  items.push({name:file.name,size:file.size,fingerprint,...(file.webkitRelativePath?{sourcePath:file.webkitRelativePath}:{})});
  if(items.length===64||i===files.length-1){
   const result=await call('intake-selection-append',{...source,offset:source.count,items},{signal,adopt:false});
   if(result.count!==source.count+items.length||result.bytes!==source.bytes+items.reduce((n,f)=>n+f.size,0))fail();
   source={recordId,...result};items=[];
  }
 }
 return source;
}
export async function* fileSelectionPages(call,source,{signal}={}){
 for(let offset=0;offset<source.count;){
  signal?.throwIfAborted();
  const page=await call('intake-selection-page',{...source,offset},{signal,adopt:false});
  if(page.count!==source.count||page.items.length!==Math.min(64,source.count-offset))fail();
  yield page.items;offset+=page.items.length;
 }
}
export async function* selectedFiles(call,source,files,options={}){
 for await(const items of fileSelectionPages(call,source,options)){
  for(const item of items){
   const file=files[item.ordinal];if(!file||file.name!==item.name||file.size!==item.size||(file.webkitRelativePath||undefined)!==item.sourcePath)fail();
   yield {...item,file};
  }
 }
}
export async function registerFileManifest(call,batch,source,{signal,checking=()=>{}}={}){
 if(source.count!==batch.count||source.bytes!==batch.bytes)throw Error(t('evidenceIntake','completeSet'));
 let at=0;
 for await(const items of fileSelectionPages(call,source,{signal})){
  let verified=0;
  // Existing receipts may end inside this 64-file selection page.
  while(at+verified<batch.registered&&verified<items.length){
   const saved=await call('intake-page',{id:batch.id,offset:at+verified,limit:Math.min(50,items.length-verified,batch.registered-at-verified)},{signal});
   if(!saved.items.length)fail();
   for(const item of saved.items)if(compareEvidenceFiles(items[verified++],item)!==0)throw Error(t('evidenceIntake','differentManifest'));
  }
  if(verified<items.length){
   checking();
   batch=await call('intake-append',{id:batch.id,offset:at+verified,items:items.slice(verified).map(evidenceFileMetadata)},{signal});
  }
  at+=items.length;
 }
 return batch;
}
