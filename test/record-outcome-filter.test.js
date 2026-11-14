import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordBrowse,recordQueryMatcher,browseActive} from '../src/web/record-query.js';
import {indexedRecordDateQuery} from '../src/record-date-page.js';

// Experiments are found by their outcome, in their own words, as a lab
// notebook's experiment index filters passed, failed or partial results.
const record=(title,outcome)=>({id:title,notebookId:'n',type:'experiment',title,body:[],sections:[],tags:[],contributors:[],status:'complete',occurredOn:'2026-09-16',...(outcome===undefined?{}:{outcome})});
const records=[record('Startup calibration','Passed: 72/72 readings in frozen bands'),record('First Seigsit creation','Failed: one reading above its band'),record('Display state','Partial; panel control remains open'),record('Field note')];
const found=outcome=>records.filter(recordQueryMatcher({browse:{outcome}})).map(e=>e.title);

test('records can be browsed by outcome, ignoring case, and records without an outcome are left out',()=>{
 assert.deepEqual(found(''),records.map(e=>e.title));
 assert.deepEqual(found('passed'),['Startup calibration']);
 assert.deepEqual(found('FAILED'),['First Seigsit creation']);
 assert.deepEqual(found('band'),['Startup calibration','First Seigsit creation']);
 assert.deepEqual(found('nothing like this'),[]);
 assert.equal(recordBrowse({outcome:'passed'}).outcome,'passed');assert.equal(recordBrowse({}).outcome,'');assert.equal(recordBrowse({outcome:7}).outcome,'');
 assert.equal(browseActive(recordBrowse({outcome:'passed'})),1);assert.equal(browseActive(recordBrowse({outcome:'  '})),0);
});

test('an outcome filter never takes the unfiltered date paging shortcut',()=>{
 const query=browse=>({filter:'all',search:'',browse});
 assert.equal(indexedRecordDateQuery(query({})),true);
 assert.equal(indexedRecordDateQuery(query({outcome:'failed'})),false);
});
