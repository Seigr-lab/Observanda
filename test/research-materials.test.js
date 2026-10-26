import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Workspace,digest,serialize} from '../src/storage.js';
import {createAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {ResearchMaterials,EVIDENCE_CHUNK,exactInteger} from '../src/research-materials.js';
import {recordRevision} from '../src/research.js';
import {createFigure} from '../src/web/figure-model.js';
import {researchReference,parseResearchReference} from '../src/web/research-reference.js';
import {verifyPublication,writePublication} from '../src/publication.js';
import {contentBuffer} from '../src/file-content.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {publicationDraftCommand} from './publication-fixture.js';
import {DATASET_ROWS_PER_PAGE} from '../src/dataset-row-position.js';

const column=(name,representation='text',extra={})=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''},...extra});
const mapping={x:0,xKind:'category',values:[{column:2,error:null}],group:1,operation:'mean',kind:'bar',order:'source',mode:'replace',decimal:'.'};
async function upload(store,recordId,name,bytes,derivesFrom=[]){
 const session=await store.startImport({recordId,name,size:bytes.length,provenance:'Synthetic acquisition; private path E:\\private\\capture',derivesFrom});
 for(let i=0;i<Math.ceil(bytes.length/EVIDENCE_CHUNK);i++)await store.appendImport(session.id,i,[bytes.subarray(i*EVIDENCE_CHUNK,(i+1)*EVIDENCE_CHUNK)]);
 return store.finishImport(session.id);
}

test('retained methods, interrupted 64 MiB capture, precise dataset, revised analysis, private edition and encrypted restore',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-adoption-')),root=path.join(parent,'source');
 const book=upgradeNotebook(sampleNotebook()),base=book.entries[0];
 const make=(type,title,status='draft')=>({...structuredClone(base),id:randomUUID(),type,title,status,body:'Synthetic fixture only.',figures:[],sections:[],attachments:[],relations:[],share:false});
 const method=make('protocol','Retained procedure'),run1=make('run','Hardware run 1','completed'),run2=make('run','Hardware run 2','incomplete'),conclusion=make('conclusion','What these two attempts show');
 run1.sections=['Preparation','Execution','Acquisition','Interpretation'].map(title=>({id:randomUUID(),title,body:title==='Execution'?'Physical execution observed for this attempt only.':'Separate event.'}));
 run2.sections=[{id:randomUUID(),title:'Acquisition',body:'Recovery incomplete. Software checks do not establish a physical run.'}];
 conclusion.body='One completed attempt and one incomplete recovery. This does not establish repeat reliability. Supporting captures are not publicly available.';conclusion.share=true;
 book.entries=[method,run1,run2,conclusion];validateNotebook(book);
 const access=await createAccess('','synthetic adoption password'),vault=takeCreatedVault(access);
 await initializeLocation(root,book,access,vault);const ws=new Workspace(root,vault),store=new ResearchMaterials(ws);
 const pinned=await store.pinRecord(method.id,recordRevision(method));
 const target={workspaceId:book.id,kind:'record',id:method.id,revision:pinned.revision};
 assert.deepEqual(parseResearchReference(researchReference(target)),target);
 const first=await ws.read();for(const run of first.book.entries.filter(e=>e.type==='run'))run.relations=[{id:randomUUID(),type:'Uses',target,label:method.title}];
 await ws.save(first.book,first.etag);
 const before=await ws.read(),oldRun=structuredClone(before.book.entries.find(e=>e.id===run1.id));
 before.book.entries.find(e=>e.id===method.id).body='Revised procedure; no alteration of earlier attempts.';await ws.save(before.book,before.etag);
 assert.equal((await store.read(pinned)).body,method.body);
 assert.deepEqual((await ws.read()).book.entries.find(e=>e.id===run1.id),oldRun);
 await assert.rejects(store.pinRecord(method.id,pinned.revision),{code:'RECORD_CHANGED'});

 const chunk=Buffer.alloc(EVIDENCE_CHUNK,0xa7),session=await store.startImport({recordId:run1.id,name:'opaque-capture.bin',size:64*EVIDENCE_CHUNK,provenance:'E:\\private\\captures\\raw.bin'});
 const sha=createHash('sha256');
 await store.appendImport(session.id,0,[chunk]);sha.update(chunk);
 async function* interrupted(){yield chunk.subarray(0,128);throw Error('synthetic disconnect');}
 await assert.rejects(store.appendImport(session.id,1,interrupted()),/synthetic disconnect/);
 await assert.rejects(store.finishImport(session.id),{code:'MATERIAL_INCOMPLETE'});
 const restarted=new ResearchMaterials(new Workspace(root,vault));assert.equal(restarted.uploads.count(await restarted.importState(session.id)),1);
 // A backup made while paused remains resumable on a different root.
 const paused=path.join(parent,'paused-copy');await copyWorkspace(await copyPlan(root,paused),{vault});
 const pausedStore=new ResearchMaterials(new Workspace(paused,vault));
 assert.equal((await pausedStore.verify()).receivedBytes,EVIDENCE_CHUNK);
 assert.equal((await pausedStore.sequences.item((await pausedStore.importState(session.id)).chunksIndex,0)).sha256,digest(chunk));
 const cancelled=new AbortController();cancelled.abort();
 await assert.rejects(pausedStore.appendImport(session.id,1,[chunk],{signal:cancelled.signal}),{name:'AbortError'});
 assert.equal(pausedStore.uploads.count(await pausedStore.importState(session.id)),1);
 for(let i=1;i<64;i++){await restarted.appendImport(session.id,i,[chunk]);sha.update(chunk);}
 const capture=await restarted.finishImport(session.id);assert.deepEqual(await restarted.finishImport(session.id),capture);
 const captureDoc=await restarted.read(capture);assert.equal(captureDoc.content.size,64*EVIDENCE_CHUNK);assert.equal(captureDoc.content.sha256,sha.digest('hex'));
 assert.equal(captureDoc.content.acquisition.kind,'record');
 assert.ok(!(await readFile((await restarted.artifact(capture)).content.file)).subarray(0,1024).equals(chunk.subarray(0,1024)));

 const large='18446744073709551615',senary='155555555555555555555';
 const rows=Array.from({length:4000},(_,i)=>['comparison',i<2000?'run 1':'run 2',i===3999?'':String(i%17),large,senary,String(i)].join(','));
 const csv=Buffer.from('Group,Run,Measurement,Counter,Senary,Order\n'+rows.join('\n'));
 const tableArtifact=await upload(store,run1.id,'measurements.csv',csv,[capture]);
 const schema=[column('Group'),column('Run'),column('Measurement','decimal',{unit:'mV'}),column('Counter','integer',{time:{kind:'counter',reference:'Device start',resolution:'1 tick',uncertainty:'unknown'}}),column('Senary','radix',{radix:6}),column('Order','integer',{time:{kind:'acquisition-order',reference:'Acquisition order',resolution:'1 observation',uncertainty:''}})];
 const dataset=await store.dataset({recordId:run1.id,title:'Measurement source',artifact:tableArtifact,columns:schema});
 const doc=await store.read(dataset);assert.equal(doc.content.rowCount,4000);assert.equal(doc.content.pageIndex.count,Math.ceil(4000/DATASET_ROWS_PER_PAGE));assert.ok(!('rows' in doc.content));
 const table=await store.datasetRows(dataset);assert.equal(table[0].cells[3],large);assert.equal(table[0].cells[4],senary);assert.equal(exactInteger(large),18446744073709551615n);assert.equal(exactInteger('10',6),6n);
 const baseFigure=createFigure();baseFigure.title='Comparison of the recovered observations';
 // These grouped means are repeating fractions. A checked projection must
 // refuse them; approximation is an explicit presentation choice, made only
 // after the exact reduction and retained with that analysis revision.
 await assert.rejects(store.plot({recordId:conclusion.id,title:'Retained comparison',dataset,mapping,base:baseFigure}),{code:'MATERIAL_PRECISION'});
 const result=await store.plot({recordId:conclusion.id,title:'Retained comparison',dataset,mapping:{...mapping,numericPolicy:'approximate'},base:baseFigure});
 const figure=await new RetainedFigureDocuments(ws,{readOnly:true}).open(result.figure),series=await figure.window({collection:'series',limit:2});
 assert.equal(series.total,2);assert.equal(series.items.length,2);
 const calc=await store.read(result.ref);assert.equal(calc.content.denominator.rows,4000);assert.equal(calc.content.denominator.missing[2].count,1);
 assert.equal(calc.content.numericTransform.reduction.projection,'after-reduction');assert.equal(calc.content.numericTransform.policy,'approximate');assert.ok(calc.content.warnings.some(message=>message.includes('rounded')));
 for(const [index,start,end]of [[0,0,2000],[1,2000,3999]]){const points=await figure.window({collection:'points',seriesId:series.items[index].id,limit:1});assert.equal(points.total,1);assert.equal(points.items[0].value.y,Array.from({length:end-start},(_,i)=>(start+i)%17).reduce((a,b)=>a+b,0)/(end-start));}
 await assert.rejects(store.plot({recordId:conclusion.id,title:'Do not coerce',dataset,mapping:{...mapping,values:[{column:3,error:null}]}}),{code:'MATERIAL_PRECISION'});
 const nativePlot=await store.plot({recordId:conclusion.id,title:'Exactly representable native counter',dataset,mapping:{...mapping,values:[{column:4,error:null}]}});
 const nativeFigure=await new RetainedFigureDocuments(ws,{readOnly:true}).open(nativePlot.figure);
 assert.equal(nativeFigure.document.counts.series,2);assert.equal(nativeFigure.document.counts.points,2);
 for await(const {value:point} of nativeFigure.pointEntries())assert.equal(point.y,7312316880125951);
 assert.equal((await store.datasetRows(dataset))[0].cells[4],senary);
 const external=await store.analysis({recordId:conclusion.id,title:'External decoder',inputs:[capture,dataset,pinned],tool:'Synthetic decoder',version:'fixture-1',parameters:'counter base: 6',outputs:[tableArtifact]});
 const revisedExternal=await store.analysis({recordId:conclusion.id,title:'External decoder',id:external.id,expectedRevision:external.revision,inputs:[capture,dataset,pinned],tool:'Synthetic decoder',version:'fixture-2',parameters:'revised interpretation',outputs:[tableArtifact]});
 assert.equal((await store.read(revisedExternal)).previous,external.revision);assert.equal((await store.read(external)).content.version,'fixture-1');
 const collection=await store.collection({recordId:run1.id,title:'Run 1 evidence',inputs:[capture,tableArtifact,dataset,external]});
 assert.equal((await store.read(collection)).content.inputsIndex.count,4);
 const reused=await store.reuseFigure({recordId:run2.id,analysis:result.ref});assert.notEqual(reused.figure.id,result.figure.id);
 assert.deepEqual((await store.read(reused.ref)).content.inputs,[result.ref]);
 const saved=await ws.read();saved.book.entries.find(e=>e.id===conclusion.id).figures=[result.figure];await ws.save(saved.book,saved.etag);
 assert.equal((await store.overview(conclusion.id)).items.find(m=>m.id===result.ref.id).figureState,'matches');
 const newDataset=await store.dataset({recordId:run1.id,title:'Measurement source',artifact:tableArtifact,columns:schema,id:dataset.id,expectedRevision:dataset.revision,exclusions:{[table[0].id]:'Synthetic instrument artifact'}});
 assert.equal((await store.read(newDataset)).previous,dataset.revision);
 const status=(await store.reviewDependencies(conclusion.id,{refs:[result.ref]})).items[0];
 assert.ok((await store.reviewDependencies(run2.id,{refs:[reused.ref]})).items[0].changed.some(r=>r.id===dataset.id));
 assert.ok(status.changed.some(r=>r.id===dataset.id));const retainedFigure=await new RetainedFigureDocuments(ws,{readOnly:true}).open((await store.read(result.ref)).content.figure);assert.equal((await retainedFigure.rawPoint({offset:0})).value.y,(await figure.rawPoint({offset:0})).value.y);
 assert.equal((await store.datasetRows(dataset))[0].excluded,null);

 // Public edition has only selected readable content and figure coordinates.
 const publicBook=(await ws.read()).book;
 publicBook.entries.find(e=>e.id===method.id).share=true; // latest method is public, but old pinned reference must not redirect to it
 publicBook.entries.find(e=>e.id===conclusion.id).relations=[{id:randomUUID(),type:'Uses',target,label:'PRIVATE OLD METHOD LABEL'}];
 const sources=await store.releaseSources(publicBook,[conclusion.id]);assert.equal(sources.sources[0].analysis.revision,result.ref.revision);assert.equal(sources.warnings[0].reason,'inputs');
 const command=await publicationDraftCommand(ws,publicBook),edition=await new PublicationJobs(ws).inline({...command,blockedValues:['E:\\private\\']}),files=new Map();
 // The fixture has four records: inspect every emitted text file and retain the
 // existing manifest/privacy/export assertions against the native preparation.
 for await(const [name,content] of edition.files)files.set(name,/\.(html|css|csv|svg|json|js|txt)$/.test(name)?(await contentBuffer(content)).toString('utf8'):content);
 const release={...edition,files};verifyPublication(release);
 const all=[...release.files.values()].filter(v=>typeof v==='string').join('\n');
 for(const privateValue of ['opaque-capture.bin','measurements.csv','E:\\private\\',captureDoc.content.sha256,large,senary,'PRIVATE OLD METHOD LABEL'])assert.ok(!all.includes(privateValue),privateValue);
 assert.ok(all.includes('Supporting captures are not publicly available.'));
 assert.ok([...release.files.keys()].some(p=>p.startsWith('figures/')));
 await writePublication(release,path.join(parent,'website-section'));

 const backup=path.join(parent,'restored');await copyWorkspace(await copyPlan(root,backup),{vault});
 const restoredVault=await verifyAccess(await readAccess(backup),'','synthetic adoption password');
 const restored=new ResearchMaterials(new Workspace(backup,restoredVault)),verified=await restored.verify();assert.ok(verified.originalBytes>=64*EVIDENCE_CHUNK+csv.length);
 assert.equal((await restored.read(pinned)).body,method.body);assert.equal((await restored.datasetRows(dataset))[0].cells[3],large);
 assert.deepEqual(await contentBuffer((await restored.artifact(tableArtifact)).content),csv);
 // Corruption is detected before original bytes are handed back.
 const original=(await restored.artifact(tableArtifact)).content.file,bytes=await readFile(original);bytes[bytes.length-1]^=1;await writeFile(original,bytes);
 await assert.rejects(restored.artifact(tableArtifact),{code:'ENCRYPTION_DAMAGED'});
});

test('creative takes use the same references and datasets without hypotheses or pass/fail criteria',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-takes-')),book=upgradeNotebook(sampleNotebook()),take=book.entries[2];
 take.type='run';take.title='Curtains closed â€” take 2';take.status='incomplete';take.sections=[{id:randomUUID(),title:'Observed deviations',body:'The final phrase was interrupted.'}];
 const ws=new Workspace(root);await ws.create(book);const store=new ResearchMaterials(ws);
 const original=await upload(store,take.id,'takes.tsv',Buffer.from('Take\tLevel\nFirst\t0.30\nSecond\t\n'));
 const data=await store.dataset({recordId:take.id,title:'Listening notes',artifact:original,columns:[column('Take'),column('Level','decimal')]});
 assert.equal((await store.datasetRows(data))[1].cells[1],'');
 const result=await store.plot({recordId:take.id,title:'Listening comparison',dataset:data,mapping:{...mapping,group:null,values:[{column:1,error:null}],operation:'raw'}});
 assert.equal(result.figure.series[0].points[1].y,null);
 assert.equal((await ws.read()).book.entries.find(e=>e.id===take.id).status,'incomplete');
});

test('new reference semantics are version gated and invalid tables keep their originals',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-format-')),book=upgradeNotebook(sampleNotebook()),ws=new Workspace(root);
 await ws.create(book);const store=new ResearchMaterials(ws),record=book.entries[0],pinned=await store.pinRecord(record.id,recordRevision(record));
 const older=structuredClone(book);older.formatVersion=16;older.entries[1].relations=[{id:randomUUID(),type:'Uses',target:{...pinned,workspaceId:book.id},label:'Retained'}];
 assert.throws(()=>validateNotebook(older),{code:'INVALID'});
 const bytes=Buffer.from([0xff,0xfe,0,0,60,115,99,114,105,112,116,62]),artifact=await upload(store,record.id,'opaque-script.html',bytes);
 await assert.rejects(store.dataset({recordId:record.id,title:'Not a UTF-8 table',artifact}),{code:'MATERIAL_TABLE'});
 assert.deepEqual(await contentBuffer((await store.artifact(artifact)).content),bytes);
 assert.equal((await store.heads()).filter(m=>m.kind==='dataset').length,0);
});
