import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {newSketch,validSketch,moveSketchItem} from '../src/web/sketch-model.js';
import {renderSketch} from '../src/web/sketch-renderer.js';
import {validRichText,renderRichText,richTextPlain} from '../src/web/rich-text-model.js';
import {bookSelectors} from '../src/web/book-selectors.js';
import {journeyBook} from './book-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordHistory} from '../src/record-history.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {starterRecord,validStarter} from '../src/web/record-starter-model.js';
function sketch(){return {...newSketch(randomUUID()),title:'Apparatus drawing',description:'Follow the input to the sensor. This drawing is not to scale.',items:[{id:randomUUID(),kind:'stroke',colour:'#123456',weight:2,points:[[20,30],[40.125,60],[80,70]]},...['line','arrow','rectangle','ellipse'].map(kind=>({id:randomUUID(),kind,colour:'#202a3a',weight:3,fill:'none',x:100,y:100,x2:300,y2:180})),{id:randomUUID(),kind:'text',colour:'#202a3a',x:320,y:100,size:24,text:'Sensor <A> & B'}]};}
const doc=a=>({type:'doc',content:[{type:'book_sketch',attrs:a}]});
test('sketch primitives have bounded portable geometry, safe SVG and stable content selectors',()=>{
 const a=sketch();assert.ok(validSketch(a));assert.ok(validRichText(doc(a)));const svg=renderSketch(a);assert.match(svg,/Sensor &lt;A&gt; &amp; B/);assert.ok(!svg.includes('url('));assert.match(renderRichText(doc(a)),/Enlarge figure/);assert.ok(richTextPlain(doc(a)).includes('Sensor <A> & B'));assert.ok(!richTextPlain(doc(a)).includes('[object Object]'));
 assert.equal(bookSelectors({body:doc(a)})[0].id,a.id);assert.equal(bookSelectors({body:doc(a)})[0].kind,'block');
 const changed=moveSketchItem(a.items[0],-100,600,a);assert.deepEqual(changed.points,[[0,500],[20.125,530],[60,540]]);assert.deepEqual(a.items[0].points[0],[20,30]);
 for(const mutate of [v=>v.version=2,v=>v.items[0].points[0][0]=Infinity,v=>v.items[0].points[0][0]=-1,v=>v.items[0].points.push([1,2,3]),v=>v.items[0].onclick='bad()',v=>v.items[0].colour='url(https://example.org)',v=>v.items.push(v.items[0]),v=>v.items[0].points=Array.from({length:2049},()=>[1,1]),v=>v.items.at(-1).text='',v=>v.description='',v=>v.width=4097]){const bad=structuredClone(a);mutate(bad);assert.equal(validSketch(bad),false);assert.equal(validRichText(doc(bad)),false);}
 const huge=sketch();huge.items=Array.from({length:11},()=>({...a.items[0],id:randomUUID(),points:Array.from({length:2000},()=>[1,1])}));assert.equal(validSketch(huge),false);
 const template={name:'Drawing instructions',type:'note',title:'Apparatus',body:doc(a),sections:[],tags:[]};assert.ok(validStarter(template));const record=starterRecord(template,{id:randomUUID(),notebookId:randomUUID(),uuid:randomUUID,now:new Date().toISOString()});assert.notEqual(record.body.content[0].attrs.id,a.id);assert.deepEqual(record.body.content[0].attrs.items,a.items);assert.equal(record.share,false);
});
test('saved sketches retain prior geometry, restore encrypted, and render only in selected public records',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-sketch-')),f=journeyBook(),a=sketch();f.concept.body=doc(a);f.privateRecord.body=doc({...sketch(),title:'Private sketch marker'});const storage=await encryptedFixture(dir,f.book);t.after(async()=>{clearVault(storage.vault);await rm(dir,{recursive:true,force:true});});
 const service=new ResearchRecords(storage.workspace,{}),before=f.concept,edited={...before,body:doc({...a,items:a.items.map(i=>i.kind==='text'?{...i,text:'Changed sensor annotation'}:i)})};await service.save({workspaceId:f.book.id,changes:[{id:before.id,expectedRevision:recordRevision(before),record:edited}]});
 const history=new RecordHistory(storage.workspace,{}),query={workspaceId:f.book.id,recordId:before.id},listing=await history.list(query),old=listing.versions.find(v=>v.revision===recordRevision(before));assert.ok(old);assert.deepEqual((await history.read({...query,...old})).record.body,doc(a));
 await assert.rejects(service.save({workspaceId:f.book.id,changes:[{id:before.id,expectedRevision:recordRevision(before),record:edited}]}),{code:'RECORD_CHANGED'});
 const backup=await copyWorkspace(await copyPlan(storage.workspace.root,path.join(dir,'backup')),{vault:storage.vault}),restored=await new Workspace(backup,storage.vault).read();assert.deepEqual(restored.book.entries.find(r=>r.id===before.id).body,edited.body);
 const publication=buildPublication(restored.book);verifyPublication(publication);const html=publication.files.get('entries/'+before.id+'.html');assert.match(html,/Changed sensor annotation/);assert.match(html,new RegExp('record-block-'+a.id));assert.match(html,/<svg/);assert.match(html,/Follow the input/);for(const value of publication.files.values())if(typeof value==='string')assert.ok(!value.includes('Private sketch marker'));
});
