import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts,verifyRecordValueDraft} from '../src/record-value-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {withRecordDocument,RecordDocument} from '../src/record-document.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {validResultStatement} from '../src/web/result-statements.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {retainedTable} from '../src/retained-tables.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const statement=()=>({id:randomUUID(),kind:'conclusion',title:'Reviewed result',text:'9007199254740993/6',basis:'authored',source:null,limitations:'Synthetic scope'});
const target=(f,id)=>({workspaceId:f.book.id,recordId:f.record.id,field:'result:'+id});
const save=(f,base,item)=>f.values.save({...target(f,base.field.slice(7)),expectedRevision:base.revision,value:{value:item}});
async function read(f,path){return f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);return withRecordDocument(store,row.id,row.revision,async doc=>(await doc.field(path)).value);});}
const forbid=t=>t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Result authoring reconstructed the record');});

test('result draft admission preserves incomplete choices without accepting altered structure',()=>{
 const s={...statement(),kind:'table',basis:'retained',source:null,tableSelection:{columns:[],offset:0,count:0,includeExcluded:false}};
 assert.ok(validResultStatement(s,{draft:true}));assert.equal(validResultStatement(s),false);assert.equal(validResultStatement({...s,unexpected:true},{draft:true}),false);
 assert.ok(validResultStatement({...statement(),kind:'figure',figureId:''},{draft:true}));
 assert.ok(validResultStatement({...statement(),title:'',text:'',limitations:''},{draft:true}));assert.equal(validResultStatement({...statement(),text:''}),false);
});
test('selected results preserve independent edits, pin sources, inspect late panels and reject stale changes',async t=>{
 const f=await figureValueFixture();t.after(f.close);forbid(t);const a=statement(),b={...statement(),basis:'retained',source:f.analysis},ab=await f.values.read(target(f,a.id)),bb=await f.values.read(target(f,b.id)),etag=(await f.workspace.outline()).etag;
 const field=RecordDocument.prototype.field;t.mock.method(RecordDocument.prototype,'field',function(path,...rest){if(path[0]==='figures'&&(path.length<3||['series','panels'].includes(path[2])))throw Error('Figure choice assembled observations');return field.call(this,path,...rest);});
 const choices=await f.values.figureChoices({workspaceId:f.book.id,recordId:f.record.id,offset:8});assert.equal(choices.total,9);assert.equal(choices.items.length,1);assert.equal(choices.items[0].hasPanels,true);assert.ok(choices.items.every(item=>Object.keys(item).sort().join()==='hasPanels,id,title'));
 const childChoices=await f.values.figureChoices({workspaceId:f.book.id,recordId:f.record.id,figureId:choices.items[0].id,offset:0});assert.equal(childChoices.total,3);assert.equal(childChoices.items[0].id,f.record.figures[8].panels[0].figure.id);assert.ok(childChoices.items.every(item=>item.hasPanels===false));
 RecordDocument.prototype.field.mock.restore();await save(f,ab,a);await save(f,bb,b);await save(f,ab,a);
 const current=await f.values.read(target(f,a.id));await save(f,current,{...a,text:'Revised exact statement'});await assert.rejects(save(f,current,{...a,text:'Stale overwrite'}),{code:'RECORD_CHANGED'});
 const panel={...statement(),kind:'figure',figureId:childChoices.items[1].id};await save(f,await f.values.read(target(f,panel.id)),panel);
 const broken={...statement(),kind:'figure',figureId:randomUUID()};await assert.rejects(save(f,await f.values.read(target(f,broken.id)),broken),{code:'ANALYSIS_INVALID'});
 const absent={...statement(),basis:'retained',source:{...f.analysis,revision:'a'.repeat(64)}};await assert.rejects(save(f,await f.values.read(target(f,absent.id)),absent));
 const selected=await f.values.read(target(f,a.id));await save(f,selected,null);const removed=(await f.workspace.outline()).etag;await save(f,selected,null);assert.equal((await f.workspace.outline()).etag,removed);
 const results=await read(f,['results']);assert.equal(results.statements.length,3);assert.ok(results.statements.some(s=>s.id===b.id));assert.ok(!results.statements.some(s=>s.id===a.id));
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(etag),f.record.id);await withRecordDocument(store,row.id,row.revision,async doc=>assert.deepEqual((await doc.field(['results'])).value,f.record.results));await store.verifySnapshot(undefined,f.book.id);});assert.deepEqual(await read(f,['sections']),f.record.sections);
});
test('retained result tables verify exact values and publish only their chosen dataset columns',async t=>{
 const f=await figureValueFixture();t.after(f.close);const bytes=Buffer.from('State,Count,Private\nA,10000000000000001,PRIVATE_SENTINEL\nB,0.3,PRIVATE_SENTINEL'),upload=await f.materials.startImport({recordId:f.record.id,name:'readings.csv',size:bytes.length});await f.materials.appendImport(upload.id,0,[bytes]);
 const source=await f.materials.dataset({recordId:f.record.id,title:'Private readings',artifact:await f.materials.finishImport(upload.id),columns:[defaultColumn({label:'State'}),{...defaultColumn({label:'Count'}),representation:'radix-fraction',radix:6},defaultColumn({label:'Private'})]});forbid(t);
 const table=await retainedTable(f.materials,{ref:source,selection:{columns:[0,1],offset:0,count:2,includeExcluded:false}}),s={...statement(),kind:'table',basis:'retained',source,table},base=await f.values.read(target(f,s.id)),bad=structuredClone(s);bad.table.rows[0].cells[1]='1';await assert.rejects(save(f,base,bad),{code:'DATASET_TABLE'});await save(f,base,s);
 const sharing={workspaceId:f.book.id,recordId:f.record.id,field:'share'},published=await f.values.read(sharing);await f.values.save({...sharing,expectedRevision:published.revision,value:{value:true}});
 ResearchCatalogue.prototype.record.mock.restore();const output=await new PublicationJobs(f.workspace).inline({etag:(await f.workspace.outline()).etag}),html=(await contentBuffer(output.files.get('entries/'+f.record.id+'.html'))).toString();assert.match(html,/Count \(base 6\)/);assert.match(html,/10000000000000001/);assert.ok(!html.includes('PRIVATE_SENTINEL'));assert.ok(!html.includes(source.id));
});
test('unfinished selected results recover under a new key, verify scope and roll back interrupted saves',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);forbid(t);assert.ok(Buffer.byteLength(JSON.stringify(f.record))>2*1024*1024);
 const item={...statement(),kind:'figure',figureId:''},base=await f.values.read(target(f,item.id)),drafts=new RecordValueDrafts(f.workspace),command={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value:item}},receipt=await drafts.write(command),lookup={workspaceId:f.book.id,id:command.id,expectedRevision:receipt.revision};assert.deepEqual(await drafts.write(command),receipt);
 const draft=(await new ResearchDrafts(f.workspace).read(command.id,{header:true})).draft;await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,draft,async doc=>{const changed=await new RecordDocument(doc.blocks,doc.root,{mutable:true}).replace(['sections','72','body'],'Outside selected value');await changed.blocks.flush();await assert.rejects(verifyRecordValueDraft(store,{...draft,document:{...draft.document,root:changed.root}}),{code:'CATALOGUE_DAMAGED'});} )));
 const access=await createAccess('','synthetic result recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault),recovered=await new RecordValueDrafts(workspace).read(lookup);assert.deepEqual(recovered.value,command.value);
 const values=new RecordValues(workspace),value={...item,figureId:f.record.figures[0].id},saveCommand={...target(f,item.id),expectedRevision:base.revision,value:{value}},etag=(await workspace.outline()).etag,finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted result commit');});await assert.rejects(values.save(saveCommand),/Interrupted result commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await workspace.outline()).etag,etag);await values.save(saveCommand);await workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));assert.equal((await read(f,['results'])).statements.length,1);
});
