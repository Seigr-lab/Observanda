import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {requestWriterWait} from '../src/writer-wait.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {WebsiteEditorStore} from '../src/website-editor-store.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteThemeExchange,WEBSITE_THEME_STAGE_LIFETIME} from '../src/website-theme-exchange.js';
import {WebsiteThemeResources} from '../src/website-theme-resources.js';
import {MediaStore} from '../src/media.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
function request(operation){const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;return requestWriterWait(req,res,operation);}
async function fixture(t){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-theme-native-')),vaults=[];t.after(async()=>{vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-theme-native-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function owner(name){const book=createNotebook(name),f=await encryptedFixture(path.join(directory,name),book);vaults.push(f.vault);const sites=new WebsiteSites(f.workspace),created=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Website'}),editor=new WebsiteEditor(f.workspace),websiteId=created.id;
  const run=(op,data={})=>editor.execute(op,{workspaceId:book.id,websiteId,...data}),change=(state,operations,commandId=randomUUID())=>run('change',{websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId,operations}),target=state=>({workspaceId:book.id,websiteId,websitePin:state.websitePin,draftId:state.draft?.id??null,draftRevision:state.draft?.revision??null});
  return {...f,book,websiteId,sites,run,change,target};
 }
 return {source:await owner('Source'),destination:await owner('Destination')};
}
// Faults occur after the real mutation adapter, before its transaction commits.
// The normal command owner writes its own receipt, checkpoint and history.
async function applyTheme(f,state,operation,{afterApply=null,commandId=randomUUID()}={}){
 if(!afterApply)return f.change(state,[operation],commandId);
 const original=WebsiteEditorStore.prototype.apply;
 WebsiteEditorStore.prototype.apply=async function(context,value,options){await original.call(this,context,value,options);if(value.type==='theme-apply'&&this.store.workspace.root===f.workspace.root)await afterApply(context);};
 try{return await f.change(state,[operation],commandId);}finally{WebsiteEditorStore.prototype.apply=original;}
}

test('native theme exchange preserves isolated design assets/fonts, rolls back, retries once and serializes discard through undo and reopen',{timeout:180000},async t=>{
 const {source:s,destination:d}=await fixture(t),image=await new MediaStore(s.workspace).import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#268070"/></svg>'),'image'),font=await new WorkspaceFonts(s.workspace).import(await readFile(new URL('../src/fonts/dm-sans.ttf',import.meta.url)),{embed:true}),templateId=randomUUID(),childId=randomUUID(),regionId=randomUUID(),sectionId=randomUUID(),textId=randomUUID();
 let source=await s.run('open');const appearance={...source.site.document.appearance,font:font.id,headingFont:'modern'},design={...source.site.document.website.design,regions:{definitions:[{id:regionId,name:'Reusable header',kind:'header',side:'left',width:240,sticky:false,background:null,color:null,padding:12,sections:[{id:randomUUID(),kind:'link',title:'Reference',show:true,href:'https://example.org/design',label:'Design',body:''}]}],assignments:[{target:'*',kind:'header',regionId}]}};
 source=await s.change(source,[{type:'settings',path:['document','appearance'],value:appearance},{type:'settings',path:['document','website','palette'],value:{accent:'#268070'}},{type:'settings',path:['document','website','design'],value:design},{type:'settings',path:['document','website','templates'],value:[{id:templateId,name:'Illustrated layout',sections:[{id:sectionId,kind:'asset',title:'Design image',show:true,assetId:image.id},{id:textId,kind:'text',title:'Original title',show:true,body:'Base wording'}]}]},{type:'append',collection:'assets',values:[{...image,caption:'Reusable image',alt:'Green square',transcript:''}]}]);
 source=await s.change(source,[{type:'settings',path:['document','website','presentation'],value:{media:[{scope:'template:'+templateId+'#'+sectionId,id:image.id,width:60,ratio:'square',fit:'cover',link:'',target:'_self'}],covers:[]}},{type:'template-derive',templateId,id:childId,name:'Derived layout'}]);
 const inherited=structuredClone(source.site.document.website.templates),sourceChild=inherited.find(v=>v.id===childId),childText=sourceChild.sections.find(v=>v.kind==='text');childText.title='Local child title';inherited.find(v=>v.id===templateId).sections.find(v=>v.kind==='text').body='Upstream revised wording';
 source=await s.change(source,[{type:'settings',path:['document','website','templates'],value:inherited}]);const sourceBaseline=sourceChild.templateLink.root;
 const exchange=new WebsiteThemeExchange(s.workspace);await new WorkspaceFonts(s.workspace).update(font.id,{embed:false,hidden:false});const refused=await exchange.prepare({...s.target(source),name:'Reusable design',templateIds:[childId],regionIds:[regionId]});assert.equal(refused.ready,false);await new WorkspaceFonts(s.workspace).update(font.id,{embed:true,hidden:false});
 const prepared=await exchange.prepare({...s.target(source),name:'Reusable design',templateIds:[childId],regionIds:[regionId]});assert.equal(prepared.ready,true);assert.deepEqual(prepared.links,['https://example.org/design']);const sourceStage=await new WebsiteThemeResources(s.workspace).read(prepared.id,prepared.sha256);const exportedJSON=JSON.stringify(sourceStage.manifest);for(const id of [s.book.id,s.websiteId,templateId,childId,regionId,sectionId,textId,image.id,font.id,sourceBaseline])assert.equal(exportedJSON.includes(id),false);
 // A different client can edit the source after review. The staged export
 // remains the exact reviewed revision, but still requires current access.
 source=await s.change(source,[{type:'settings',path:['document','website','palette'],value:{accent:'#994422'}}]);
 await assert.rejects(new WebsiteThemeExchange(s.workspace,{check:async()=>{throw Error('access revoked');}}).export(prepared),/access revoked/);
 let destination=await d.run('open');const page={id:randomUUID(),title:'Existing page',body:'Keep this page',share:false,sections:[]};destination=await d.change(destination,[{type:'append',collection:'pages',values:[page]}]);const before=destination,selection=structuredClone(destination.site.selection),research=(await d.workspace.outline()).etag,receive=new WebsiteThemeExchange(d.workspace),output=await exchange.export(prepared),imported=await receive.import(output.stream,d.target(destination));assert.equal(imported.ready,true);assert.deepEqual((await new WebsiteThemeResources(d.workspace).read(imported.id,imported.sha256)).manifest,sourceStage.manifest);assert.equal((await d.run('open')).draft.revision,before.draft.revision);assert.deepEqual(await new WorkspaceFonts(d.workspace).list(),[]);
 const operation={type:'theme-apply',id:imported.id,sha256:imported.sha256},themeCommand=randomUUID();
 await assert.rejects(applyTheme(d,before,operation,{commandId:themeCommand,afterApply:async()=>{throw Error('after-apply interruption');}}),/after-apply interruption/);assert.equal((await d.run('open')).draft.revision,before.draft.revision);assert.deepEqual(await new WorkspaceFonts(d.workspace).list(),[]);
 const stage=await new WebsiteThemeResources(d.workspace).read(imported.id,imported.sha256),createdId=stage.imported[0].id;assert.equal(stage.imported.length,1);
 let reached,release;const arrived=new Promise(r=>{reached=r;}),held=new Promise(r=>{release=r;});const applying=applyTheme(d,before,operation,{commandId:themeCommand,afterApply:async()=>{reached();await held;}});await arrived;let removed=false;const discarding=request(()=>receive.discard(imported)).then(()=>{removed=true;});await new Promise(r=>setTimeout(r,50));assert.equal(removed,false,'discard must wait for the applying writer');release();destination=await applying;await discarding;assert.deepEqual(await d.change(before,[operation],themeCommand),destination);
 assert.equal(destination.collections.assets.count,1);assert.equal(destination.collections.pages.count,1);assert.deepEqual(destination.site.selection,selection);assert.equal(destination.site.document.appearance.font,font.id);assert.equal((await new WorkspaceFonts(d.workspace).list()).length,1);assert.equal((await new MediaStore(d.workspace).get(createdId,{streamed:true})).kind,'image');assert.equal((await readdir(path.join(d.workspace.root,'.observanda','media'))).length,1);
 const movedTemplate=destination.site.document.website.templates.find(v=>v.name==='Illustrated layout'),movedChild=destination.site.document.website.templates.find(v=>v.name==='Derived layout');assert.equal(movedChild.templateLink.templateId,movedTemplate.id);assert.notEqual(movedChild.templateLink.root,sourceBaseline);assert.equal(movedChild.sections.find(v=>v.kind==='text').title,'Local child title');assert.equal(movedChild.sections.find(v=>v.kind==='text').body,'Base wording');const childMedia=destination.site.document.website.presentation.media.find(v=>v.scope.startsWith('template:'+movedChild.id+'#'));assert.equal(childMedia.width,60);assert.equal(childMedia.id,createdId);assert.equal(movedTemplate.sections[0].assetId,createdId);assert.notEqual(movedTemplate.id,templateId);
 const transition=value=>({draftId:value.draft.id,expectedRevision:value.draft.revision,commandId:randomUUID()});
 const undo=await d.run('undo',transition(destination));assert.equal(undo.collections.assets.count,0);assert.equal(undo.site.document.website.templates.length,0);assert.equal(undo.site.document.appearance.font,before.site.document.appearance.font);
 const redo=await d.run('redo',transition(undo));assert.equal(redo.collections.assets.count,1);assert.deepEqual(redo.site.document.website.templates,destination.site.document.website.templates);const saved=await d.run('save',transition(redo));assert.equal(saved.draft,null);assert.equal((await d.run('open')).site.document.website.templates[0].sections[0].assetId,createdId);assert.equal((await d.workspace.outline()).etag,research);
 const reopened=await d.run('open'),review=await d.run('template-review',{...d.target(reopened),target:'template:'+movedChild.id});assert.equal(review.changed,true);assert.equal(review.ready,true);assert.equal(review.conflicts.length,0);
 const accepted=await d.change(reopened,[{type:'template-accept',target:'template:'+movedChild.id,token:review.token,decisions:{}}]),updatedChild=accepted.site.document.website.templates.find(v=>v.id===movedChild.id);assert.equal(updatedChild.sections.find(v=>v.kind==='text').title,'Local child title');assert.equal(updatedChild.sections.find(v=>v.kind==='text').body,'Upstream revised wording');await d.run('save',transition(accepted));
 assert.equal((await d.sites.read(d.websiteId)).book.pages[0].body,page.body);assert.equal((await s.run('open')).draft.revision,source.draft.revision);
 // A closed browser leaves a registered stage. Expiry removes unapplied media
 // after rollback, while a committed theme keeps the media its draft owns.
 const fresh=await d.run('open'),abandoned=await receive.import((await exchange.export(prepared)).stream,d.target(fresh));
 await assert.rejects(applyTheme(d,fresh,{type:'theme-apply',id:abandoned.id,sha256:abandoned.sha256},{afterApply:async()=>{throw Error('abandoned');}}),/abandoned/);
 assert.equal((await readdir(path.join(d.workspace.root,'.observanda','media'))).length,2);assert.equal(await receive.prune({now:Date.now()+WEBSITE_THEME_STAGE_LIFETIME+1}),1);assert.equal((await readdir(path.join(d.workspace.root,'.observanda','media'))).length,1);
 const retained=await receive.import((await exchange.export(prepared)).stream,d.target(fresh));await applyTheme(d,fresh,{type:'theme-apply',id:retained.id,sha256:retained.sha256});assert.equal(await receive.prune({now:Date.now()+WEBSITE_THEME_STAGE_LIFETIME+1}),1);assert.equal((await readdir(path.join(d.workspace.root,'.observanda','media'))).length,2);assert.equal((await d.run('open')).collections.assets.count,2);
 await s.sites.write(s.websiteId,{},async(store,documents)=>{const head=await documents.head(s.websiteId);await documents.remove(s.websiteId,{expectedRevision:head.websiteRevision});});
 await assert.rejects(exchange.export(prepared),{code:'NOT_FOUND'});
 await exchange.discard(prepared);
});
