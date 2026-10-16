import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {historicalFixture} from './publication-revisions-fixture.js';
import {PublicationLinks} from '../src/publication-links.js';
import {contentBuffer} from '../src/file-content.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {revisionPageId} from '../src/publication-revisions.js';
import {verifyPublication} from '../src/publication.js';

function mappings(f){return {version:1,pages:[{id:randomUUID(),path:'archive/chapter.html',title:'Two investigations',anchors:[{id:randomUUID(),fragment:'first-run',label:'First investigation',target:{workspaceId:f.book.id,kind:'record',id:f.run.id}},{id:randomUUID(),fragment:'original-method',label:'Original method',target:f.target}]}]};}
test('a legacy chapter preserves distinct fragments and exact revision links with no redirect',async t=>{
 const f=await historicalFixture(t),links=new PublicationLinks(f.workspace),config=mappings(f),choice=defaultEditionRecord(f.old,f.target.revision);choice.sections=[];
 await links.save({workspaceId:f.book.id,etag:'new',config});
 const candidate=await f.releases.inline({...f.source,edition:{version:1,records:[],history:[choice]}}),html=(await contentBuffer(candidate.files.get(config.pages[0].path))).toString(),old=revisionPageId(f.book.id,f.method.id,f.target.revision);
 assert.match(html,/id="first-run"/);assert.match(html,/id="original-method"/);assert.ok(html.includes('href="../entries/'+f.run.id+'.html"'));assert.ok(html.includes('href="../entries/'+old+'.html"'));assert.match(html,/rel="canonical" href="\.\.\/archive\/chapter.html"/);assert.ok(!html.includes('http-equiv="refresh"'));assert.ok(candidate.pages.some(p=>p.path===config.pages[0].path));verifyPublication(candidate);
 const next=await f.releases.inline({...f.source,edition:{version:1,records:[],history:[choice]}});assert.ok(next.files.has(config.pages[0].path));
 await assert.rejects(links.save({workspaceId:f.book.id,etag:'new',config}),{code:'CONFLICT'});
});
test('ambiguous fragments, excluded targets and generated path collisions stop edition preparation',async t=>{
 const f=await historicalFixture(t),links=new PublicationLinks(f.workspace);
 for(const [change,reason] of [[p=>p.anchors[1].fragment=p.anchors[0].fragment,'ambiguousFragment'],[p=>p.anchors[1].fragment='observanda-content-'+p.id,'ambiguousFragment'],[p=>p.anchors[1].target=null,'unmappedTarget'],[p=>p.path='entries/'+f.run.id+'.html','generatedPath']]){
  const config=mappings(f);config.pages[0].anchors[1].target={workspaceId:f.book.id,kind:'record',id:f.method.id};change(config.pages[0]);await links.save({workspaceId:f.book.id,etag:(await links.read()).etag,config});
  await assert.rejects(f.releases.inline(f.source),e=>e.code==='PUBLICATION_LINKS'&&e.details.some(d=>d.reason===reason));
 }
 for(const path of ['../escape.html','/absolute.html','CON.html','media/copied.html','x/%2e%2e/file.html','x.html?secret','x.html#fragment']){const config=mappings(f);config.pages[0].path=path;await assert.rejects(links.save({workspaceId:f.book.id,etag:(await links.read()).etag,config}),{code:'INVALID'});}
});
