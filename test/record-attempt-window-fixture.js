import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {preparation,event,assessment} from './fixtures/attempts.js';
export async function attemptWindowFixture({preparationCount=9,eventCount=15,assessmentCount=15}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-attempt-window-')),book=sampleNotebook(),record=book.entries[0];record.status='draft';
 const preparations=[];for(let i=0;i<preparationCount;i++){const p=preparation();p.applicability='Preparation window '+i;if(i){p.supersedes=preparations.at(-1).id;p.reason='Revised configuration '+i;}preparations.push(p);}
 const events=Array.from({length:eventCount-1},(_,i)=>event(preparations.at(-1),{label:'Acquisition '+i,circumstances:'Captured window '+i}));events.push({...events[0],id:randomUUID(),supersedes:events[0].id,reason:'Later receipt review',label:'Corrected acquisition zero'});
 const assessments=Array.from({length:assessmentCount-1},(_,i)=>assessment(preparations.at(-3),i%2,{observed:'Assessment window '+i}));assessments.push({...assessments[0],id:randomUUID(),supersedes:assessments[0].id,reason:'Later assessment',observed:'Corrected assessment zero'});
 record.attempt={version:1,preparations,events,assessments};
 const f=await encryptedFixture(directory,book),saved=await f.workspace.read();
 return {...f,directory,book:saved.book,record:saved.book.entries.find(r=>r.id===record.id),async close(){clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
