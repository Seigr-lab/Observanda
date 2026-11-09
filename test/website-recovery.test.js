import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {contentBuffer} from '../src/file-content.js';
import {discardWebsiteRecovery,inspectWebsiteRecovery,listWebsiteRecovery,readWebsiteRecovery,saveWebsiteRecovery,websiteRecoveryResource} from '../src/website-recovery.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'website-recovery-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Website recovery opened a research store');
 const store=new WebsiteFileStore(workspace),site=randomUUID(),page=await store.create({id:site,name:'Field notebook'});
 const make=(value=page)=>({id:randomUUID(),path:value.path,baseRevision:value.site.revision,operationId:randomUUID(),html:value.html.replace('</main>','<p>Unfinished observations</p></main>'),css:value.css+'p{color:green}',bookmark:{anchor:{path:[0],offset:0},focus:{path:[0],offset:1}}});
 return {store,workspace,site,page,make};
}
const ref=r=>({id:r.id,revision:r.revision,path:r.documentKey});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2XcAAAAASUVORK5CYII=','base64');

test('an acknowledged website draft recovers exact files, selection and an author-owned image without publishing the draft',async t=>{
 const {store,workspace,site,page,make}=await fixture(t),data=make(),name='pictures/'+randomUUID()+'.png';
 data.html=data.html.replace('</body>','<img src="'+name+'"></body>');data.receivePictures=async function*(){yield {name,bytes:png};};
 const original=await saveWebsiteRecovery(store,site,data),receipt=await saveWebsiteRecovery(store,site,data);assert.equal(original.operationId,data.operationId);
 assert.deepEqual(receipt,original);assert.equal(receipt.state,'ready');
 const reopened=new WebsiteFileStore(workspace),list=await inspectWebsiteRecovery(reopened,site,{path:data.path});
 assert.equal(list.items.length,1);assert.equal(list.items[0].revision,receipt.revision);assert.ok(!JSON.stringify(list).includes('Unfinished observations'));
 const result=await readWebsiteRecovery(reopened,site,{...ref(receipt),compare:true});
 assert.equal(result.html,data.html);assert.equal(result.css,data.css);assert.deepEqual(result.bookmark,data.bookmark);assert.equal(result.saved.html,page.html);
 const pic=await websiteRecoveryResource(reopened,site,{...ref(receipt),name,assetStamp:page.assetStamp});assert.deepEqual(await contentBuffer(pic.content),png);
 assert.equal((await reopened.export(site)).files.has(name),false);
 const saved=await reopened.save(site,{...data,expectedRevision:page.site.revision,receivePictures:undefined,recovery:ref(receipt)});
 assert.ok(saved.html.includes(name));assert.ok((await reopened.export(site)).files.has(name));
 await discardWebsiteRecovery(reopened,site,ref(receipt));assert.deepEqual(await listWebsiteRecovery(reopened),{items:[],next:null});
});

test('loss of acknowledgement, disk full and an interrupted replacement preserve the most recent committed draft',async t=>{
 const {store,workspace,site,make}=await fixture(t),data=make(),r=await saveWebsiteRecovery(store,site,data);
 const update={...data,html:data.html+'<!--second-->',expectedDraftRevision:r.revision,operationId:randomUUID()};
 for(const suffix of ['/staging.json','/head.json']){
  const write=store.writeControl.bind(store);
  store.writeControl=(name,...args)=>{if(name.endsWith(suffix))throw Object.assign(Error('No space'),{code:'ENOSPC'});return write(name,...args);};
  await assert.rejects(saveWebsiteRecovery(store,site,update),{code:'ENOSPC'});store.writeControl=write;
  const resumed=new WebsiteFileStore(workspace);
  assert.equal((await readWebsiteRecovery(resumed,site,ref(r))).html,data.html);
  assert.equal((await listWebsiteRecovery(resumed)).items.length,1);
 }
 const next=await saveWebsiteRecovery(store,site,update);assert.equal((await saveWebsiteRecovery(store,site,update)).revision,next.revision);
 await assert.rejects(discardWebsiteRecovery(store,site,ref(r)),{code:'DRAFT_CHANGED'});
 assert.equal((await readWebsiteRecovery(store,site,ref(next))).html,update.html);
});

test('interruption before the first receipt reclaims private staged files and interrupted discard completes on reopen',async t=>{
 const {store,site,make}=await fixture(t),data=make(),directory='.observanda/website-files/sites/'+site+'/recovery/'+data.id;
 const write=store.writeControl.bind(store);store.writeControl=(name,...args)=>{if(name===directory+'/head.json')throw Object.assign(Error('Interrupted first write'),{code:'ENOSPC'});return write(name,...args);};
 await assert.rejects(saveWebsiteRecovery(store,site,data),{code:'ENOSPC'});store.writeControl=write;
 assert.ok((await store.scope(()=>store.names(directory+'/files',{directories:false}))).items.length>0);
 assert.deepEqual((await inspectWebsiteRecovery(store,site,{path:data.path})).items,[]);
 assert.deepEqual((await store.scope(()=>store.names(directory+'/files',{directories:false}))).items,[]);
 const receipt=await saveWebsiteRecovery(store,site,data),remove=store.remove.bind(store);
 store.remove=name=>{if(name===directory+'/head.json')throw Object.assign(Error('Interrupted discard'),{code:'EIO'});return remove(name);};
 await assert.rejects(discardWebsiteRecovery(store,site,ref(receipt)),{code:'EIO'});store.remove=remove;
 assert.deepEqual((await listWebsiteRecovery(store)).items,[]);
 await assert.rejects(readWebsiteRecovery(store,site,ref(receipt)),{code:'DRAFT_CHANGED'});
 assert.deepEqual((await store.scope(()=>store.names(directory+'/files',{directories:false}))).items,[]);
});

test('a read-only volume still offers acknowledged work and honours an already committed discard decision',async t=>{
 const {store,site,make}=await fixture(t),a=make(),b=make(),first=await saveWebsiteRecovery(store,site,a),second=await saveWebsiteRecovery(store,site,b);
 const remove=store.remove.bind(store),scope=store.scope.bind(store);
 store.remove=name=>{if(name.endsWith('/'+second.id+'/head.json'))throw Object.assign(Error('Read only'),{code:'EROFS'});return remove(name);};
 await assert.rejects(discardWebsiteRecovery(store,site,ref(second)),{code:'EROFS'});
 store.scope=(work,options)=>{if(options?.write)throw Object.assign(Error('Read only'),{code:'EROFS'});return scope(work,options);};
 const list=await listWebsiteRecovery(store);assert.deepEqual(list.items.map(row=>row.id),[first.id]);
 assert.equal((await readWebsiteRecovery(store,site,ref(first))).html,a.html);
 await assert.rejects(readWebsiteRecovery(store,site,ref(second)),{code:'DRAFT_CHANGED'});
});

test('a pending or changed source grant removes all recovery text and preview access while still allowing discard',async t=>{
 const {store,workspace,site,page,make}=await fixture(t);
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
 const token=await store.beginSourceUpdate({sourceId}),source=await store.putSource({sourceId,title:'Observation',html:'<p>Withdraw this detail</p>'},{token});
 const pageWithSource=await store.insertSources(site,{expectedRevision:page.site.revision,path:page.path,sources:[{sourceId,sourceRevision:source.revision}]});
 const data=make(pageWithSource),r=await saveWebsiteRecovery(store,site,data);
 const change=await store.beginSourceUpdate({sourceId});
 for(const pending of [true,false]){
  if(!pending)await store.putSource({sourceId,title:'Withdrawn',visible:false},{token:change});
  const recovery=await readWebsiteRecovery(store,site,{...ref(r),compare:true});
  assert.equal(recovery.summary.capabilities.compare,false);assert.equal(recovery.summary.capabilities.recover,false);
  assert.equal(recovery.html,undefined);assert.equal(recovery.saved,undefined);
  assert.doesNotMatch(JSON.stringify(await listWebsiteRecovery(store)),/Withdraw this detail/);
 }
 await discardWebsiteRecovery(store,site,ref(r));
});

test('page and workspace lists use distinct scoped cursors and recover only the selected owner and revision',async t=>{
 const {store,site,make}=await fixture(t);
 const one=await saveWebsiteRecovery(store,site,make()),two=await saveWebsiteRecovery(store,site,make());
 const page=await inspectWebsiteRecovery(store,site,{path:'index.html',limit:1}),all=await listWebsiteRecovery(store,{limit:1});
 assert.equal(page.items[0].id,two.id);assert.equal(all.items[0].id,two.id);
 assert.equal((await listWebsiteRecovery(store,{limit:1,cursor:all.next})).items[0].id,one.id);
 await assert.rejects(listWebsiteRecovery(store,{limit:1,cursor:page.next}),{code:'INVALID'});
 await assert.rejects(inspectWebsiteRecovery(store,site,{path:'next.html',limit:1,cursor:page.next}),{code:'INVALID'});
 await assert.rejects(readWebsiteRecovery(store,randomUUID(),ref(two)),{code:'DRAFT_CHANGED'});
 const saved=await store.open(site);
 await store.save(site,{expectedRevision:saved.site.revision,path:saved.path,html:saved.html.replace('</body>','<p>Another author</p></body>'),css:saved.css});
 const declined=await readWebsiteRecovery(store,site,ref(two));assert.equal(declined.summary.state,'conflict');assert.equal(declined.html,undefined);
 const compared=await readWebsiteRecovery(store,site,{...ref(two),compare:true});assert.match(compared.saved.html,/Another author/);assert.doesNotMatch(compared.html,/Another author/);
});

test('unfinished raw source is returned as inert text and a missing private image is reported before restoring',async t=>{
 const {store,site,make}=await fixture(t),data=make(),name='pictures/'+randomUUID()+'.png';
 data.html+='<script>unfinished';data.sourceKind='html';
 const r=await saveWebsiteRecovery(store,site,data),text=await readWebsiteRecovery(store,site,ref(r));
 assert.equal(text.html,data.html);assert.equal(text.sourceOnly,'html');assert.doesNotMatch((await store.open(site)).html,/unfinished/);
 const another=make();another.html+='<img src="'+name+'">';another.receivePictures=async function*(){yield {name,bytes:png};};
 const photo=await saveWebsiteRecovery(store,site,another);
 await store.scope(async()=>{const info=await store.control('.observanda/website-files/sites/'+site+'/recovery/'+photo.id+'/head.json');await store.remove(info.pictures[0].blob);},{write:true});
 const refused=await readWebsiteRecovery(store,site,ref(photo));assert.equal(refused.summary.state,'missing-media');assert.equal(refused.html,undefined);
});

test('the recovery copy owns a previously saved picture and recording restored by unsaved undo',async t=>{
 const {store,site,page,make}=await fixture(t),historyKey=randomUUID(),picture='pictures/'+randomUUID()+'.png',track='recordings/'+randomUUID()+'.vtt',unused='recordings/'+randomUUID()+'.vtt';
 const html=page.html.replace('</body>','<img src="'+picture+'"><video controls><track src="'+track+'" kind="captions" srclang="en" label="Field track"><track src="'+unused+'" kind="captions" label="Unused"></video></body>');
 const caption=Buffer.from('WEBVTT\n\n00:00.000 --> 00:00.200\nObservation\n');
 const before=await store.save(site,{path:page.path,expectedRevision:page.site.revision,html,css:page.css,historyKey,receivePictures:async function*(){yield {name:picture,bytes:png};},recordings:[track,unused].map(name=>({name,bytes:caption,contentType:'text/vtt; charset=utf-8'}))});
 const removed=await store.save(site,{path:page.path,expectedRevision:before.site.revision,html:page.html,css:page.css,historyKey});
 const data={...make(removed),html:before.html,css:before.css};
 await assert.rejects(saveWebsiteRecovery(store,site,{...data,historyKey:randomUUID()}),{code:'MATERIAL_MISSING'});
 const receipt=await saveWebsiteRecovery(store,site,{...data,historyKey});
 const correctedHTML=data.html.replace(' src="'+unused+'"','')+'<p>'+unused+'</p>';
 const unknown='recordings/'+randomUUID()+'.mp4',partial=correctedHTML+'<img src="/unfinished"><video src="'+unknown+'">';
 const raw=await saveWebsiteRecovery(store,site,{...data,html:partial,sourceKind:'html',expectedDraftRevision:receipt.revision,operationId:randomUUID()});
 const text=await readWebsiteRecovery(store,site,ref(raw));assert.equal(text.sourceOnly,'html');assert.equal(text.html,partial);
 assert.equal(text.pictures[0].name,picture);assert.deepEqual(text.recordings,[track]);
 await assert.rejects(websiteRecoveryResource(store,site,{...ref(raw),assetStamp:removed.assetStamp,name:unknown}),{code:'NOT_FOUND'});
 const corrected=await saveWebsiteRecovery(store,site,{...data,html:correctedHTML,expectedDraftRevision:raw.revision,operationId:randomUUID()});
 const copy=await readWebsiteRecovery(store,site,ref(corrected));assert.equal(copy.sourceOnly,null);assert.deepEqual(copy.recordings,[track]);
 const decoded=await websiteRecoveryResource(store,site,{...ref(corrected),assetStamp:removed.assetStamp,name:track});assert.deepEqual(await contentBuffer(decoded.content),caption);
 await store.save(site,{path:page.path,html:copy.html,css:copy.css,recovery:ref(corrected),expectedRevision:removed.site.revision});
 const exported=await store.export(site);assert.ok(exported.files.has(picture));assert.ok(exported.files.has(track));assert.equal(exported.files.has(unused),false);
});
