import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newElement} from '../src/web/composition-tree.js';
import {validSections} from '../src/web/website-model.js';
import {plainRichText} from '../src/web/rich-text-model.js';
import {createTemplateUse,previewTemplateUpdate,sourceTemplateUpdate,snapshotTemplateUse,placeTemplateMedia,validTemplateLink,validTemplateSnapshot} from '../src/web/website-template-inheritance.js';

const root='a'.repeat(64),nextRoot='b'.repeat(64),templateId=randomUUID();
const section=(id,kind='text',extra={})=>({...newElement(kind,()=>id),...extra});
const snapshot=(sections,media=[])=>({sections,media});
const linked=source=>createTemplateUse({templateId,root,source,makeId:(()=>{let i=0;return()=>`local_${++i}`;})()});
const update=(use,base,current,incoming,options={})=>previewTemplateUpdate({link:use.link,base,current,incoming,root:nextRoot,makeId:(()=>{let i=0;return()=>`added_${++i}`;})(),...options});
const localSnapshot=use=>snapshot(structuredClone(use.sections),structuredClone(use.media));
const decisions=(preview,value)=>Object.fromEntries(preview.conflicts.map(conflict=>[conflict.id,value]));
const media=(sectionId,id,extra={})=>({sectionId,id,width:100,ratio:'original',fit:'contain',link:'',target:'_self',...extra});

test('linked layout copies nested IDs and scopes while unrelated settings and original editions stay unchanged',()=>{
 const file=randomUUID(),base=snapshot([section('outer','container'),section('picture','asset',{parentId:'outer',assetId:file})],[media('picture',file,{width:60,caption:'Pinned image'})]);
 const original=structuredClone(base),use=linked(base);
 assert.equal(use.sections[1].parentId,use.sections[0].id);assert.equal(use.media[0].sectionId,use.sections[1].id);
 assert.ok(validTemplateLink(use.link));assert.ok(validTemplateSnapshot(localSnapshot(use)));
 assert.deepEqual(base,original);
});

test('snapshot and placement preserve per-use media without copying covers or changing another page',()=>{
 const file=randomUUID(),other=randomUUID(),sections=[section('picture','asset',{assetId:file})],cover={entryId:randomUUID(),attachmentId:file};
 const website={presentation:{covers:[cover],media:[{...media('picture',file),scope:'template:'+templateId+'#picture'},{...media('other',other),scope:'home#other'}]}};
 for(const item of website.presentation.media)delete item.sectionId;
 const saved=structuredClone(website),source=snapshotTemplateUse(website,'template:'+templateId,sections),use=linked(source);
 const placed=placeTemplateMedia(website,'page:'+other,localSnapshot(use));
 assert.equal(placed.length,3);assert.equal(placed[2].scope,'page:'+other+'#'+use.sections[0].id);
 assert.deepEqual(website,saved);assert.deepEqual(website.presentation.covers,[cover]);
 assert.deepEqual(snapshotTemplateUse({presentation:{media:placed}},'page:'+other,use.sections),localSnapshot(use));
 const replaced=placeTemplateMedia({presentation:{media:placed}},'page:'+other,snapshot([]));
 assert.equal(replaced.length,2);assert.deepEqual(replaced,saved.presentation.media);
});

test('independent text and style edits merge and input snapshots remain immutable',()=>{
 const base=snapshot([section('text','text',{body:'Base',style:{width:'full',surface:'none',align:'start',space:'normal',color:'#111111'}})]),use=linked(base),current=localSnapshot(use),incoming=structuredClone(base);
 current.sections[0].body='My local writing';incoming.sections[0].style.color='#223344';
 const before={base:structuredClone(base),current:structuredClone(current),incoming:structuredClone(incoming),link:structuredClone(use.link)},preview=update(use,base,current,incoming);
 assert.equal(preview.ready,true);assert.equal(preview.sections[0].body,'My local writing');assert.equal(preview.sections[0].style.color,'#223344');
 assert.equal(preview.sections[0].id,use.sections[0].id);assert.equal(preview.link.root,nextRoot);assert.equal(use.link.root,root);
 assert.deepEqual({base,current,incoming,link:use.link},before);
});

test('same-field conflicts keep local edits until explicitly decided and stable IDs survive source updates',()=>{
 const base=snapshot([section('text','text',{body:'Base'})]),use=linked(base),current=localSnapshot(use),incoming=structuredClone(base);
 current.sections[0].body='Local';incoming.sections[0].body='Parent';const pending=update(use,base,current,incoming);
 assert.equal(pending.ready,false);assert.equal(pending.sections[0].body,'Local');assert.equal(pending.conflicts[0].kind,'edit');
 const kept=update(use,base,current,incoming,{decisions:decisions(pending,'local')}),accepted=update(use,base,current,incoming,{decisions:decisions(pending,'template')});
 assert.equal(kept.ready,true);assert.equal(kept.sections[0].body,'Local');assert.equal(accepted.sections[0].body,'Parent');
 const published=sourceTemplateUpdate({link:use.link,current:snapshot([...current.sections,section('local_extra')]),template:base,makeId:()=> 'new_parent'});
 assert.deepEqual(published.sections.map(item=>item.id),['text','new_parent']);assert.equal(published.sections[0].body,'Local');
 assert.equal(update(use,base,current,incoming,{decisions:{stale:'template'}}).ready,false);
});

test('nested parent and local insertions combine with upstream reordering without shared IDs',()=>{
 const base=snapshot([section('group','container'),section('a','text',{parentId:'group'}),section('b','text',{parentId:'group'})]),use=linked(base),current=localSnapshot(use);
 current.sections.splice(2,0,section('local_note','text',{parentId:use.sections[0].id,body:'Keep me'}));
 const incoming=snapshot([base.sections[0],base.sections[2],base.sections[1],section('new','text',{parentId:'group'})]),preview=update(use,base,current,incoming);
 // Conflicting relative positions are a visible order decision, never dropped text.
 assert.equal(preview.sections.find(item=>item.id==='local_note').body,'Keep me');assert.ok(validSections(preview.sections));
 const ready=preview.ready?preview:update(use,base,current,incoming,{decisions:decisions(preview,'template')});
 assert.ok(ready.ready);assert.ok(ready.sections.some(item=>item.id==='local_note'));
 assert.equal(ready.sections.find(item=>item.id==='added_1').parentId,use.sections[0].id);
 const ids=ready.sections.map(item=>item.id);assert.ok(ids.indexOf(use.sections[2].id)<ids.indexOf(use.sections[1].id));
});

test('upstream removal of an edited nested branch requires a decision; retaining it detaches removed correspondence',()=>{
 const base=snapshot([section('group','container'),section('a','text',{parentId:'group',body:'Base'})]),use=linked(base),current=localSnapshot(use);
 current.sections[1].body='Local evidence';current.sections.push(section('local_note','text',{parentId:current.sections[0].id,body:'Independent child'}));
 const incoming=snapshot([]),pending=update(use,base,current,incoming);
 assert.equal(pending.ready,false);assert.ok(pending.sections.some(item=>item.body==='Local evidence'));assert.ok(validSections(pending.sections));
 const keep=update(use,base,current,incoming,{decisions:decisions(pending,'local')});assert.equal(keep.ready,true);assert.equal(keep.sections.length,3);assert.deepEqual(keep.link.sectionIds,[]);
 let accept=update(use,base,current,incoming,{decisions:decisions(pending,'template')});
 if(!accept.ready)accept=update(use,base,current,incoming,{decisions:{...decisions(pending,'template'),...decisions(accept,'template')}});
 assert.equal(accept.ready,true);assert.equal(accept.sections.length,0);
});

test('deleted local inherited sections stay deleted on later unchanged updates',()=>{
 const base=snapshot([section('a'),section('b')]),use=linked(base),current=snapshot([use.sections[0]]),first=update(use,base,current,base);
 assert.equal(first.ready,true);assert.equal(first.sections.length,1);assert.equal(first.link.sectionIds.length,2);
 const second=previewTemplateUpdate({link:first.link,base,current:localSnapshot(first),incoming:base,root:'c'.repeat(64)});
 assert.equal(second.ready,true);assert.equal(second.sections.length,1);
 const incoming=structuredClone(base);incoming.sections[1].body='Changed parent';const pending=update(use,base,current,incoming);
 assert.equal(pending.ready,false);assert.equal(pending.conflicts[0].kind,'deletion');assert.equal(pending.sections.length,1);
});

test('reference changes never silently retarget media or broaden research selection',()=>{
 const first=randomUUID(),second=randomUUID(),project=randomUUID(),base=snapshot([section('asset','asset',{assetId:first}),section('feed','records',{filter:{projectId:project,tag:'safe',limit:3}})]),use=linked(base),current=localSnapshot(use),incoming=structuredClone(base);
 incoming.sections[0].assetId=second;delete incoming.sections[1].filter;
 const pending=update(use,base,current,incoming);assert.equal(pending.ready,false);assert.equal(pending.conflicts.length,2);assert.ok(pending.conflicts.every(item=>item.kind==='source'));
 assert.equal(pending.sections[0].assetId,first);assert.equal(pending.sections[1].filter.projectId,project);
 const keep=update(use,base,current,incoming,{decisions:decisions(pending,'local')});assert.equal(keep.ready,true);assert.equal(keep.sections[0].assetId,first);
 const accept=update(use,base,current,incoming,{decisions:decisions(pending,'template')});assert.equal(accept.sections[0].assetId,second);assert.equal(accept.sections[1].filter,undefined);
 const addition=update(use,base,current,snapshot([...base.sections,section('all','records')]));assert.equal(addition.ready,false);assert.equal(addition.sections.length,2);
 assert.ok(!Object.hasOwn(accept,'researchSources'));assert.ok(!Object.hasOwn(accept,'share'));
});

test('per-use media changes merge independently and conflicting captions remain reviewable',()=>{
 const file=randomUUID(),base=snapshot([section('asset','asset',{assetId:file})],[media('asset',file,{width:70,caption:'Base'})]),use=linked(base),current=localSnapshot(use),incoming=structuredClone(base);
 current.media[0].caption='Local';incoming.media[0].width=90;const automatic=update(use,base,current,incoming);
 assert.equal(automatic.ready,true);assert.equal(automatic.media[0].caption,'Local');assert.equal(automatic.media[0].width,90);
 incoming.media[0].caption='Parent';const pending=update(use,base,current,incoming);assert.equal(pending.ready,false);assert.equal(pending.media[0].caption,'Local');
 const accepted=update(use,base,current,incoming,{decisions:decisions(pending,'template')});assert.equal(accepted.ready,true);assert.equal(accepted.media[0].caption,'Parent');assert.equal(accepted.media[0].sectionId,use.sections[0].id);
});

test('concurrent valid parent moves cannot silently introduce a cycle',()=>{
 const base=snapshot([section('a','container'),section('b','container')]),use=linked(base),current=localSnapshot(use),incoming=structuredClone(base);
 current.sections[0].parentId=current.sections[1].id;incoming.sections[1].parentId=incoming.sections[0].id;
 const pending=update(use,base,current,incoming);assert.equal(pending.ready,false);assert.ok(pending.conflicts.some(item=>item.kind==='structure'));assert.ok(validSections(pending.sections));
 const accepted=update(use,base,current,incoming,{decisions:decisions(pending,'template')});assert.ok(accepted.ready);assert.ok(validSections(accepted.sections));assert.equal(accepted.sections[1].parentId,accepted.sections[0].id);
});

test('invalid roots, correspondence, media scopes and duplicated new IDs are refused',()=>{
 const base=snapshot([section('a'),section('b')]),use=linked(base);
 assert.equal(validTemplateLink({...use.link,root:'mutable'}),false);
 assert.equal(validTemplateLink({...use.link,sectionIds:[use.link.sectionIds[0],use.link.sectionIds[0]]}),false);
 assert.throws(()=>previewTemplateUpdate({link:{...use.link,sectionIds:use.link.sectionIds.slice(1)},base,current:localSnapshot(use),incoming:base,root:nextRoot}),/correspondence/);
 assert.throws(()=>createTemplateUse({templateId,root,source:base,makeId:()=> 'same'}),/unique/);
 assert.equal(validTemplateSnapshot(snapshot(base.sections,[media('missing',randomUUID())])),false);
 assert.equal(validTemplateSnapshot(snapshot(base.sections,[{...media('a',randomUUID()),scope:'home#a'}])),false);
});


test('a parent cannot reveal hidden local writing or silently replace its rich text representation',()=>{
 const base=snapshot([section('text','text',{show:false,body:'Base'})]),use=linked(base),current=localSnapshot(use),incoming=structuredClone(base);
 current.sections[0].body='Local private draft';incoming.sections[0].show=true;
 const hidden=update(use,base,current,incoming);assert.equal(hidden.ready,false);assert.equal(hidden.conflicts[0].kind,'visibility');assert.equal(hidden.sections[0].show,false);assert.equal(hidden.sections[0].body,'Local private draft');
 incoming.sections[0].show=false;incoming.sections[0].format='rich';incoming.sections[0].richText=plainRichText('Parent rich text');
 const rich=update(use,base,current,incoming);assert.equal(rich.ready,false);assert.equal(rich.sections[0].body,'Local private draft');assert.equal(rich.sections[0].format,undefined);
 const accept=update(use,base,current,incoming,{decisions:decisions(rich,'template')});assert.equal(accept.ready,true);assert.deepEqual(accept.sections[0].richText,incoming.sections[0].richText);assert.ok(validSections(accept.sections));
});

test('kind changes and research links require explicit source decisions',()=>{
 const base=snapshot([section('text'),section('link','link')]),use=linked(base),current=localSnapshot(use),incoming=snapshot([section('text','media',{entryId:randomUUID(),attachmentId:randomUUID()}),section('link','link',{href:'entry:'+randomUUID()})]);
 const pending=update(use,base,current,incoming);assert.equal(pending.ready,false);assert.deepEqual(pending.conflicts.map(item=>item.kind),['kind','source']);assert.equal(pending.sections[0].kind,'text');assert.equal(pending.sections[1].href,'home');
 const rich=structuredClone(base);rich.sections[0].format='rich';rich.sections[0].richText=plainRichText('Source');rich.sections[0].richText.content[0].content[0].marks=[{type:'link',attrs:{href:'entry:'+randomUUID(),title:'',target:'_self',nofollow:false}}];
 const linkedText=update(use,base,current,rich);assert.equal(linkedText.ready,false);assert.equal(linkedText.conflicts[0].kind,'source');
});

test('removing a locally reordered section remains a structural decision',()=>{
 const base=snapshot([section('a'),section('b')]),use=linked(base),current=snapshot([...use.sections].reverse()),incoming=snapshot([base.sections[1]]);
 const preview=update(use,base,current,incoming);assert.equal(preview.ready,false);assert.ok(preview.conflicts.some(item=>item.kind==='removal'));assert.equal(preview.sections.length,2);
});


test('changing a removal decision drops an obsolete structural choice without trapping review',()=>{
 const base=snapshot([section('group','container')]),use=linked(base),current=localSnapshot(use),incoming=snapshot([]);
 current.sections.push(section('local_child','text',{parentId:current.sections[0].id,body:'Keep'}));
 const first=update(use,base,current,incoming),remove=decisions(first,'template'),second=update(use,base,current,incoming,{decisions:remove});
 assert.ok(second.conflicts.some(item=>item.kind==='structure'));
 const prior={...remove,...Object.fromEntries(second.conflicts.filter(item=>item.kind==='structure').map(item=>[item.id,'local']))};
 const third=update(use,base,current,incoming,{decisions:prior});assert.ok(third.ready);
 const changed={...prior,...decisions(first,'local')},last=update(use,base,current,incoming,{decisions:changed});
 assert.equal(last.ready,true);assert.equal(last.sections.length,2);assert.ok(!last.conflicts.some(item=>item.kind==='structure'));assert.ok(validSections(last.sections));
});


test('moving out of a hidden parent and changing a hidden container kind require review',()=>{
 const base=snapshot([section('group','container',{show:false}),section('text','text',{parentId:'group',body:'Base'})]),use=linked(base),current=localSnapshot(use),incoming=structuredClone(base);
 current.sections[1].body='Hidden local writing';incoming.sections[1].parentId=null;
 const moved=update(use,base,current,incoming);assert.equal(moved.ready,false);assert.equal(moved.conflicts[0].kind,'visibility');assert.equal(moved.sections[1].parentId,use.sections[0].id);
 const changedKind=snapshot([section('group','disclosure',{show:true}),base.sections[1]]),kind=update(use,base,current,changedKind);
 assert.equal(kind.ready,false);assert.equal(kind.sections[0].kind,'container');assert.equal(kind.sections[0].show,false);assert.equal(kind.sections[1].body,'Hidden local writing');
});
