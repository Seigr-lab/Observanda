import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {preparationMethodLinks} from '../src/web/attempt-workflow.js';
import {createRun} from '../src/web/record-workflow.js';
import {attemptFixture} from './fixtures/attempts.js';

test('preparation methods become exact workflow links without losing historical revisions or unrelated links',()=>{
 const method={workspaceId:randomUUID(),kind:'record',id:randomUUID(),revision:'a'.repeat(64),label:'Method before acquisition'},later={...method,revision:'b'.repeat(64),label:'Amended method'};
 const original=[{id:randomUUID(),type:'Background',label:method.label,target:{kind:method.kind,id:method.id,workspaceId:method.workspaceId}}],attempt={preparations:[{protocols:[method]},{protocols:[method,later]}]};
 const links=preparationMethodLinks(original,attempt,{uuid:randomUUID});assert.equal(links.length,3);assert.deepEqual(links[0],original[0]);assert.deepEqual(links.slice(1).map(r=>r.target.revision),[method.revision,later.revision]);assert.ok(links.slice(1).every(r=>r.role==='uses-method'));assert.deepEqual(preparationMethodLinks(links,attempt),links);assert.equal(original.length,1);
});

test('repeating an older run exposes its retained preparation method without editing the old run',()=>{
 const book={id:randomUUID(),entries:[]},method={workspaceId:book.id,kind:'record',id:randomUUID(),revision:'a'.repeat(64),label:'Prior exact method'},prior={id:randomUUID(),notebookId:randomUUID(),title:'Previous run',type:'run',relations:[],tags:[],sections:[],attempt:attemptFixture({protocols:[method]})};
 const snapshot=structuredClone(prior),next=createRun(book,prior,{previous:prior,revision:'b'.repeat(64),uuid:randomUUID});
 assert.deepEqual(prior,snapshot);assert.equal(next.relations.filter(r=>r.role==='uses-method').length,1);assert.equal(next.relations.find(r=>r.role==='uses-method').target.revision,method.revision);assert.equal(next.attempt.preparations[0].protocols[0].revision,method.revision);assert.deepEqual(next.attempt.assessments,[]);assert.deepEqual(next.figures,[]);
});
