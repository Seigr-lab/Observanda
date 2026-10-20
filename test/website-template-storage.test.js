import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace,workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {backupCatalogue,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {rekeyCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteEditorStore,verifyWebsiteEditor} from '../src/website-editor-store.js';
import {WebsiteDocumentStore} from '../src/website-document-store.js';
import {catalogueFormat,catalogueRequiresWebsiteTemplateInheritance,configurationCatalogueFeatures,configurationCatalogueGeneration,requireWebsiteTemplateInheritance,restoreConfigurationCatalogueFormat} from '../src/catalogue-format.js';
import {newElement} from '../src/web/composition-tree.js';
const section=body=>({...newElement('text',randomUUID),body});
async function fixture(t,{research=false}={}){
 const temporary=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(temporary,'observanda-inherited-template-')),book=createNotebook('Inherited website layouts');
 if(research){book.projects=[{id:randomUUID(),title:'Research project',description:'',share:false,logoId:null}];book.notebooks=[{id:randomUUID(),projectId:book.projects[0].id,title:'Research notebook',share:false}];}
 const f=await encryptedFixture(directory,book),vaults=[f.vault];
 t.after(async()=>{for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),temporary);assert.ok(path.basename(directory).startsWith('observanda-inherited-template-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const sites=new WebsiteSites(f.workspace),created=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Independent design'}),id=created.id,editor=new WebsiteEditor(f.workspace);
 const execute=(operation,data={})=>editor.execute(operation,{workspaceId:book.id,websiteId:id,...data});
 const command=(state,operations)=>({websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId:randomUUID(),operations});
 const target=state=>({websitePin:state.websitePin,...(state.draft?{draftId:state.draft.id,draftRevision:state.draft.revision}:{})});
 const change=(state,operations)=>execute('change',command(state,operations));
 const save=state=>execute('save',{draftId:state.draft.id,expectedRevision:state.draft.revision,commandId:randomUUID()});
 const item=(state,key)=>execute('item',{...target(state),collection:'pages',key});
 return {...f,directory,book,vaults,sites,id,execute,command,target,change,save,item};
}
async function setup(f){
 const definition={id:randomUUID(),name:'Field notes',sections:[section('Original content')]},page={id:randomUUID(),title:'A page',body:'Independent page body',share:false,sections:[]};
 let state=await f.execute('open');state=await f.change(state,[{type:'settings',path:['document','website','templates'],value:[definition]},{type:'append',collection:'pages',values:[page]}]);
 const before=await f.workspace.catalogue(store=>catalogueFormat(store.db));assert.equal(catalogueRequiresWebsiteTemplateInheritance(before),false);
 state=await f.change(state,[{type:'template-link',target:'page:'+page.id,templateId:definition.id,mode:'replace'}]);
 assert.equal(catalogueRequiresWebsiteTemplateInheritance(await f.workspace.catalogue(store=>catalogueFormat(store.db))),true);return {definition,page,state};
}
test('linked website templates retain stable baselines, review conflicts and refuse dependent deletion',{timeout:120000},async t=>{
 const f=await fixture(t),start=await setup(f);let {state}=start;const {definition,page}=start,linked=(await f.item(state,page.id)).value,child=randomUUID();
 assert.notEqual(linked.sections[0].id,definition.sections[0].id);assert.equal(linked.share,false);assert.equal(linked.body,page.body);
 const detached=structuredClone(linked);delete detached.templateLink;await assert.rejects(f.change(state,[{type:'replace',collection:'pages',key:page.id,value:detached}]),{code:'INVALID'});
 state=await f.save(state);const historic=state.websitePin;
 state=await f.change(state,[{type:'template-derive',templateId:definition.id,id:child,name:'Derived field notes'}]);
 const local={...(await f.item(state,page.id)).value,sections:linked.sections.map(s=>({...s,body:'Local observation'}))};
 state=await f.change(state,[{type:'replace',collection:'pages',key:page.id,value:local}]);
 const definitions=structuredClone(state.site.document.website.templates);definitions[0].sections[0].body='Updated template content';definitions[0].sections[0].title='Updated heading';
 state=await f.change(state,[{type:'settings',path:['document','website','templates'],value:definitions}]);
 let review=await f.execute('template-review',{...f.target(state),target:'page:'+page.id});assert.equal(review.changed,true);assert.equal(review.ready,false);assert.ok(review.conflicts.some(c=>c.kind==='edit'));
 await assert.rejects(f.change(state,[{type:'template-accept',target:'page:'+page.id,token:'a'.repeat(64),decisions:{}}]),{code:'CONFLICT'});
 const stale=review.token;state=await f.change(state,[{type:'settings',path:['document','website','footer'],value:'Unrelated draft edit'}]);
 await assert.rejects(f.change(state,[{type:'template-accept',target:'page:'+page.id,token:stale,decisions:{}}]),{code:'CONFLICT'});
 review=await f.execute('template-review',{...f.target(state),target:'page:'+page.id});const decisions=Object.fromEntries(review.conflicts.map(c=>[c.id,'local']));
 const resolved=await f.execute('template-review',{...f.target(state),target:'page:'+page.id,decisions});assert.equal(resolved.ready,true);assert.equal(resolved.token,review.token);
 const command=f.command(state,[{type:'template-accept',target:'page:'+page.id,token:review.token,decisions}]);state=await f.execute('change',command);assert.deepEqual(await f.execute('change',command),state);
 let updated=(await f.item(state,page.id)).value;assert.equal(updated.sections[0].id,linked.sections[0].id);assert.equal(updated.sections[0].body,'Local observation');assert.equal(updated.sections[0].title,'Updated heading');assert.equal(updated.share,false);
 const next=await f.execute('template-review',{...f.target(state),target:'page:'+page.id});assert.equal(next.changed,false);
 const priorHead=state.draft.revision;await assert.rejects(f.change(state,[{type:'settings',path:['document','website','templates'],value:[]}]),{code:'INVALID'});assert.equal((await f.execute('open')).draft.revision,priorHead);
 // Updating a definition also maps local additions so the originating page does not duplicate them.
 const addition=section('Added locally');updated={...updated,sections:[...updated.sections,addition]};state=await f.change(state,[{type:'replace',collection:'pages',key:page.id,value:updated}]);
 state=await f.change(state,[{type:'template-update',target:'page:'+page.id,templateId:definition.id}]);assert.equal(state.site.document.website.templates[0].sections[0].id,definition.sections[0].id);assert.equal(state.site.document.website.templates[0].sections[0].body,'Local observation');
 updated=(await f.item(state,page.id)).value;const synchronized=await f.execute('template-review',{...f.target(state),target:'page:'+page.id});assert.equal(synchronized.changed,false);assert.equal(synchronized.sections.length,2);assert.equal(updated.templateLink.sectionIds.find(row=>row.pageId===addition.id)?.templateId,state.site.document.website.templates[0].sections[1].id);
 const childReview=await f.execute('template-review',{...f.target(state),target:'template:'+child});assert.equal(childReview.changed,true);
 state=await f.save(state);const reopened=await new WebsiteEditor(f.workspace).execute('open',{workspaceId:f.book.id,websiteId:f.id});assert.equal(reopened.draft,null);assert.deepEqual((await f.item(reopened,page.id)).value,updated);
 const old=await f.workspace.catalogue(store=>new WebsiteDocumentStore(store).read(f.id,historic));assert.equal(old.site.document.pages[0].sections[0].body,'Original content');assert.deepEqual(old.site.document.pages[0].templateLink,linked.templateLink);
 state=await f.change(reopened,[{type:'template-detach',target:'page:'+page.id},{type:'template-detach',target:'template:'+child}]);state=await f.change(state,[{type:'settings',path:['document','website','templates'],value:[]}]);
 assert.equal((await f.item(state,page.id)).value.templateLink,undefined);assert.equal((await f.item(state,page.id)).value.sections[0].body,'Local observation');await f.save(state);
 await f.workspace.catalogue(async store=>{await new WebsiteDocumentStore(store).verify();await verifyWebsiteEditor(store);});
});
test('inherited website baselines survive archive activation, fresh-key recovery and forged-root refusal',{timeout:180000},async t=>{
 const f=await fixture(t),start=await setup(f);let state=await f.save(start.state),value=(await f.item(state,start.page.id)).value;
 const second=await f.sites.change({workspaceId:f.book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Another owner'}),foreign=await f.workspace.catalogue(async store=>(await new WebsiteEditorStore(store).document(second.id)).document.root);
 await assert.rejects(f.change(state,[{type:'replace',collection:'pages',key:start.page.id,value:{...value,templateLink:{...value.templateLink,root:foreign}}}]),{code:'INVALID'});
 assert.equal((await f.execute('open')).draft,null);
 const descriptor=await f.workspace.readFile(await workspaceFile(f.workspace.root),'utf8');await verifyCatalogueArchive(f.workspace,JSON.parse(descriptor));
 const copyRoot=path.join(f.directory,'archive-copy');await mkdir(path.join(copyRoot,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(f.workspace.root)),'.observanda/access.json'])await copyFile(path.join(f.workspace.root,file),path.join(copyRoot,file));
 const db=await f.workspace.openCatalogue();try{await backupCatalogue(f.workspace.root,copyRoot,{connection:db});}finally{await db.close();}
 const header=JSON.parse((await readFile(path.join(copyRoot,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);assert.equal(header.version,15);assert.equal(catalogueRequiresWebsiteTemplateInheritance(header.catalogueVersion),true);
 const copied=new Workspace(copyRoot,f.vault);await verifyCatalogueArchive(copied,JSON.parse(descriptor));
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.directory,'new-device')})),vault=takeCreatedVault(access);f.vaults.push(vault);
 const recovered=new Workspace(path.join(f.directory,'recovered'),vault);await mkdir(path.join(recovered.root,'.observanda'),{recursive:true});await atomicWrite(path.join(recovered.root,'.observanda/access.json'),serialize(access));await recovered.writeFile(await workspaceFile(recovered.root,{secure:true}),descriptor);
 await rekeyCatalogue(f.workspace,recovered,JSON.parse(descriptor));await verifyCatalogueArchive(recovered,JSON.parse(descriptor));
 for(const owner of [copied,recovered]){const editor=new WebsiteEditor(owner),common={workspaceId:f.book.id,websiteId:f.id},opened=await editor.execute('open',common),row=await editor.execute('item',{...common,...f.target(opened),collection:'pages',key:start.page.id});assert.deepEqual(row.value,value);const review=await editor.execute('template-review',{...common,...f.target(opened),target:'page:'+start.page.id});assert.equal(review.changed,false);assert.equal(review.linked,true);}
});
test('template admission preserves independent catalogue features through restoration',async()=>{
 const mock=version=>({version,async all(){return[{version:this.version}];},async run(sql,value){if(sql.startsWith('UPDATE catalogue_format'))this.version=Math.max(this.version,value);},async get(){return null;}});
 for(const portability of [false,true])for(const permissions of [false,true])for(const sourceSelections of [false,true])for(const ownerDirectories of [false,true]){
  const before={website:3,staged:true,owners:2,publication:true,transfers:true,permissions,sourceSelections,nestedAttempts:true,ownerDirectories,portability},db=mock(configurationCatalogueGeneration(before));await requireWebsiteTemplateInheritance(db);assert.ok(db.version>3193);const features=configurationCatalogueFeatures(db.version);assert.equal(features.templateInheritance,true);for(const [key,value]of Object.entries(before))assert.equal(features[key]??false,value,key);
  const restored=mock(3);await restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
});

test('linking a research page creates only its admitted layout override',{timeout:90000},async t=>{
 const f=await fixture(t,{research:true}),start=await setup(f),project=f.book.projects[0],notebook=f.book.notebooks[0];let state=start.state;
 assert.ok(project&&notebook);const target='notebook:'+notebook.id;
 const unusedSource=randomUUID();state=await f.change(state,[{type:'source-selection',kind:'project',workspaceId:unusedSource,projectId:randomUUID(),share:false},{type:'source-selection',kind:'remove',workspaceId:unusedSource}]);
 await assert.rejects(f.change(state,[{type:'template-link',target:'notebook:'+randomUUID(),templateId:start.definition.id,mode:'replace'}]),{code:'INVALID'});
 state=await f.change(state,[{type:'template-link',target,templateId:start.definition.id,mode:'replace'}]);const layout=(await f.execute('item',{...f.target(state),collection:'layouts',key:target})).value;
 assert.equal(layout.target,target);assert.equal(layout.placement,'before');assert.equal(layout.templateLink.templateId,start.definition.id);assert.equal(layout.sections[0].body,'Original content');
 const review=await f.execute('template-review',{...f.target(state),target});assert.equal(review.linked,true);assert.equal(review.changed,false);await f.save(state);
});
