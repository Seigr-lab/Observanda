import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {libraryQuery} from './website-file-library-query.js';

const fields=['search','searchField','filter','dateFrom','dateTo','dateKnowledge','recordType','status','tagMode','sort','projectId','notebookId','tags'];
function definition(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new AppError('INVALID');
 libraryQuery(value);
 return {...value,search:value.search?.trim()??'',tags:[...new Set(value.tags??[])]};
}

// An explicit author preference, sealed with the site owner's workspace key.
// The publication manifest never lists this file. Store criteria only, so
// recalling a search resolves against the current grants and current entries.
export async function savedWebsiteSearches(store,operation,{siteId,name='',criteria,id,revision,after='',query='',signal}={}){
 if(!researchId(siteId)||!['list','save','remove'].includes(operation))throw new AppError('INVALID');
 return store.scope(async()=>{
  await store.siteVersion(siteId,{signal});
  const file='.observanda/website-files/sites/'+siteId+'/saved-searches.json';
  const entries=(await store.control(file,{missing:true}))??[];
  if(!Array.isArray(entries))throw new AppError('FORMAT');
  if(operation==='list'){
   if(typeof after!=='string'||typeof query!=='string'||query.length>160)throw new AppError('INVALID');
   const needle=query.trim().normalize('NFC').toLowerCase();
   const rows=entries.filter(entry=>entry.key>after&&entry.key.includes(needle)).sort((a,b)=>a.key<b.key?-1:1).slice(0,13);
   const items=rows.slice(0,12);return {items,next:rows.length>12?items.at(-1).key:null};
  }
  if(!researchId(id)||revision!=null&&!researchId(revision))throw new AppError('INVALID');
  const index=entries.findIndex(entry=>entry.id===id),current=entries[index];
  if(operation==='remove'){
   if(!current||current.revision!==revision)throw new AppError('CONFLICT');
   entries.splice(index,1);
  }else{
   if(typeof name!=='string'||!name.trim()||name.length>120||/[\u0000-\u001f]/u.test(name))throw new AppError('INVALID');
   name=name.trim().normalize('NFC');const key=name.toLowerCase(),normalized=definition(criteria);
   if(current?.name===name&&JSON.stringify(current.criteria)===JSON.stringify(normalized))return current;
   if((current?.revision??null)!==(revision??null)||entries.some(entry=>entry.key===key&&entry.id!==id))throw new AppError('CONFLICT');
   const value={id,revision:randomUUID(),name,key,criteria:normalized};
   if(current)entries[index]=value;else entries.push(value);
   const body=Buffer.from(JSON.stringify(entries));
   if(body.length>32*1024*1024)throw new AppError('LIMIT');
   await store.writeBytes(file,body,{signal});return value;
  }
  await store.writeControl(file,entries,{signal});return {removed:true};
 },{write:operation!=='list',signal});
}
