import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {componentOperation} from '../src/website-component-storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {renderComponentInstance} from '../src/website-file-component.js';
import {componentContext} from '../src/website-component-storage.js';
import {websiteStyleBook} from '../src/website-style-book.js';
import {websitePageLifecycle} from '../src/website-page-lifecycle.js';
import {websiteBreakpoints} from '../src/website-breakpoints.js';
import {defaultBreakpoints,layoutStart,layoutEnd,orderedLayoutLines} from '../src/web/website-breakpoint-model.js';

test('a typed title keeps its local value through a reviewed shared edit and an explicit slot migration',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-design-system-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:8});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Component design opened research data');
 const store=new WebsiteFileStore(workspace),id=randomUUID(),slotId=randomUUID();
 const initial='<html><head><title>Specimens</title></head><body><main><article><h2>Standard</h2><p>Observations</p></article></main></body></html>';
 let saved=await store.importFiles(id,{name:'Specimens',files:new Map([['index.html',initial],['style.css','']])});
 const op=(action,values={},apply=false)=>componentOperation(store,action,id,{expectedRevision:saved.site.revision,...values},apply);
 saved=await op('create',{name:'Research card',blockPath:'0/0'});
 const {items:[main]}=await op('list'),original=saved.html.match(/data-website-instance="([^"]+)"/)[1];
 const design={component:main.id,name:main.name,html:'<article><h2 data-website-slot="'+slotId+'">Standard</h2><p>Observations</p></article>',slots:[{id:slotId,name:'Heading',type:'text'}]};
 const edit=async d=>{const review=await op('review',d);saved=await op('update',{...d,reviewId:review.reviewId},true);return review;};
 await edit(design);saved=await op('customize',{instance:original,values:{[slotId]:'Transect 27'}});
 saved=await op('insert',{component:main.id,position:'end'});assert.ok(saved.html.includes('<h2>Standard</h2>'));assert.ok(saved.html.includes('<h2>Transect 27</h2>'));
 design.html=design.html.replace('Observations','Results');design.slots[0].name='Specimen';
 const renamed=await edit(design);assert.equal(renamed.instances,2);assert.equal(renamed.removedOverrides,0);
 assert.deepEqual(renamed.slots,[{before:'Heading',after:'Specimen',type:'text'}]);assert.equal(saved.html.match(/<p>Results<\/p>/g).length,2);
 assert.ok(saved.html.includes('<h2>Transect 27</h2>'));const old=saved.site.revision;
 const removing={...design,slots:[],html:design.html.replace(' data-website-slot="'+slotId+'"','')};
 const plan=await op('review',removing);assert.equal(plan.removedOverrides,1);
 await assert.rejects(op('update',{...removing,name:'Different',reviewId:plan.reviewId},true),{code:'CONFLICT'});assert.equal((await store.open(id)).site.revision,old);
 saved=await op('update',{...removing,reviewId:plan.reviewId},true);assert.equal(saved.html.match(/<h2>Standard<\/h2>/g).length,2);
});

test('a reusable frame keeps a lab entry under its original grant through editing, duplication, withdrawal and detachment',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-permitted-frame-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:8});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Frame opened research');
 const store=new WebsiteFileStore(workspace),site=randomUUID(),field=randomUUID(),sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
 const html='<html><head><title>Report</title></head><body><main><article><h2>Report</h2></article></main></body></html>';
 let s=await store.importFiles(site,{name:'Frames',files:new Map([['index.html',html],['style.css','']])});
 const op=(name,values)=>componentOperation(store,name,site,{expectedRevision:s.site.revision,...values},true);
 s=await op('create',{name:'Report frame',blockPath:'0/0'});const {items:[main]}=await op('list');
 const definition={component:main.id,name:main.name,html:'<article><h2>Report</h2><div data-website-slot="'+field+'"></div></article>',slots:[{id:field,name:'Results',type:'entry'}]};
 const change=async d=>{const p=await op('review',d);s=await op('update',{...d,reviewId:p.reviewId});};
 await change(definition);
 const grant=async (visible,content='')=>{const token=await store.beginSourceUpdate({sourceId});return store.putSource({sourceId,visible,html:content,title:'Record'},{token});};
 const source=await grant(true,'<p data-observanda-part="text">Permitted measurement</p>');
 s=await store.insertSource(site,{expectedRevision:s.site.revision,sourceId,sourceRevision:source.revision,position:'end'});
 s=await op('wrap',{component:main.id,field,sourceId,sourceRevision:source.revision,blockPath:'0/1'});
 assert.match(s.html,/data-website-entry-field="[^"]+"><section data-observanda-source=/);
 const immutable=await op('main',{component:main.id});assert.ok(!immutable.html.includes('Permitted measurement'));assert.ok(!immutable.html.includes(sourceId));
 await change({...definition,html:definition.html.replace('Report</h2>','Traceability</h2>')});assert.ok(s.html.includes('Permitted measurement'));
 await assert.rejects(op('review',{component:main.id,name:main.name,html:'<article><h2>Report</h2></article>',slots:[]}),{code:'WEBSITE_COMPONENT_ENTRY_FIELD'});
 for(const includeEntries of [true,false]){
  const destination=includeEntries?'copy/with.html':'copy/frame.html',opt={action:'duplicate',path:'index.html',expectedRevision:s.site.revision,destination,title:'Copy',includeEntries};
  const p=await websitePageLifecycle(store,site,opt);s=await websitePageLifecycle(store,site,{...opt,reviewId:p.reviewId},true);
  assert.equal(s.html.includes('Permitted measurement'),includeEntries);assert.equal(s.html.includes(sourceId),includeEntries);
 }
 await grant(false);s=await store.open(site);assert.ok(!s.html.includes('Permitted measurement'));assert.ok(!(await store.open(site,{path:'copy/with.html'})).html.includes('Permitted measurement'));
 const row=await store.scope(async()=>(await store.current(site,s.site.revision)).pages.find(p=>p.path==='index.html').instances.find(i=>i.entries));
 s=await op('detach',{instance:row.id});assert.ok(!s.html.includes(row.id));assert.ok(s.html.includes(sourceId));
 await grant(true,'<p data-observanda-part="text">New permitted value</p>');s=await store.open(site);assert.ok(s.html.includes('New permitted value'));
 assert.ok(!(await op('main',{component:main.id})).html.includes('New permitted value'));
});

test('one shared edit preserves 100 independently titled image cards, propagates nested revisions and refuses private or cyclic definitions',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-component-boards-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:8});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Design system opened research data');
 const store=new WebsiteFileStore(workspace),id=randomUUID(),key=randomUUID(),photo=randomUUID(),nested=randomUUID(),variant=randomUUID();
 const a='pictures/'+randomUUID()+'.png',b='pictures/'+randomUUID()+'.png';
 const html=body=>'<html><head><title>Board</title></head><body><main>'+body+'</main></body></html>';
 let page=await store.importFiles(id,{name:'Lab',files:new Map([['index.html',html('<p>Ready</p>')],['style.css','']]),draftFiles:new Map([['working.html',html('<p>Private summary</p>')],['draft-styles.css','']])});
 page=await store.save(id,{expectedRevision:page.site.revision,css:'',html:html('<article><h2>Sample</h2><img alt="Plate" src="'+a+'"></article><aside>Calibration</aside><img alt="Alternative plate" src="'+b+'">'),receivePictures:async function*(){yield {name:a,bytes:Buffer.from('plate-a')};yield {name:b,bytes:Buffer.from('plate-b')};}});
 const op=(action,opts={})=>componentOperation(store,action,id,{expectedRevision:page.site.revision,...opts},true);
 const edit=async d=>{const plan=await op('review',d);page=await op('update',{...d,reviewId:plan.reviewId});return plan;};
 page=await op('create',{name:'Unreleased design',blockPath:'0/0',path:'working.html'});
 const hidden=(await op('list',{path:'working.html'})).items.find(c=>c.name==='Unreleased design');
 await assert.rejects(op('choices',{type:'component',component:hidden.id}),{code:'NOT_FOUND'});
 assert.ok(!(await op('list')).items.some(c=>c.id===hidden.id));
 page=await op('create',{name:'Calibration',blockPath:'0/1'});
 page=await op('create',{name:'Specimen',blockPath:'0/0'});
 const {items}=await op('list'),card=items.find(c=>c.name==='Specimen'),child=items.find(c=>c.name==='Calibration');
 const token=await websiteStyleBook(store,id,{action:'create',expectedRevision:page.site.revision,path:'index.html',name:'Emphasis',group:'color',rules:{normal:{color:'#233388'}}});page=token;
 const visual='ow-visual-'+randomUUID(),css=px=>'\n/* Observanda appearance '+visual+' */\n.'+visual+' {font-size: '+px+'px;}';
 const main={component:card.id,name:card.name,html:'<article class="'+visual+'"><h2 data-website-slot="'+key+'">Sample</h2><img data-website-slot="'+photo+'" alt="Plate" src="'+a+'"><div data-website-slot="'+nested+'"></div></article>',
  slots:[{id:key,name:'Name',type:'text'},{id:photo,name:'Picture',type:'image'},{id:nested,name:'Calibration',type:'component',component:child.id}],variants:[{id:variant,name:'Emphasized',style:token.modifiedStyleId}],css:css(18)};
 await edit(main);
 // Seed an existing saved board in one transaction. The following public
 // review, customization and update use the same entry points as the editor.
 page=await store.scope(async()=>{
  const m=await store.current(id,page.site.revision),ctx=componentContext(m),definition=ctx.components.get(card.id),p=m.pages.find(p=>p.path==='index.html');
  const instances=Array.from({length:100},(_,i)=>({id:randomUUID(),component:card.id,values:{[key]:'Sample '+i,[photo]:{src:i%2?a:b,alt:'Micrograph '+i}},...(i%2?{variant}:{})}));
  const output=html(instances.map(instance=>renderComponentInstance(definition,instance,p,ctx)).join(''));
  const file=await store.siteFile(id,p.path,output);
  return store.present(await store.commit({...m,pages:m.pages.map(row=>row===p?{...p,instances,pictures:[a,b]}:row),files:m.files.map(f=>f.name===p.path?file:f)}),'index.html');
 },{write:true});
 main.css=css(26);const update=await edit(main);
 assert.equal(update.instances,100);assert.equal(update.pages,1);assert.equal(update.removedOverrides,0);
 for(let i=0;i<100;i++){assert.ok(page.html.includes('<h2>Sample '+i+'</h2>'));assert.ok(page.html.includes('alt="Micrograph '+i+'"'));}
 assert.equal(page.html.match(/ow-token-/g).length,50);assert.equal(page.html.match(/<aside>Calibration<\/aside>/g).length,100);
 const childPlan=await edit({component:child.id,name:child.name,html:'<aside>Traceable calibration</aside>'});
 assert.equal(childPlan.instances,100);assert.equal(page.html.match(/Traceable calibration/g).length,100);
 const cycle=randomUUID(),pinned=page.site.revision;
 await assert.rejects(op('review',{component:child.id,name:child.name,html:'<aside><div data-website-slot="'+cycle+'"></div></aside>',slots:[{id:cycle,name:'Back to card',type:'component',component:card.id}]}),{code:'INVALID'});
 await assert.rejects(op('review',{...main,slots:main.slots.map(s=>s.type==='component'?{...s,component:hidden.id}:s)}),{code:'INVALID'});
 await assert.rejects(op('review',{...main,css:'',slots:[],html:'<article data-observanda-source="unowned">Private contents</article>'}),{code:'INVALID'});
 const used=page.html.match(/data-website-instance="([^"]+)"/)[1];
 await assert.rejects(op('customize',{instance:used,values:{[photo]:{src:'private/author-notes.png',alt:'Reading'}}}),{code:'INVALID'});
 assert.equal((await store.open(id)).site.revision,pinned);
 page=await op('detach',{instance:used});const before=page.html.match(/data-website-component-style="([^"]+)"/)[1];main.css=css(32);await edit(main);
 assert.equal(page.html.match(new RegExp(before,'g')).length,3);assert.equal(page.html.match(/data-website-instance=/g).length,99);
 const wide={id:randomUUID(),name:'Lab display',min:1100,max:null},ranges=[...defaultBreakpoints(),wide];
 const changeRanges=async next=>{
  const proposal={expectedRevision:page.site.revision,ranges:next};
  const plan=await websiteBreakpoints(store,id,proposal);page=await websiteBreakpoints(store,id,{...proposal,reviewId:plan.reviewId},true);return plan;
 };
 await changeRanges(ranges);
 const layout='ow-layout-'+randomUUID(),rule=orderedLayoutLines(new Map([[wide.id,'gap: 24px;']]),layout,ranges);
 main.html=main.html.replace(visual,visual+' '+layout);main.css=css(32)+layoutStart(layout)+rule+layoutEnd(layout);await edit(main);
 const activeStyle=html=>html.match(/<article\b(?=[^>]*data-website-instance=)[^>]*data-website-component-style="([a-f0-9]{64})"/)[1];
 const revision=activeStyle(page.html);
 const changed=await changeRanges([...defaultBreakpoints(),{...wide,min:1200}]);
 assert.equal(changed.changed,1);assert.ok(changed.files.includes(card.name));
 assert.match((await op('main',{component:card.id})).css,/min-width: 1200px/);
 assert.notEqual(activeStyle(page.html),revision);
 assert.equal(page.html.match(/data-website-instance=/g).length,99);assert.ok(page.html.includes('Sample 99'));
});
