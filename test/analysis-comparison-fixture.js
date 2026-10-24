import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankAnalysisMethod,blankAnalysisSource} from '../src/web/analysis-model.js';
import {clearVault} from '../src/encryption.js';

export async function comparisonFixture(t,{groups=25,rowsPerGroup=3,repeatValues=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-comparison-capacity-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const csv='Reading,State,Condition\n'+Array.from({length:groups*rowsPerGroup},(_,i)=>String(9007199254740993n+BigInt(repeatValues?i%3:i))+','+(i%3===1?'mismatched':'correct')+',Group '+Math.floor(i/rowsPerGroup)).join('\n'),bytes=Buffer.from(csv),upload=await m.startImport({recordId,name:'readings.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id);
 const columns=['Reading','State','Condition'].map(label=>defaultColumn({label}));columns[0].representation='integer';
 const dataset=await m.dataset({recordId,title:'Exact source readings',artifact,columns}),source=blankAnalysisSource(dataset);Object.assign(source.columns,{value:0,status:1,condition:2});
 const command={recordId,title:'Retained state comparison',tool:'Synthetic exact qualification',version:'1',method:{...blankAnalysisMethod(),unavailable:'Synthetic fixtures have no external tool identity.',uncertainty:'Unknown instrument uncertainty.',limitations:'Tests only; no scientific inference.'},comparison:{version:1,sources:[source],ordering:'source',expected:null}};
 return {...f,directory,book,m,recordId,dataset,artifact,command};
}
