import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withConsoleProgress} from '../src/operation-progress-console.js';
import {operationStage,operationAdvance} from '../src/operation-progress.js';
test('console verification reports elapsed time without claiming more progress during inactivity',async t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:1000});
 const lines=[];let release;const gate=new Promise(resolve=>{release=resolve;});
 const job=withConsoleProgress(()=>operationStage('verify-history',{total:10,unit:'records'},async()=>{t.mock.timers.tick(1000);operationAdvance();await gate;}),{write:line=>lines.push(line)});
 t.mock.timers.tick(10000);assert.match(lines.at(-1),/1 of 10 records/);assert.match(lines.at(-1),/time since measured progress: 10s/);assert.doesNotMatch(lines.join('\n'),/Workspace valid/);
 release();await job;const count=lines.length;t.mock.timers.tick(5000);assert.equal(lines.length,count);
});
