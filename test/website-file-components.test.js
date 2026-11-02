import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {componentOperation} from '../src/website-component-storage.js';
import {contentBuffer} from '../src/file-content.js';

const page=body=>'<!doctype html><html><head><title>Site</title></head><body><main>'+body+'</main></body></html>';
async function fixture(t,start){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-components-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,force:true,maxRetries:8});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Component editor opened research');
 const store=new WebsiteFileStore(workspace),id=randomUUID();
 const opened=await store.importFiles(id,{name:'Fixture',files:new Map([['index.html',page(start)],['pages/next.html',page('<p>End</p>')],['style.css','']]),
  draftFiles:new Map([['private.html',page('<p>Draft</p>')],['draft-styles.css','']])});
 const op=(name,revision,opts={})=>componentOperation(store,name,id,{expectedRevision:revision,...opts});
 return {workspace,store,id,op,opened};
}
test('a private main propagates to deep public and draft pages in one pinned revision, preserves scoped IDs and detaches a single instance',async t=>{
 const {store,id,op,opened}=await fixture(t,'<section><h2 id="lead">Old title</h2><p aria-labelledby="lead"><a href="#lead">Top</a> <a href="pages/next.html">Next</a></p></section><aside>Keep me</aside>');
 let state=await op('create',opened.site.revision,{blockPath:'0/0',name:'Main name stays private'});
 const main=(await op('list',state.site.revision,{query:'stays'})).items[0],frag=(await op('main',state.site.revision,{component:main.id})).html;
 assert.match(state.html,/id="lead"/);assert.doesNotMatch(state.html,/Main name stays private/);
 state=await op('insert',state.site.revision,{component:main.id,path:'pages/next.html',blockPath:'0/0',position:'before'});
 assert.match(state.html,/<section data-website-instance="([\da-f-]+)"><h2 id="wc-\1-lead">/);
 assert.match(state.html,/href="next.html"/);assert.match(state.html,/<\/section><p>End/);
 const copy=/data-website-instance="([^"]+)"/.exec(state.html)[1];assert.ok(state.html.includes('aria-labelledby="wc-'+copy+'-lead"'));
 state=await op('insert',state.site.revision,{component:main.id,path:'private.html',position:'end'});
 const stale=state.site.revision;let commits=0;const commit=store.commit.bind(store);store.commit=async(...args)=>{commits++;return commit(...args);};
 state=await op('update',stale,{component:main.id,name:main.name,html:frag.replace('Old title','Edited title')});assert.equal(commits,1);
 for(const path of ['index.html','pages/next.html','private.html'])assert.match((await store.open(id,{path})).html,/Edited title/);
 await assert.rejects(op('insert',stale,{component:main.id,position:'end'}),{code:'CONFLICT'});
 const unchanged=state.site.revision;await assert.rejects(store.save(id,{expectedRevision:unchanged,html:state.html.replace('Edited title','Rogue edit'),css:''}),{code:'CONFLICT'});
 state=await store.save(id,{expectedRevision:unchanged,html:state.html.replace('Keep me','Authored layout'),css:''});
 state=await op('detach',state.site.revision,{path:'pages/next.html',instance:copy});assert.doesNotMatch(state.html,/data-website-instance/);
 state=await op('update',state.site.revision,{component:main.id,name:main.name,html:frag.replace('Old title','Latest')});
 const result=await store.export(id,{expectedRevision:state.site.revision});
 assert.deepEqual([...result.files.keys()].sort(),['index.html','pages/next.html','style.css']);
 const home=(await contentBuffer(result.files.get('index.html'))).toString(),other=(await contentBuffer(result.files.get('pages/next.html'))).toString();
 assert.match(home,/Latest/);assert.match(home,/Authored layout/);assert.match(other,/Edited title/);assert.doesNotMatch(other,/Latest/);
});
test('component capture and insertion refuse protected subtrees and copied consent assets even after revocation',async t=>{
 const {store,id,workspace,op,opened}=await fixture(t,'<section><p>Safe</p></section>');
 const blob=Buffer.from('consented material'),sha=createHash('sha256').update(blob).digest('hex'),asset='assets/'+sha+'.png';
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
 const token=await store.beginSourceUpdate({sourceId});const allowed=await store.putSource({sourceId,visible:true,title:'Research',html:'<h2 data-observanda-part="title">Protected</h2><img src="'+asset+'">',assets:[{path:asset,bytes:blob,contentType:'image/png'}]},{token});
 let state=await store.insertSource(id,{expectedRevision:opened.site.revision,sourceId,sourceRevision:allowed.revision,position:'end'});
 for(const blockPath of ['0','0/1','0/1/0'])await assert.rejects(op('create',state.site.revision,{blockPath,name:'Forbidden'}),{code:'INVALID'});
 state=await op('create',state.site.revision,{blockPath:'0/0',name:'Safe'});const main=(await op('list',state.site.revision)).items[0];const pin=state.site.revision;
 for(const html of ['<figure><img src="'+asset+'"></figure>','<section style="background:u\\72l(secret)">X</section>','<a href="/api/session">X</a>','<section><template>Secret</template></section>','<section data-observanda-part="title">X</section>','<section><a href="private.html">Draft</a></section>','<section><script>1</script></section>','<p aria-describedby="unknown">X</p>']){
  await assert.rejects(op('update',pin,{component:main.id,name:main.name,html}),{code:'INVALID'});
 }
 await assert.rejects(op('insert',pin,{component:main.id,position:'after',blockPath:'0/1/0'}),{code:'INVALID'});
 assert.equal(await store.siteVersion(id),pin);
 const withdraw=await store.beginSourceUpdate({sourceId});await assert.rejects(op('main',pin,{component:main.id}),{code:'CONFLICT'});
 await store.putSource({sourceId,title:'Withdrawn',visible:false},{token:withdraw});
 state=await store.open(id);assert.doesNotMatch(state.html,/Protected|img src=/);
 assert.equal((await op('list',state.site.revision)).items.length,1);assert.doesNotMatch((await op('main',state.site.revision,{component:main.id})).html,/Protected|assets\//);
});
test('uploaded pictures use relative site paths, survive only privately with the main, and draft mains stay private',async t=>{
 const {store,id,op,opened}=await fixture(t,'<section><p>Picture</p></section>'),picture='pictures/'+randomUUID()+'.png';
 let state=await store.save(id,{expectedRevision:opened.site.revision,path:'index.html',html:page('<figure><img alt="Field" src="'+picture+'"></figure>'),css:'',
  receivePictures:async function*(){yield {name:picture,bytes:Buffer.from('fixture picture')};}});
 state=await op('create',state.site.revision,{blockPath:'0/0',name:'Picture card'});
 const main=(await op('list',state.site.revision)).items[0],original=/data-website-instance="([^"]+)"/.exec(state.html)[1];
 state=await op('detach',state.site.revision,{instance:original});
 state=await store.save(id,{expectedRevision:state.site.revision,html:page('<p>Public</p>'),css:''});
 assert.equal((await store.export(id,{expectedRevision:state.site.revision})).files.has(picture),false);
 await assert.rejects(store.file(id,picture,{revision:state.site.revision}),{code:'NOT_FOUND'});
 state=await op('insert',state.site.revision,{component:main.id,path:'pages/next.html',position:'after',blockPath:'0/0'});assert.ok(state.html.includes('src="../'+picture+'"'));
 assert.equal((await contentBuffer((await store.export(id,{expectedRevision:state.site.revision})).files.get(picture))).toString(),'fixture picture');
 state=await op('create',state.site.revision,{path:'private.html',blockPath:'0/0',name:'Draft main'});const draft=(await op('list',state.site.revision,{path:'private.html',query:'Draft'})).items[0];
 assert.equal((await op('list',state.site.revision,{query:'Draft'})).total,0);
 await assert.rejects(op('insert',state.site.revision,{component:draft.id,position:'end'}),{code:'NOT_FOUND'});
});
