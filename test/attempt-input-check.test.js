import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {attemptInputChecks,checkableInput} from '../src/web/attempt-input-check.js';
import {attemptView} from '../src/web/attempt-view.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reference={workspaceId:randomUUID(),kind:'artifact',id:randomUUID(),revision:'a'.repeat(64),label:'release.img'};
const input={id:randomUUID(),label:'Firmware image',kind:'image',algorithm:'sha512',hash:'B'.repeat(128),reference};
const attempt={version:1,preparations:[{id:randomUUID(),supersedes:null,recordedAt:'2026-11-11T10:00:00.000Z',reason:'',applicability:'Bench run',basedOn:null,protocols:[],conditions:[],inputs:[input],observations:[],criteria:[]}],events:[],assessments:[]};
const control=markup=>{const match=/data-input="([^"]+)"/.exec(markup);return {dataset:{action:'content-attempt-input-check',input:match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&')}};};

test('only declared hashes that reference an original can be checked',()=>{
 assert.ok(checkableInput(input));
 for(const other of [{...input,reference:null},{...input,reference:{...reference,kind:'dataset'}},{...input,reference:{withheld:true}},{...input,algorithm:'md5'},{...input,hash:'not hex'}])assert.equal(checkableInput(other),false);
});

test('a declared hash is compared with its original and the result is shown with the input',async()=>{
 const calls=[];let renders=0,answer={matches:true};
 const checks=attemptInputChecks({esc,render:()=>renders++,api:async(route,data,options)=>{calls.push({route,data,options});return answer;}});
 const before=attemptView(attempt,esc,{inputCheck:checks.view});
 assert.match(before,/Check against the original/);
 assert.equal(await checks.action(control(checks.view(input))),true);
 assert.deepEqual(calls[0].route,'/api/research/materials/artifact-digest');
 assert.deepEqual(calls[0].data,{ref:{kind:'artifact',id:reference.id,revision:reference.revision,workspaceId:reference.workspaceId},algorithm:'sha512',expected:input.hash});
 assert.equal(typeof calls[0].options.onProgress,'function','The check streams progress for very large originals');
 assert.match(checks.view(input),/Matches the referenced original/);assert.ok(renders>=2);
 answer={matches:false};await checks.action(control(checks.view(input)));assert.match(checks.view(input),/role="alert">Does not match the referenced original/);
 const failing=attemptInputChecks({esc,render:()=>{},api:async()=>{throw Object.assign(Error('missing'),{code:'MATERIAL_MISSING'});}});
 await failing.action(control(failing.view(input)));assert.match(failing.view(input),/could not be checked/);
 assert.equal(await checks.action({dataset:{action:'other'}}),false);
 assert.equal(attemptView(attempt,esc).includes('Check against the original'),false,'Static and retained views stay unchanged');
});
