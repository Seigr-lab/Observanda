import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {insertWebsiteSource} from '../src/website-file-html.js';
import {searchWebsiteLibrary,validateWebsiteLibraryRows,websiteLibraryFacets} from '../src/website-file-library.js';

test('file picker searches compact permitted summaries, falls back to earlier saved heads, and binds the chosen revision',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-file-picker-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,maxRetries:8});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('File picker opened a research catalogue');
 const store=new WebsiteFileStore(workspace),notebookId=randomUUID(),asset=Buffer.from('public image'),sha=createHash('sha256').update(asset).digest('hex');
 async function put(label,preview,{recordId=randomUUID(),assets=[],visible=true,target='website'}={}){
  const provenance={workspaceId:workspace.vault.id,notebookId,recordId},sourceId=websiteSourceId({...provenance,target}),token=await store.beginSourceUpdate({sourceId,target});
  return store.putSource({sourceId,provenance,target,visible,title:label,html:'<h2>'+label+'</h2><p>'+preview+'</p><p hidden>Private hidden label</p>',assets,...(target==='pdf'?{pdfParts:{version:1}}:{})},{token});
 }
 const a=await put('Shared title','Thermal series'),b=await put('Shared title','Optical survey',{assets:[{path:'assets/'+sha+'.png',bytes:asset,contentType:'image/png'}]});
 await put('Private reference','unavailable',{visible:false});await put('Unrelated PDF','PDF-only',{target:'pdf'});
 const savedText=store.readText.bind(store),savedSource=store.source.bind(store);
 store.readText=()=>assert.fail('Search fetched content');store.source=()=>assert.fail('Indexed search read per-source heads');
 const first=await store.searchLibrary({search:'SHARED',limit:1}),second=await store.searchLibrary({search:'shared',limit:1,after:first.next});
 assert.deepEqual([first.items[0].id,second.items[0].id].sort(),[a.id,b.id].sort());
 const media=await store.searchLibrary({filter:'media'});assert.equal(media.items.length,1);assert.equal(media.items[0].id,b.id);assert.equal(media.items[0].preview,'Optical survey');
 const visible=()=>store.scope(()=>validateWebsiteLibraryRows(store,{items:media.items,generation:media.generation}));
 assert.deepEqual((await visible()).accepted,[b.id]);
 assert.equal((await store.searchLibrary({search:media.items[0].recordId})).items[0].id,b.id);
 assert.deepEqual((await store.searchLibrary({filter:'text'})).items.map(i=>i.id),[a.id]);
 assert.equal((await store.searchLibrary({search:'Private'})).items.length,0);assert.equal((await store.searchLibrary({search:'Unrelated PDF'})).items.length,0);
 store.readText=savedText;store.source=savedSource;
 const token=await store.beginSourceUpdate({sourceId:b.id});
 assert.deepEqual((await visible()).accepted,[]);
 assert.equal((await store.searchLibrary({filter:'media'})).items.length,0);
 await assert.rejects(store.previewSource({sourceId:b.id,sourceRevision:b.revision}),{code:'CONFLICT'});await store.cancelSourceUpdate({sourceId:b.id,token});
 await store.scope(()=>store.remove('.observanda/website-files/picker/'+b.id.slice(0,2)+'.json'),{write:true});
 const legacy=(await store.searchLibrary({filter:'media'})).items[0];assert.equal(legacy.id,b.id);assert.equal(legacy.preview,'Optical survey');
 assert.equal((await store.previewSource({sourceId:b.id,sourceRevision:b.revision})).preview,'Optical survey');
 const page=await store.create({name:'Site',html:'<!doctype html><html><head><title>Test</title></head><body><main><p>Before</p><p>After</p></main></body></html>'});
 await assert.rejects(store.insertSource(page.site.id,{sourceId:b.id,sourceRevision:a.revision,expectedRevision:page.site.revision,position:'start'}),{code:'CONFLICT'});
 const result=await store.insertSource(page.site.id,{sourceId:b.id,sourceRevision:b.revision,expectedRevision:page.site.revision,position:{before:1}});
 assert.match(result.html,/<p>Before<\/p><section data-observanda-source=.*Optical survey.*<\/section><p>After<\/p>/s);
 await put('Hidden again','',{recordId:legacy.recordId,visible:false});assert.equal((await store.searchLibrary({filter:'media'})).items.length,0);
 assert.deepEqual((await visible()).accepted,[]);
 await assert.rejects(store.previewSource({sourceId:b.id,sourceRevision:b.revision}),{code:'NOT_FOUND'});
});

test('search spans compact summaries in keyset order with a bounded result and no fragment or source-head reads',async()=>{
 const all=Array.from({length:1050},(_,i)=>i.toString(16).padStart(64,'0')),suffix=all.at(-1);
 const metadata=Object.fromEntries(all.map(id=>[id,{id,revision:id,title:id===suffix?'Volcanic ash':'Other',media:false,preview:'',tags:[],searchVersion:1}]));
 let directoryScans=0,shardReads=0;
 const store={absolute:s=>s,workspace:{root:'disposable',vault:{}},pendingSources:async()=>new Set(),control:async name=>{if(name.endsWith('/generation.json'))return null;shardReads++;return metadata;},source:()=>assert.fail('full source read')};
 const scope={member:async(_p,fn)=>{directoryScans++;return fn({async *entries(){for(const id of all)yield {name:id,directory:true};}});}};
 assert.deepEqual((await searchWebsiteLibrary(store,scope,{search:'volcanic',limit:1})).items.map(i=>i.id),[suffix]);
 const first=await searchWebsiteLibrary(store,scope,{limit:10}),next=await searchWebsiteLibrary(store,scope,{limit:10,after:first.next});
 assert.equal(first.items.length,10);assert.equal(next.items[0].id,all[10]);assert.equal(directoryScans,1);assert.equal(shardReads,3);
});

test('concurrent picker panes share one directory read and filtered results read only matching shards',async()=>{
 const projectId=randomUUID(),notebookId=randomUUID(),otherNotebook=randomUUID(),shards=new Map(),pending=new Set(),names=[];
 for(let i=0;i<16;i++){
  const prefix=i.toString(16).padStart(2,'0'),id=prefix+'0'.repeat(62);names.push(id);
  shards.set(prefix,{[id]:{id,revision:id,title:'Observation',notebookId:i===7?notebookId:otherNotebook,projectId,media:false,tags:[],searchVersion:1}});
 }
 let scans=0,shardReads=0;
 const store={absolute:s=>s,workspace:{root:'disposable',vault:{}},pendingSources:async()=>pending,control:async name=>{
  if(name.endsWith('/generation.json'))return 'same';shardReads++;return shards.get(name.split('/').pop().slice(0,2));
 }};
 const scope={member:async(_path,fn)=>{scans++;return fn({async *entries(){for(const name of names)yield {name,directory:true};}});}};
 await Promise.all([websiteLibraryFacets(store,scope,{kind:'project'}),websiteLibraryFacets(store,scope,{kind:'book'}),searchWebsiteLibrary(store,scope,{limit:1})]);
 assert.equal(scans,1);shardReads=0;
 const filtered=await searchWebsiteLibrary(store,scope,{projectId,notebookId,search:'obser'});
 assert.deepEqual(filtered.items.map(row=>row.id),[names[7]]);assert.equal(shardReads,1);
 pending.add(names[7]);assert.deepEqual((await searchWebsiteLibrary(store,scope,{notebookId})).items,[]);
});

test('source placement uses the editable page blocks without changing surrounding author bytes',()=>{
 const fragment={id:'a'.repeat(64),revision:'b'.repeat(64),html:'Selected copy'},marker='<section data-observanda-source="'+fragment.id+'" data-observanda-source-revision="'+fragment.revision+'">Selected copy</section>';
 const page='<html><body><main hidden>hidden</main><main><!-- retained --><p>one</p><style>.x{}</style><p>two</p></main><footer>end</footer></body></html>';
 assert.equal(insertWebsiteSource(page,{...fragment,position:'start'}),page.replace('<!-- retained -->',marker+'<!-- retained -->'));
 assert.equal(insertWebsiteSource(page,{...fragment,position:{before:1}}),page.replace('<p>two</p>',marker+'<p>two</p>'));
 assert.equal(insertWebsiteSource(page,{...fragment,position:'end'}),page.replace('<p>two</p>','<p>two</p>'+marker));
 assert.throws(()=>insertWebsiteSource(page,{...fragment,position:{before:2}}),{code:'INVALID'});
});
