import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {upgradeNotebook} from '../src/model.js';
import {migrationFixture} from './migration-fixture.js';
import {inventorySource} from '../src/migration/inventory.js';
import {MigrationImport} from '../src/migration/import-service.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {selectedJSON} from '../src/migration/content.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {createFigure} from '../src/web/figure-model.js';
import {importOrder} from '../src/migration/import-plan.js';
import {initialMapping,mappedId} from '../src/migration/import-model.js';
import {importedArtifactId} from '../src/migration/import-evidence.js';
import {buildPublication} from '../src/publication.js';
import {importContent} from '../src/migration/content.js';
import {contentBuffer} from '../src/file-content.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-import-')),source=path.join(directory,'source'),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(path.join(directory,'app'),book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const declared=await migrationFixture(source,{creative:true}),report=await inventorySource({source}),service=new MigrationImport(f.workspace),command={id:randomUUID(),workspaceId:book.id};
 const create=()=>service.create({...command,source,expectedPin:report.source.pin,notebookId:book.notebooks[0].id});
 return {...f,source,book,declared,report,service,command,create};
}
async function ready(f){
 let batch=await f.create();while(batch.state==='staging')batch=await f.service.stage(f.command);
 batch=await f.service.beginReview({...f.command,edit:batch.edit});while(batch.state==='reviewing')batch=await f.service.review(f.command);
 if(batch.state!=='ready')assert.fail(JSON.stringify(await f.service.page(f.command)));return batch;
}
async function repin(f,raw=null){
 await writeFile(path.join(f.source,'inventory.observanda-source.json'),raw??JSON.stringify(f.declared.manifest));f.report=await inventorySource({source:f.source});
 f.create=()=>f.service.create({...f.command,source:f.source,expectedPin:f.report.source.pin,notebookId:f.book.notebooks[0].id});
}
async function sourceFile(f,name,text){
 const bytes=Buffer.from(text);await mkdir(path.dirname(path.join(f.source,name)),{recursive:true});await writeFile(path.join(f.source,name),bytes);return {path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),selector:{kind:'whole'}};
}
async function reviewAll(f,batch){batch=await f.service.beginReview({...f.command,edit:batch.edit});while(batch.state==='reviewing')batch=await f.service.review(f.command);return batch;}
test('JSON selection preserves exact numeric spellings and rejects ambiguous or missing targets',async()=>{
 const text='{"huge":900719925474099312345,"values":[{"x":1.2300e-09,"s":"hello"}]}';
 assert.equal(await selectedJSON([Buffer.from(text)],'/values/0'),'{"x":1.2300e-09,"s":"hello"}');
 assert.equal(await selectedJSON([Buffer.from(text)],'/huge'),'900719925474099312345');
 await assert.rejects(selectedJSON([Buffer.from('{"x":1,"x":2}')],'/x'),{code:'IMPORT_CONTENT'});
 await assert.rejects(selectedJSON([Buffer.from(text)],'/absent'),{code:'IMPORT_CONTENT'});
 await assert.rejects(selectedJSON([Buffer.from([123,34,120,34,58,34,0xff,34,125])],'/x'),{code:'IMPORT_CONTENT'});
});
test('HTML import keeps selected prose inert and makes conversion omissions explicit',async()=>{
 const bytes=Buffer.from('<html><body><section id="public"><h1>Research &amp; listening</h1><p>Visible</p><script>globalThis.importExecuted=true</script><p hidden>Hidden text</p><a href="https://example.invalid">Link</a></section><section id="private">EXCLUDED</section></body></html>');
 const result=await importContent({size:bytes.length,read:()=>[bytes]},{selector:{kind:'anchor',value:'public'}},'html');
 assert.match(result.body,/Research & listening/);assert.ok(!result.body.includes('EXCLUDED'));assert.ok(!result.body.includes('Hidden'));assert.equal(globalThis.importExecuted,undefined);
 assert.deepEqual(result.omitted.map(o=>o.element).sort(),['hidden-element','link-target','script']);
 const table=Buffer.from('<pre>  code\n    next</pre><table><tr><td>3</td><td>4</td></tr></table>'),converted=await importContent({size:table.length,read:()=>[table]},{selector:{kind:'whole'}},'html');
 assert.ok(converted.body.startsWith('  code\n    next'));assert.match(converted.body,/3\t4\t\n/);assert.deepEqual(converted.omitted.map(o=>o.element),['pre-formatting','table-formatting']);
});
test('private import commits exact source relations atomically, retries, reverses and reapplies without duplicate identities',async t=>{
 const f=await fixture(t),before=await f.workspace.read(),review=await ready(f);
 assert.equal((await f.workspace.read()).etag,before.etag);
 assert.equal(review.reconciliation.create,4);
 const result=await f.service.commit({...f.command,review:review.review}),after=await f.workspace.read();
 assert.equal(after.book.entries.length,before.book.entries.length+4);
 const imported=after.book.entries.filter(r=>!before.book.entries.some(b=>b.id===r.id));assert.ok(imported.every(r=>!r.share));
 const run=imported.find(r=>r.title==='morning-one'),method=imported.find(r=>r.title==='listening-method');assert.equal(run.relations[0].target.id,method.id);assert.equal(run.relations[0].target.revision,recordRevision(method));
 assert.deepEqual(await f.service.commit({...f.command,review:review.review}),result);assert.equal((await f.workspace.read()).etag,after.etag);
 const second={...f,command:{...f.command,id:randomUUID()}};second.create=()=>f.service.create({...second.command,source:f.source,expectedPin:f.report.source.pin,notebookId:f.book.notebooks[0].id});
 const repeated=await ready(second);assert.equal(repeated.reconciliation.unchanged,4);
 const replay=await f.service.commit({...second.command,review:repeated.review});assert.equal(replay.receipt.records,0);assert.equal((await f.workspace.read()).etag,after.etag);
 assert.deepEqual((await f.service.list({workspaceId:f.book.id})).items.map(item=>item.id),[second.command.id,f.command.id]);
 const reversed=await f.service.reverse({...f.command,review:review.review});assert.equal(reversed.reversal.counts.removed,4);assert.equal((await f.workspace.read()).book.entries.length,before.book.entries.length);
 const third={...second,command:{...f.command,id:randomUUID()}};third.create=()=>f.service.create({...third.command,source:f.source,expectedPin:f.report.source.pin,notebookId:f.book.notebooks[0].id});
 const again=await ready(third);await f.service.commit({...third.command,review:again.review});
 const restored=await f.workspace.read();assert.deepEqual(restored.book.entries.slice(before.book.entries.length).map(r=>r.id).sort(),imported.map(r=>r.id).sort());
});
test('review rejects concurrent edits and reversal preserves subsequently authored records',async t=>{
 const f=await fixture(t),review=await ready(f);await f.service.commit({...f.command,review:review.review});
 const {book}=await f.workspace.read(),record=book.entries.find(r=>r.title==='morning-one'),edited={...record,body:'Later field observation'};
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:edited}]},{receipt:true});
 const result=await f.service.reverse({...f.command,review:review.review});assert.equal(result.reversal.counts['preserved-edits'],1);assert.equal((await f.service.detail({...f.command,index:1})).reversal.record.disposition,'preserved-edits');
 assert.equal((await f.workspace.read()).book.entries.find(r=>r.id===record.id).body,'Later field observation');
});
test('later unpinned references preserve imported targets when their batch is reversed',async t=>{
 const f=await fixture(t),review=await ready(f);await f.service.commit({...f.command,review:review.review});
 const {book}=await f.workspace.read(),method=book.entries.find(r=>r.title==='listening-method'),authored=book.entries[0];
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:authored.id,expectedRevision:recordRevision(authored),record:{...authored,relations:[{id:randomUUID(),type:'reference',label:method.title,target:{workspaceId:book.id,kind:'record',id:method.id}}]}}]},{receipt:true});
 const result=await f.service.reverse({...f.command,review:review.review});assert.equal(result.reversal.counts['preserved-references'],1);assert.equal(result.reversal.counts.removed,3);
 assert.ok((await f.workspace.read()).book.entries.some(r=>r.id===method.id));
});
test('staging detects changed bytes and resumes across service restarts without losing checkpoints',async t=>{
 const f=await fixture(t);let batch=await f.create(),staged=await f.service.store.batch(batch.id),file=staged.files[0],original=await readFile(path.join(f.source,file.path));
 await writeFile(path.join(f.source,file.path),Buffer.alloc(original.length,0x58));await assert.rejects(f.service.stage(f.command),{code:'INVENTORY_CHANGED'});
 assert.equal((await f.service.page(f.command)).batch.staged,0);await writeFile(path.join(f.source,file.path),original);
 batch=await f.service.stage(f.command);assert.equal(batch.staged,1);f.service=new MigrationImport(new Workspace(f.workspace.root,f.vault));
 while(batch.state==='staging')batch=await f.service.stage(f.command);
 batch=await f.service.beginReview({...f.command,edit:batch.edit});batch=await f.service.review(f.command);assert.equal(batch.prepared,1);
 f.service=new MigrationImport(new Workspace(f.workspace.root,f.vault));while(batch.state==='reviewing')batch=await f.service.review(f.command);
 await f.service.commit({...f.command,review:batch.review});assert.equal((await f.workspace.read()).book.entries.length,f.book.entries.length+4);
});
test('shared chapter exclusions, figure conversions and exact source attributes require explicit reconciliation',async t=>{
 const f=await fixture(t),base=f.declared.manifest.objects[0],chapter=await sourceFile(f,'shared.json','{"allowed":{"note":"Current findings"},"private":{"note":"EXCLUDED MARKER"}}'),figure=createFigure();
 figure.series[0].points=[{x:1,y:0.125,error:null}];const plot=await sourceFile(f,'plot.json',JSON.stringify(figure));
 f.declared.manifest.objects.push({...base,id:'chapter',kind:'chapter',title:'Chapter',mapping:{kind:'chapter'},files:[chapter],attributes:{exact:'EXACT_NUMBER',decimal:'EXACT_DECIMAL'}},
  {...base,id:'excluded',title:'Excluded part',disposition:'exclude',reason:'Private historical section',mapping:undefined,files:[{...chapter,selector:{kind:'json-pointer',value:'/private'}}]},
  {...base,id:'plot',title:'Plot',kind:'figure',mapping:{kind:'figure'},files:[plot]});
 await repin(f,JSON.stringify(f.declared.manifest).replace('"EXACT_NUMBER"','900719925474099312345').replace('"EXACT_DECIMAL"','1.2300e-9'));
 let batch=await f.create();while(batch.state==='staging')batch=await f.service.stage(f.command);
 let row=await f.service.detail({...f.command,index:6});batch=await f.service.mapping({...f.command,index:6,edit:batch.edit,mapping:{...row.mapping,contentMode:'figure'}});
 batch=await reviewAll(f,batch);assert.equal(batch.state,'mapping');assert.equal((await f.service.detail({...f.command,index:4})).problem.code,'IMPORT_EXCLUDED_BOUNDARY');assert.equal((await f.service.detail({...f.command,index:6})).problem.code,'IMPORT_CONVERSION');
 // The declaration, rather than a text scrubber, defines the shareable boundary.
 f.declared.manifest.objects[4].files=[{...chapter,selector:{kind:'json-pointer',value:'/allowed'}}];await repin(f,JSON.stringify(f.declared.manifest).replace('"EXACT_NUMBER"','900719925474099312345').replace('"EXACT_DECIMAL"','1.2300e-9'));f.command={...f.command,id:randomUUID()};
 batch=await f.create();while(batch.state==='staging')batch=await f.service.stage(f.command);row=await f.service.detail({...f.command,index:6});
 batch=await f.service.mapping({...f.command,index:6,edit:batch.edit,mapping:{...row.mapping,contentMode:'figure',acknowledgeConversion:true}});batch=await reviewAll(f,batch);
 assert.equal(batch.state,'ready');assert.equal(batch.reconciliation.exclude,1);assert.equal(batch.reconciliation.figures,1);await f.service.commit({...f.command,review:batch.review});
 const records=(await f.workspace.read()).book.entries.slice(f.book.entries.length),imported=records.find(r=>r.title==='Chapter');assert.ok(!JSON.stringify(records).includes('EXCLUDED MARKER'));
 assert.equal(imported.sections.length,0);
 const provenance=await f.service.provenance({workspaceId:f.book.id,recordId:imported.id});
 assert.equal(provenance.items[0].source.attributes,'{"exact":900719925474099312345,"decimal":1.2300e-9}');assert.equal(records.find(r=>r.title==='Plot').figures[0].series[0].points[0].y,0.125);
 const book=(await f.workspace.read()).book;book.entries=records.map(r=>({...r,share:true}));book.projects.forEach(p=>p.share=true);
 const publication=buildPublication(book);for(const [name,value] of publication.files){if(/\.(html|json|xml|txt|csv)$/.test(name))assert.ok(!String(value).includes('EXCLUDED MARKER'),name);assert.ok(!name.includes('.original'));}
});

test('shared original bytes retain each record association, filename, hash and download through repeat import and restore',async t=>{
 const f=await fixture(t),base=f.declared.manifest.objects[0],raw='{"one":{"note":"First run"},"two":{"note":"Second run"}}',shared=await sourceFile(f,'preparation/analysis.json',raw),alias=await sourceFile(f,'current-return/analysis.json',raw);
 for(const part of ['one','two'])f.declared.manifest.objects.push({...base,id:'shared-'+part,title:'Shared '+part,files:[shared,alias].map(file=>({...file,selector:{kind:'json-pointer',value:'/'+part}})),attributes:{unmapped:'Retain privately'}});
 await repin(f);let batch=await f.create();while(batch.state==='staging')batch=await f.service.stage(f.command);
 const row=await f.service.detail({...f.command,index:4});batch=await f.service.mapping({...f.command,index:4,edit:batch.edit,mapping:{...row.mapping,metadataMode:'section'}});batch=await reviewAll(f,batch);assert.equal(batch.state,'ready');
 await f.service.commit({...f.command,review:batch.review});
 const before=await f.workspace.read(),records=before.book.entries.filter(r=>r.title.startsWith('Shared '));assert.equal(records.length,2);assert.equal(records[0].sections[0].body,'{"unmapped":"Retain privately"}');assert.equal(records[1].sections.length,0);
 const check=async workspace=>{
  const materials=new ResearchMaterials(workspace),storageIds=new Set(),associationIds=new Set();
  for(const record of records){
   const page=await materials.overview(record.id);assert.equal(page.items.length,2);assert.equal(page.next,null);
   const locations=[];for(const ref of page.items){const {doc,content}=await materials.artifact(ref);assert.equal(doc.content.name,'analysis.json');locations.push(doc.content.sourcePath);assert.equal(ref.file.sourcePath,doc.content.sourcePath);assert.equal(doc.recordId,record.id);assert.equal(doc.content.sha256,shared.sha256);assert.equal(doc.content.size,Buffer.byteLength(raw));assert.equal((await contentBuffer(content)).toString(),raw);assert.equal(doc.content.acquisition.id,record.id);storageIds.add(doc.content.storageId);associationIds.add(doc.id);}
   assert.deepEqual(locations.sort(),['current-return/analysis.json','preparation/analysis.json']);
  }
  assert.equal(storageIds.size,1);assert.equal(associationIds.size,4);
 };
 await check(f.workspace);await f.service.commit({...f.command,review:batch.review});await check(f.workspace);assert.equal((await f.workspace.read()).etag,before.etag);
 const restored=await copyWorkspace(await copyPlan(f.workspace.root,path.join(path.dirname(f.workspace.root),'restored-associations')),{vault:f.vault});await check(new Workspace(restored,f.vault));
});

test('older saved metadata mappings keep their narrative treatment until explicitly changed',async t=>{
 const f=await fixture(t);f.declared.manifest.objects[0].attributes={sourceNote:'Retained metadata'};await repin(f);
 let batch=await f.create();while(batch.state==='staging')batch=await f.service.stage(f.command);
 const row=await f.service.detail({...f.command,index:0}),{metadataMode,research,...legacy}=row.mapping;
 batch=await f.service.mapping({...f.command,index:0,edit:batch.edit,mapping:legacy});batch=await f.service.beginReview({...f.command,edit:batch.edit});
 await f.service.store.locked(async()=>{const saved=await f.service.store.bound(f.command);for(const key of ['preparations','executionEvents','criterionAssessments','resultStatements'])delete saved.reconciliation[key];await f.service.store.write('batches/'+saved.id,saved);});
 while(batch.state==='reviewing')batch=await f.service.review(f.command);assert.equal(batch.state,'ready');
 for(const key of ['preparations','executionEvents','criterionAssessments','resultStatements'])assert.equal(batch.reconciliation[key],0);
 assert.equal((await f.service.detail({...f.command,index:0})).prepared.sourceRecord.sections[0].body,'{"sourceNote":"Retained metadata"}');
 batch=await f.service.mapping({...f.command,index:0,edit:batch.edit,mapping:{...legacy,metadataMode:'provenance'}});batch=await reviewAll(f,batch);assert.equal(batch.state,'ready');
 assert.deepEqual((await f.service.detail({...f.command,index:0})).prepared.sourceRecord.sections,[]);
});
test('exact dependency cycles and links to exclusions require explicit mapped dispositions',()=>{
 const source={id:'a',revision:'1',disposition:'map',mapping:{kind:'record'},title:'A',dates:[],files:[{selector:{kind:'whole'}}],links:[{id:'b',revision:'1'}]},other={...source,id:'b',links:[{id:'a',revision:'1'}]};
 const rows=[source,other].map((source,index)=>({source,index,mapping:initialMapping(source,randomUUID())}));assert.throws(()=>importOrder(rows),{code:'IMPORT_CYCLE'});
 rows[1].mapping.links[0].mode='current';assert.deepEqual(importOrder(rows),[1,0]);rows[1].mapping.disposition='exclude';assert.throws(()=>importOrder(rows),{code:'IMPORT_DEPENDENCY'});
 rows[0].mapping.links[0]={mode:'omit',role:'',reason:'Excluded historical dependency'};assert.deepEqual(importOrder(rows),[1,0]);
});

test('reviewed evidence repair restores legacy shared-file associations in bounded pages without editing records',async t=>{
 const f=await fixture(t),base=f.declared.manifest.objects[0],raw=JSON.stringify(Object.fromEntries(Array.from({length:22},(_,i)=>['r'+i,{note:'Shared apparatus return '+i}]))),files=[];
 for(const name of ['current-return/analysis.json','historical-input/analysis.json','validation.json'])files.push(await sourceFile(f,name,raw));
 const startIndex=f.declared.manifest.objects.length;f.declared.manifest.objects.push(...Array.from({length:22},(_,i)=>({...base,id:'run-'+i,title:'Run '+i,files:files.map(file=>({...file,selector:{kind:'json-pointer',value:'/r'+i}})),links:[]})));await repin(f);const batch=await ready(f);await f.service.commit({...f.command,review:batch.review});const repairCommand={...f.command,index:startIndex};
 const materials=new ResearchMaterials(f.workspace),before=await f.workspace.read(),records=before.book.entries.filter(r=>r.title.startsWith('Run '));assert.equal(records.length,22);
 // Reproduce the old hash-only identity: one shared original attached once.
 await f.workspace.withLock(async()=>{
  let first=true;
  for(const record of records)for(const file of files){
   const id=importedArtifactId(f.book.id,record.id,file),head=await materials.current(id),doc=await materials.read(head);
   if(first){const legacy=structuredClone(doc);delete legacy.content.sourcePath;await materials.commit({...legacy,id:mappedId(f.book.id,'import-original',file.sha256)});first=false;}
   await materials.index.removeHead(head);await f.workspace.removeMetadata('.observanda/materials/objects/'+id+'/head.json');
  }
 });
 let plan=await f.service.run('evidenceReview',repairCommand);assert.equal(plan.items.length,50);assert.ok(plan.next.file>0);assert.equal(plan.missing,49);assert.ok(plan.items[0].existing);
 await assert.rejects(f.service.run('evidenceRepair',{...f.command,...plan.start,review:'0'.repeat(64)}),{code:'IMPORT_CHANGED'});
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(f.service.run('evidenceRepair',{...f.command,...plan.start,review:plan.review},{signal:cancelled.signal}));assert.equal((await f.service.run('evidenceReview',repairCommand)).review,plan.review);
 const original=await f.service.store.original(files[0].sha256),savedBytes=await readFile(original.file),corrupt=Buffer.from(savedBytes);corrupt[corrupt.length-1]^=1;
 await writeFile(original.file,corrupt);
 try{await assert.rejects(f.service.run('evidenceRepair',{...f.command,...plan.start,review:plan.review}),{code:'ENCRYPTION_DAMAGED'});assert.equal((await f.service.run('evidenceReview',repairCommand)).review,plan.review);}
 finally{await writeFile(original.file,savedBytes);}
 const first=await f.service.run('evidenceRepair',{...f.command,...plan.start,review:plan.review});assert.equal(first.repaired,49);assert.deepEqual(await f.service.run('evidenceRepair',{...f.command,...plan.start,review:plan.review}),first);
 assert.equal((await f.service.run('evidenceReview',repairCommand)).missing,0);
 plan=await f.service.run('evidenceReview',{...f.command,...plan.next});assert.equal(plan.missing,16);assert.equal(plan.next,null);
 await f.service.run('evidenceRepair',{...f.command,...plan.start,review:plan.review});assert.equal((await f.workspace.read()).etag,before.etag);
 for(const record of records){const page=await materials.list({recordId:record.id,kind:'artifact'});assert.equal(page.items.length,3);for(const ref of page.items){const {doc,content}=await materials.artifact(ref);assert.equal(doc.content.sha256,files[0].sha256);assert.equal((await contentBuffer(content)).toString(),raw);}}
 const restored=await copyWorkspace(await copyPlan(f.workspace.root,path.join(path.dirname(f.workspace.root),'repair-backup')),{vault:f.vault}),service=new MigrationImport(new Workspace(restored,f.vault));assert.equal((await service.run('evidenceReview',repairCommand)).missing,0);assert.deepEqual(await service.run('evidenceRepair',{...repairCommand,file:0,review:first.review}),first);
});

test('declared native mapping imports exact fractional values and binds selectors to retained originals',async t=>{
 const f=await fixture(t),base=f.declared.manifest.objects[0],native=await sourceFile(f,'native.bin','abcdefgh01234567'),table=await sourceFile(f,'native-rows.csv','Tick,Value,Offset,Length\n255,15.3,0,4\n0,0.1,8,4');
 f.declared.manifest.objects.push({...base,id:'native-table',kind:'dataset',title:'Native table',mapping:{kind:'dataset'},files:[table,native],attributes:{declaredRows:2}});await repin(f);
 let batch=await f.create();while(batch.state==='staging')batch=await f.service.stage(f.command);const row=await f.service.detail({...f.command,index:4});
 const columns=['Tick','Value','Offset','Length'].map((name,i)=>({name,representation:i===1?'radix-fraction':'integer',radix:i===1?6:10,unit:'',missing:[],quantity:{origin:i===1?'measured':'unspecified',conversion:null,calibration:null},time:{kind:i===0?'counter':'unknown',reference:'',resolution:'',uncertainty:'unknown'}}));
 batch=await f.service.mapping({...f.command,index:4,edit:batch.edit,mapping:{...row.mapping,contentMode:'dataset',dataset:{sourceMapping:{format:'delimited',delimiter:',',header:true},columns,nativeMapping:{file:1,offsetColumn:2,lengthColumn:3,pointerColumn:null,idColumn:null}}}});
 batch=await reviewAll(f,batch);assert.equal(batch.state,'ready',JSON.stringify(await f.service.detail({...f.command,index:4})));await f.service.commit({...f.command,review:batch.review});
 const materials=new ResearchMaterials(f.workspace),head=(await materials.heads()).find(h=>h.kind==='dataset'),dataset={kind:head.kind,id:head.id,revision:head.revision},cell=await materials.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row:1,column:1}});
 assert.deepEqual(cell.exact,{numerator:'1',denominator:'6'});assert.notEqual(cell.native.ref.revision,'0'.repeat(64));assert.equal(Buffer.from((await materials.measurements.inspect(cell.native)).base64,'base64').toString(),'0123');
 assert.deepEqual(await materials.datasetColumns(await materials.read(dataset)),columns);await materials.verify();
});
test('dataset commits roll back with their records and modified originals cannot be applied',async t=>{
 const f=await fixture(t),file=await sourceFile(f,'rows.json','{"rows":[{"value":900719925474099312345},{"value":1.2300e-9},{"value":null},{"value":""},{}]}'),base=f.declared.manifest.objects[0];
 f.declared.manifest.objects.push({...base,id:'table',kind:'dataset',title:'Table',mapping:{kind:'dataset'},files:[{...file,selector:{kind:'json-pointer',value:'/rows'}}],attributes:{declaredRows:5}});await repin(f);
 let batch=await f.create();while(batch.state==='staging')batch=await f.service.stage(f.command);const row=await f.service.detail({...f.command,index:4});
 batch=await f.service.mapping({...f.command,index:4,edit:batch.edit,mapping:{...row.mapping,contentMode:'dataset',dataset:{sourceMapping:{format:'json',rowsPath:'/rows',fields:[{name:'Value',path:'/value'}]},columns:null}}});batch=await reviewAll(f,batch);
 const before=await f.workspace.read(),materials=new ResearchMaterials(f.workspace);
 await assert.rejects(f.service.commit({...f.command,review:batch.review},{onProgress:p=>{if(p.phase==='committing-datasets')throw Error('Interrupt after dataset commit');}}),/Interrupt after dataset commit/);
 assert.deepEqual(await f.workspace.read(),before);assert.equal((await materials.heads()).length,0);assert.equal((await f.service.page(f.command)).batch.state,'ready');
 const original=await f.service.store.original(file.sha256),bytes=await readFile(original.file),changed=Buffer.from(bytes);changed[changed.length-1]^=1;await writeFile(original.file,changed);
 await assert.rejects(f.service.commit({...f.command,review:batch.review}),{code:'ENCRYPTION_DAMAGED'});assert.deepEqual(await f.workspace.read(),before);await writeFile(original.file,bytes);
 await f.service.commit({...f.command,review:batch.review});const head=(await materials.heads()).find(h=>h.kind==='dataset'),values=[],kinds=[];for await(const row of materials.iterateDataset(head)){values.push(row.cells[0]);kinds.push(row.valueKinds[0]);}
 assert.deepEqual(values,['900719925474099312345','1.2300e-9','','','']);assert.deepEqual(kinds,['number','number','null','string','absent']);assert.deepEqual((await materials.datasetColumns(await materials.read(head)))[0].missing,[]);
 assert.equal((await f.service.detail({...f.command,index:4})).datasetPreview.rows[0].cells[0],'900719925474099312345');
 const doc=await materials.read(head),authored=await f.workspace.withLock(()=>materials.commit({kind:'dataset',id:head.id,recordId:head.recordId,title:'Authored table heading',content:doc.content,expectedRevision:head.revision}));
 const reversed=await f.service.reverse({...f.command,review:batch.review});assert.equal(reversed.reversal.counts['preserved-edits'],2);assert.equal((await materials.current(head.id)).revision,authored.revision);assert.ok((await f.workspace.read()).book.entries.some(r=>r.id===head.recordId));
 async function repeat(resolution){
  f.command={...f.command,id:randomUUID()};let next=await f.create();while(next.state==='staging')next=await f.service.stage(f.command);
  const selected=await f.service.detail({...f.command,index:4});next=await f.service.mapping({...f.command,index:4,edit:next.edit,mapping:{...selected.mapping,contentMode:'dataset',dataset:row.mapping.dataset??{sourceMapping:{format:'json',rowsPath:'/rows',fields:[{name:'Value',path:'/value'}]},columns:null}}});
  next=await reviewAll(f,next);assert.equal(next.state,'mapping');assert.ok((await f.service.detail({...f.command,index:4})).prepared.conflicts.includes('dataset'));
  const conflicted=await f.service.detail({...f.command,index:4});next=await f.service.mapping({...f.command,index:4,edit:next.edit,mapping:{...conflicted.mapping,resolution}});next=await reviewAll(f,next);assert.equal(next.state,'ready');await f.service.commit({...f.command,review:next.review});return next;
 }
 await repeat('local');assert.equal((await materials.current(head.id)).revision,authored.revision);
 const replaced=await repeat('source');assert.equal((await materials.current(head.id)).title,'Table');await f.service.reverse({...f.command,review:replaced.review});assert.equal((await materials.current(head.id)).revision,authored.revision);await materials.verify();
});
test('changed source requires conflict review, retains authored fields, and detects changes after review',async t=>{
 const f=await fixture(t),first=await ready(f);await f.service.commit({...f.command,review:first.review});
 const before=await f.workspace.read(),record=before.book.entries.find(r=>r.title==='morning-one'),records=new ResearchRecords(f.workspace,{});
 await records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,body:'Authored after import'}}]},{receipt:true});
 const source=f.declared.manifest.objects[1],bytes=Buffer.from('{"notes":"Changed source observations."}');source.title='Revised morning';source.files[0].bytes=bytes.length;source.files[0].sha256=createHash('sha256').update(bytes).digest('hex');
 await writeFile(path.join(f.source,source.files[0].path),bytes);await writeFile(path.join(f.source,'inventory.observanda-source.json'),JSON.stringify(f.declared.manifest));
 const report=await inventorySource({source:f.source}),command={...f.command,id:randomUUID()};
 let batch=await f.service.create({...command,source:f.source,expectedPin:report.source.pin,notebookId:f.book.notebooks[0].id});while(batch.state==='staging')batch=await f.service.stage(command);
 batch=await f.service.beginReview({...command,edit:batch.edit});while(batch.state==='reviewing')batch=await f.service.review(command);
 assert.equal(batch.state,'mapping');const row=await f.service.detail({...command,index:1});assert.deepEqual(row.prepared.conflicts,['body']);assert.equal(row.prepared.sourceChanged,true);
 batch=await f.service.mapping({...command,index:1,edit:batch.edit,mapping:{...row.mapping,resolution:'local'}});
 batch=await f.service.beginReview({...command,edit:batch.edit});while(batch.state==='reviewing')batch=await f.service.review(command);assert.equal(batch.state,'ready');const oldToken=batch.review;
 const current=(await f.workspace.read()).book.entries.find(r=>r.id===record.id);
 await records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(current),record:{...current,outcome:'Personal assessment'}}]},{receipt:true});
 await assert.rejects(f.service.commit({...command,review:oldToken}),{code:'IMPORT_CHANGED'});
 batch=await f.service.beginReview({...command,edit:batch.edit});while(batch.state==='reviewing')batch=await f.service.review(command);assert.notEqual(batch.review,oldToken);
 await assert.rejects(f.service.commit({...command,review:oldToken}),{code:'IMPORT_REVIEW'});
 await f.service.commit({...command,review:batch.review});const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id);
 assert.equal(saved.title,'Revised morning');assert.equal(saved.body,'Authored after import');assert.equal(saved.outcome,'Personal assessment');assert.equal(saved.share,false);
 await f.service.reverse({...command,review:batch.review});const reversed=(await f.workspace.read()).book.entries.find(r=>r.id===record.id);assert.equal(reversed.title,'morning-one');assert.equal(reversed.outcome,'Personal assessment');
});
test('an interrupted commit rolls back records and receipts; staged work survives copying and resumes without its source folder',async t=>{
 const f=await fixture(t),review=await ready(f),before=await f.workspace.read();
 await assert.rejects(f.service.commit({...f.command,review:review.review},{onProgress:p=>{if(p.phase==='committing')throw Error('Synthetic interruption');}}),/Synthetic interruption/);
 assert.deepEqual(await f.workspace.read(),before);assert.equal((await f.service.page(f.command)).batch.state,'ready');
 const destination=path.join(path.dirname(f.workspace.root),'restored'),copy=await copyWorkspace(await copyPlan(f.workspace.root,destination),{vault:f.vault});
 // A staged source is no longer needed for review, application or provenance.
 const sourcePath=path.resolve(f.source);assert.ok(sourcePath.startsWith(path.dirname(path.dirname(f.workspace.root))+path.sep));await rm(sourcePath,{recursive:true,force:true});
 const restored=new Workspace(copy,f.vault),service=new MigrationImport(restored);await service.commit({...f.command,review:review.review});
 assert.equal((await restored.read()).book.entries.length,before.book.entries.length+4);assert.equal((await f.workspace.read()).etag,before.etag);
 const imported=(await restored.read()).book.entries.find(r=>r.title==='morning-one'),provenance=await service.provenance({workspaceId:f.book.id,recordId:imported.id});assert.equal(provenance.items[0].source.dates[0].value,'2026-04');
 const access=await createAccess('','Synthetic import restore key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(restored.root,path.join(path.dirname(f.workspace.root),'fresh')),access,vault,f.vault),freshWorkspace=new Workspace(fresh,vault);
 assert.deepEqual(await freshWorkspace.read(),await restored.read());assert.equal((await new MigrationImport(freshWorkspace).provenance({workspaceId:f.book.id,recordId:imported.id})).items.length,1);
});
test('complete adoption fixture preserves distinct attempts, exact methods, criteria, dataset values and exclusions',{timeout:600000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-import-adoption-')),source=path.join(directory,'source'),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(path.join(directory,'app'),book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const declared=await migrationFixture(source,{full:true}),report=await inventorySource({source}),service=new MigrationImport(f.workspace),command={id:randomUUID(),workspaceId:book.id},start=Date.now();
 let peakRss=process.memoryUsage().rss;const memory=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);t.after(()=>clearInterval(memory));
 let batch=await service.create({...command,source,expectedPin:report.source.pin,notebookId:book.notebooks[0].id});
 while(batch.state==='staging')batch=await service.stage(command);
 console.log(JSON.stringify({workload:'A3 staged originals',durationMs:Date.now()-start,bytes:report.counts.bytes}));
 await assert.rejects(service.beginReview({...command,edit:batch.edit}),{code:'IMPORT_CURRENT'});
 for(let i=0;i<declared.manifest.objects.length;i++){
  const object=declared.manifest.objects[i];if(object.id!=='shared-method'&&object.id!=='observations')continue;
  const row=await service.detail({...command,index:i}),mapping={...row.mapping};
  if(object.id==='shared-method')mapping.current=object.revision==='r2';
  else {
   mapping.contentMode='dataset';mapping.dataset={sourceMapping:{format:'json',rowsPath:'/observations',fields:[{name:'Row',path:'/rowId'},{name:'Counter',path:'/counter'},{name:'Value',path:'/value/digits'},{name:'Missing',path:'/missing'}]},columns:null};
  }
  batch=await service.mapping({...command,index:i,edit:batch.edit,mapping});
 }
 batch=await service.beginReview({...command,edit:batch.edit});while(batch.state==='reviewing')batch=await service.review(command);
 console.log(JSON.stringify({workload:'A3 prepared review',durationMs:Date.now()-start}));
 assert.equal(batch.state,'ready',JSON.stringify(batch));assert.equal(batch.reconciliation.retain,1);assert.equal(batch.reconciliation.exclude,1);
 await service.commit({...command,review:batch.review});
 const saved=await f.workspace.read(),imported=saved.book.entries.slice(book.entries.length);assert.equal(imported.filter(r=>r.type==='run').length,70);assert.equal(imported.filter(r=>r.type==='experiment').length,42);
 assert.ok(imported.every(r=>!r.share));assert.ok(!imported.some(r=>r.title==='historical-demonstration'));
 const method=imported.find(r=>r.title==='shared-method'),run=imported.find(r=>r.title==='run-0');assert.ok(method.body.includes('Added explicit review'));
 const exact=run.relations.find(r=>r.type==='followed').target,materials=new ResearchMaterials(f.workspace),retained=await materials.read({kind:'record',id:exact.id,revision:exact.revision});assert.ok(retained.body.includes('105'));assert.ok(!retained.body.includes('Added explicit review'));
 const assessment=imported.find(r=>r.title==='recognition-assessment');assert.ok(assessment.body.includes('unresolved'));assert.equal(assessment.outcome,undefined);
 const dataset=imported.find(r=>r.title==='observations'),heads=await materials.heads(),table=heads.find(h=>h.recordId===dataset.id&&h.kind==='dataset');assert.ok(table);
 const doc=await materials.read(table);assert.equal(doc.content.rowCount,4344);let count=0;
 for await(const row of materials.iterateDataset(table)){assert.equal(row.cells[1],'900719925474099312345');assert.equal(row.cells[2],'105');count++;}assert.equal(count,4344);
 console.log(JSON.stringify({workload:'A3 declared adoption import',durationMs:Date.now()-start,sourceObjects:393,currentRecords:imported.length,rows:count,peakRssBytes:peakRss}));
 await service.reverse({...command,review:batch.review});assert.deepEqual((await f.workspace.read()).book.entries,book.entries);assert.equal(await materials.current(table.id),null);
 await materials.verify();
});
