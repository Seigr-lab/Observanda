import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {websiteDocumentClient} from '../src/web/website-document-client.js';

const clone=value=>structuredClone(value),revision=n=>n.toString(16).padStart(64,'0');
function gate(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}
async function fixture(t){
 const workspaceId=randomUUID(),websiteId=randomUUID(),templateId=randomUUID(),draftId=randomUUID();
 const book={id:workspaceId,title:'Synthetic website',description:'',projects:[],notebooks:[],entries:[],pages:[],branding:[],appearance:{accent:'#112233'},themes:[],activeThemeId:null,website:{title:'Original',home:{title:'Home',showTitle:true,sections:[{id:'local',kind:'text',title:'',show:true,body:'Original'}],templateLink:{version:1,templateId,root:revision(1),sectionIds:[{templateId:'parent',pageId:'local'}]}},templates:[{id:templateId,name:'Parent',sections:[]}],design:{regions:{definitions:[],assignments:[]}},presentation:{media:[],covers:[]},assets:[],navigation:[],layouts:[],researchSources:[]}};
 const {assets,navigation,layouts,researchSources,...website}=clone(book.website);void assets;void navigation;void layouts;void researchSources;
 let result={websitePin:{researchSnapshotId:revision(10),websiteId,websiteRevision:revision(11)},draft:null,site:{id:websiteId,name:'Website',projects:[],selection:{version:1},document:{website,appearance:clone(book.appearance),themes:[],activeThemeId:null}},collections:Object.fromEntries(['pages','navigation','assets','layouts','branding'].map(name=>[name,{count:0}]))},generation=0;
 const state={book:clone(book),page:'website',storage:{contextId:'synthetic-owner'}},statuses=[],calls=[],hooks={},receipts=new Map();let selectionValue={version:1};
 const selection={snapshot:()=>clone(selectionValue),load:value=>{selectionValue=clone(value);},restore:value=>{selectionValue=clone(value);}};
 const client=websiteDocumentClient({state,selection,onStatus:value=>statuses.push(clone(value)),api:async(route,data)=>{
  const operation=route.split('/').at(-1);calls.push({operation,data:clone(data)});await hooks.before?.(operation,data);
  if(operation==='item')throw Object.assign(Error('Missing selected item'),{code:'NOT_FOUND'});
  if(operation==='open')return clone(result);
  const prior=receipts.get(data.commandId);if(prior)return clone(prior);
  if(operation==='change')for(const value of data.operations){
   if(value.type==='settings'){let target=result.site;for(const key of value.path.slice(0,-1))target=target[key];target[value.path.at(-1)]=clone(value.value);}
   if(value.type==='template-accept'){result.site.document.website.home.templateLink.root=revision(50);result.site.document.website.home.sections[0].body='Accepted parent text';}
   if(value.type==='theme-apply')result.site.document.website.design.regions.definitions.push({id:randomUUID(),name:'Imported shared region'});
  }
  if(['undo','redo'].includes(operation))result.site.document.appearance.accent=operation==='undo'?'#445566':'#778899';
  result.draft=operation==='save'?null:{id:draftId,revision:revision(++generation),dirty:true};
  const response=clone(result);receipts.set(data.commandId,response);await hooks.after?.(operation,data);return response;
 }});
 t.after(()=>client.stop());
 const open=async()=>{const opened=await client.open({websiteId,base:{book}});Object.assign(state,opened);selection.load(opened.site.selection);client.installed();};await open();
 return {client,state,statuses,calls,hooks,open,templateId,read:()=>clone(result)};
}

test('template mutation blocks later callbacks before flushing unsaved edits and until adoption',async t=>{
 const f=await fixture(t),first=gate(),firstEntered=gate(),second=gate(),secondEntered=gate();
 f.state.book.website.title='Unsaved before command';f.client.changed();
 f.hooks.before=async(operation,data)=>{if(operation!=='change')return;if(data.operations[0].type==='settings'){firstEntered.release();await first.promise;}else{secondEntered.release();await second.promise;}};
 const applying=f.client.perform([{type:'template-accept',target:'home',token:revision(20),decisions:{}}]);
 assert.equal(f.client.structuralBusy(),true);assert.equal(f.statuses.at(-1).structuralBusy,true);
 let resumed=false;const later=(async()=>{await f.client.waitForStructure();resumed=true;f.state.book.website.title='Later local title';f.client.changed();})();
 await firstEntered.promise;assert.equal(resumed,false);first.release();await secondEntered.promise;assert.equal(resumed,false);assert.equal(f.client.structuralBusy(),true);
 second.release();await applying;await later;
 assert.equal(f.client.structuralBusy(),false);assert.equal(f.state.book.website.home.templateLink.root,revision(50));assert.equal(f.state.book.website.home.sections[0].body,'Accepted parent text');
 assert.equal(f.state.book.website.title,'Later local title');assert.equal(f.read().site.document.website.title,'Unsaved before command');
 await f.client.flush();assert.equal(f.read().site.document.website.home.templateLink.root,revision(50));assert.equal(f.read().site.document.website.title,'Later local title');
});

test('lost theme response retains structural guard until exact request retry adopts imported definitions',async t=>{
 const f=await fixture(t);let lose=true;
 f.hooks.after=async(operation,data)=>{if(operation==='change'&&data.operations[0].type==='theme-apply'&&lose){lose=false;throw new TypeError('Reply lost');}};
 const operation={type:'theme-apply',id:randomUUID(),sha256:revision(70)};
 await assert.rejects(f.client.perform([operation]),/Reply lost/);assert.equal(f.client.structuralBusy(),true);assert.equal(f.statuses.at(-1).structuralBusy,true);
 let resumed=false;const waiter=f.client.waitForStructure().then(()=>{resumed=true;});await Promise.resolve();assert.equal(resumed,false);
 await f.client.flush();await waiter;assert.equal(f.client.structuralBusy(),false);assert.equal(f.state.book.website.design.regions.definitions.length,1);
 const calls=f.calls.filter(value=>value.operation==='change');assert.deepEqual(calls[0].data,calls[1].data);assert.equal(f.read().site.document.website.design.regions.definitions.length,1);
});

test('definite structural rejection releases editing and waiting callbacks without changing content',async t=>{
 const f=await fixture(t),entered=gate(),release=gate();f.hooks.before=async operation=>{if(operation==='change'){entered.release();await release.promise;throw Object.assign(Error('Rejected'),{code:'INVALID'});}};
 const result=f.client.perform([{type:'template-detach',target:'home'}]),rejected=assert.rejects(result,{code:'INVALID'});await entered.promise;
 const waiter=f.client.waitForStructure();release.release();await rejected;await waiter;assert.equal(f.client.structuralBusy(),false);assert.equal(f.state.book.website.home.templateLink.root,revision(1));
});

test('undo and redo keep the structural guard through acknowledged result adoption',async t=>{
 const f=await fixture(t);f.state.book.website.title='Draft';f.client.changed();await f.client.flush();
 for(const direction of ['undo','redo']){const entered=gate(),release=gate();f.hooks.before=async operation=>{if(operation===direction){entered.release();await release.promise;}};
  const changing=f.client.history(direction);assert.equal(f.client.structuralBusy(),true);await entered.promise;assert.equal(f.client.structuralBusy(),true);release.release();await changing;assert.equal(f.client.structuralBusy(),false);
  assert.equal(f.state.book.appearance.accent,direction==='undo'?'#445566':'#778899');
 }
});

test('ordinary save retains existing typing behavior without the structural guard',async t=>{
 const f=await fixture(t);f.state.book.website.title='Before save';f.client.changed();await f.client.flush();
 f.hooks.after=async operation=>{if(operation==='save'){assert.equal(f.client.structuralBusy(),false);f.state.book.website.title='Typed during save';f.client.changed();}};
 await f.client.save();assert.equal(f.state.book.website.title,'Typed during save');assert.equal(f.read().site.document.website.title,'Before save');assert.equal(f.client.isDirty(),true);
});

test('context replacement releases old waiters and refuses a queued structural command in the new owner',async t=>{
 const f=await fixture(t),applying=f.client.perform([{type:'theme-apply',id:randomUUID(),sha256:revision(70)}]),rejected=assert.rejects(applying,{name:'AbortError'}),waiter=f.client.waitForStructure();
 f.client.stop();f.state.storage.contextId='different-owner';await f.open();await rejected;await waiter;
 assert.equal(f.client.structuralBusy(),false);assert.equal(f.calls.filter(call=>call.operation==='change').length,0);assert.equal(f.state.book.website.design.regions.definitions.length,0);
});
