import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {selectionBook} from './publication-selection-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {PublicationJobs} from '../src/publication-jobs.js';

export async function historicalFixture(t,{chain=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-historical-publication-')),data=selectionBook(),{book}=data,[run,method]=book.entries;
 for(const record of book.entries){record.sections=[];record.body='Public writing';delete record.template;record.figures=[];}
 method.title='Retained method';method.body='Exact older procedure';method.sections=[{id:randomUUID(),title:'Withheld instructions',body:'HISTORICAL_PRIVATE_INSTRUCTIONS'}];
 const linked=chain?structuredClone(book.entries[2]):null;
 if(linked){linked.title='Earlier result';linked.body='Retained precursor result';linked.sections=[];method.relations=[{id:randomUUID(),type:'Prior result',target:{workspaceId:book.id,kind:'record',id:linked.id,revision:recordRevision(linked)},label:'PRIVATE_PRECURSOR_LABEL'}];}
 const old=structuredClone(method),revision=recordRevision(old),target={workspaceId:book.id,kind:'record',id:method.id,revision};
 run.relations=[{id:randomUUID(),type:'Method used',target,label:'PRIVATE_REFERENCE_LABEL'}];method.title='Current method';method.body='New procedure';method.sections=[];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(()=>new ResearchMaterials(f.workspace).retainRecord(old));
 if(linked)await f.workspace.withLock(()=>new ResearchMaterials(f.workspace).retainRecord(linked));
 return {...f,book,run,method,old,target,linked,source:{workspaceId:book.id,etag:(await f.workspace.outline()).etag},releases:new PublicationJobs(f.workspace)};
}
