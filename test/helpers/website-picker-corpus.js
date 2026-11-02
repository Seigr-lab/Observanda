import os from 'node:os';
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {convertPublicationRecord} from '../../src/publication-conversion-render.js';
import {sampleNotebook} from '../../src/sample.js';

// Native website-editor acceptance data. Use a disposable, unlocked vault
// with an empty source library. Each record passes the normal publication
// projection and is written through the normal fenced file owner.
export async function seedWebsitePickerCorpus(store,{count=3000,onProgress,signal}={}){
 if(!(store instanceof WebsiteFileStore)||!Number.isInteger(count)||count<1||count>3000)throw new TypeError('Invalid picker fixture');
 const relative=path.relative(await realpath(os.tmpdir()),await realpath(store.workspace.root));
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Temporary fixture required');
 const projects=['Coastal ecology','Freshwater monitoring','Forest phenology'].map(title=>({id:randomUUID(),title,share:true}));
 const books=projects.flatMap(project=>['Field observations','Instrument surveys'].map(title=>({id:randomUUID(),projectId:project.id,title,share:true})));
 const metadata={id:store.workspace.vault.id,projects,notebooks:books},example=sampleNotebook().entries[1],examples=[];
 await store.scope(async()=>{
  if((await store.names('.observanda/website-files/sources',{limit:1})).items.length)throw new Error('Empty source library required');
 },{write:true,signal});
 for(let start=0;start<count;start+=24){
  await store.scope(async()=>{
   for(let index=start;index<Math.min(count,start+24);index++){
    signal?.throwIfAborted();const book=books[index%books.length],project=projects.find(p=>p.id===book.projectId);
    const title=index<books.length?'Transect observation':('Survey station '+String(index+1).padStart(4,'0'));
    const section={id:randomUUID(),title:'Sampling method',body:'At station '+(index+1)+', the observer compared the shaded and exposed sampling plots.',share:true};
    const record={...example,id:randomUUID(),notebookId:book.id,title,share:true,body:'Field measurements from sampling station '+(index+1)+'.',sections:[section],attachments:[],figures:[],relations:[],contributors:[],tags:[]};
    delete record.results;delete record.publication;delete record.attempt;delete record.template;
    const provenance={workspaceId:metadata.id,projectId:project.id,notebookId:book.id,recordId:record.id},sourceId=websiteSourceId(provenance);
    const converted=await convertPublicationRecord(store.workspace,metadata,record);
    if(!converted.visible||!converted.html.includes(section.id))throw new Error('Permitted section missing');
    const token=await store.beginSourceUpdate({sourceId,target:'website',ifAbsent:true,signal});
    const saved=await store.putSource({sourceId,provenance,title,pickerContext:{projectTitle:project.title,notebookTitle:book.title},...converted,signal},{token});
    if(index<books.length)examples.push({...saved,...provenance,sectionId:section.id,sectionTitle:section.title});
   }
  },{write:true,signal});
  await onProgress?.(Math.min(count,start+24),count);
 }
 return {count,projects,books,examples};
}
