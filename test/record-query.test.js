import {test} from 'node:test';
import assert from 'node:assert/strict';
import {queryFixture} from './record-query-fixture.js';
import {queryRecords,recordBrowse,browseIssue} from '../src/web/record-query.js';
import {recordsIn} from '../src/web/workspace-structure.js';
import {validateNotebook} from '../src/model.js';

test('combined tags, dates and retained lab types query the selected hierarchy without duplicating or mutating records',()=>{
 const book=queryFixture(),before=structuredClone(book);validateNotebook(book);
 const scoped=recordsIn(book,book.projects[0].id);
 const results=queryRecords(scoped,{search:'shared',browse:{tags:'SOUND, summer',from:'2026-06-01',to:'2026-06-30',domain:'arts-creative',sort:'date-asc'}});
 assert.deepEqual(results.map(e=>e.title),['Summer take 1','Summer take 2']);assert.equal(results[0],book.entries[0]);assert.equal(results[0].share,false);
 assert.deepEqual(queryRecords(scoped,{browse:{tags:'sound,summer',domain:'arts-creative',status:'incomplete'}}).map(e=>e.title),['Summer take 2']);
 assert.deepEqual(queryRecords(scoped,{search:'recorder stopped'}).map(e=>e.title),['Summer take 2']);
 assert.deepEqual(queryRecords(scoped,{browse:{domain:'general'}}).map(e=>e.title),['Untyped summer note']);
 assert.deepEqual(book,before);
});
test('tag any/all, exact names, inclusive boundaries, record types and lab book scope compose',()=>{
 const book=queryFixture(),scope=recordsIn(book,book.projects[0].id);
 assert.equal(queryRecords(scope,{browse:{tags:'sound, wildlife',tagMode:'all'}}).length,0);
 assert.equal(queryRecords(scope,{browse:{tags:'sound, wildlife',tagMode:'any'}}).length,4);
 assert.equal(queryRecords(scope,{browse:{tags:'sum'}}).length,0);
 assert.equal(queryRecords(scope,{browse:{from:'2026-06-01',to:'2026-06-01'}})[0].title,'Summer take 1');
 assert.equal(queryRecords(scope,{notebook:book.notebooks[0].id,browse:{tags:'sound'}}).length,0);
 assert.deepEqual(queryRecords(scope,{filter:'template:'+book.entries[0].template.id}).map(e=>e.title),['Summer take 1']);
});
test('invalid date ranges explain empty results and sorting remains deterministic',()=>{
 const book=queryFixture();assert.match(browseIssue(recordBrowse({from:'2026-02-30'})),/valid/);
 assert.match(browseIssue(recordBrowse({from:'2026-06-30',to:'2026-06-01'})),/start date/);
 assert.deepEqual(queryRecords(book.entries,{browse:{from:'2026-02-30'}}),[]);
 const a=queryRecords(book.entries,{browse:{sort:'title'}}).map(e=>e.id);
 const b=queryRecords([...book.entries].reverse(),{browse:{sort:'title'}}).map(e=>e.id);assert.deepEqual(a,b);
 assert.equal(recordBrowse(null).domain,'all');assert.equal(recordBrowse({status:'invented'}).status,'all');
});
