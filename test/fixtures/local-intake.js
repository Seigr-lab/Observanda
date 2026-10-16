import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from '../browser/encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {recordRevision} from '../../src/research.js';
import {workspaceJobs} from '../../src/workspace-jobs.js';
import {LocalIntake} from '../../src/intake/service.js';
import {INTAKE_MANIFEST} from '../../src/intake/contract.js';
import {RecordWriting} from '../../src/record-writing.js';
import {ResearchMaterials} from '../../src/research-materials.js';
export const hash=v=>createHash('sha256').update(v).digest('hex');
export async function intakeFixture(t,{large=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-')),source=path.join(directory,'source');await mkdir(source);
 const book=sampleNotebook();for(const e of book.entries){e.attachments=[];e.figures=[];e.share=false;}
 if(large)book.entries[0].sections=Array.from({length:73},(_,i)=>({id:randomUUID(),title:'Retained section '+i,body:'exact'.repeat(5600)}));
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(path.join(directory,'workspace'),book),record=(await ws.read()).book.entries[0];
 if(large){const writing=new RecordWriting(ws),target={workspaceId:book.id,recordId:record.id,sectionId:null},base=await writing.read(target);record.body='Extended source observations. '.repeat(1900);await writing.save({...target,expectedRevision:base.revision,value:{body:record.body}});}
 const services=workspaceJobs(ws);services.worker.enabled=true;
 t.after(async()=>{await services.worker.stop();clearVault(vault);await rm(directory,{recursive:true,force:true});});
 const file={id:randomUUID(),path:'capture.bin',size:21,sha256:hash('PRIVATE native source'),provenance:'Independent acquired source'};await writeFile(path.join(source,file.path),'PRIVATE native source');
 const manifest={version:1,id:randomUUID(),workspaceId:book.id,recordId:record.id,expectedRevision:recordRevision(record),title:'Next run evidence',purpose:'evidence',files:[file],analyses:[{id:randomUUID(),expectedRevision:null,title:'External decoding',tool:'Independent decoder',version:'1.0',toolSha256:hash('source of decoder'),parameters:'base=6',inputs:[{file:file.id}],outputs:[]}],source:{revision:'private-source-v1',sha256:hash('private source revision')},verification:{tool:'external-validator',version:'1',sha256:hash('validator source'),statement:'Structure checked; physical meaning not verified'}};
 if(large)manifest.expectedRevision=(await new ResearchMaterials(ws).recordSummary(record.id)).revision;
 const write=()=>writeFile(path.join(source,INTAKE_MANIFEST),JSON.stringify(manifest));await write();
 const service=new LocalIntake(ws,services.queue),command={workspaceId:book.id,recordId:record.id,id:manifest.id,source};
 return {directory,source,ws,vault,deviceStore,book,record,manifest,write,service,command,...services};
}
