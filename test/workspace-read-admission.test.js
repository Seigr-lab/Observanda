import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceSnapshotRequest,WorkspaceReadAdmission} from '../src/workspace-read-admission.js';

test('custom font reads use snapshot admission and font mutations do not',()=>{
 const route='/api/fonts/custom-'+'a'.repeat(64);
 assert.equal(workspaceSnapshotRequest('GET',route),true);
 assert.equal(workspaceSnapshotRequest('GET','/api/fonts'),true);
 for(const invalid of ['/api/fonts/'+'a'.repeat(36),'/api/fonts/custom-'+'a'.repeat(63),'/api/fonts/custom-'+'g'.repeat(64),route+'/extra','/api/fonts/import','/api/fonts/update'])assert.equal(workspaceSnapshotRequest('GET',invalid),false,invalid);
 for(const mutation of [route,'/api/fonts/import','/api/fonts/update'])assert.equal(workspaceSnapshotRequest('POST',mutation),false,mutation);
});

test('closing snapshot admission drains existing reads and rejects new reads until reopened',async()=>{
 const admission=new WorkspaceReadAdmission(),release=admission.enter();let closed=false;
 const closing=admission.close().then(()=>{closed=true;});
 await Promise.resolve();assert.equal(closed,false);assert.equal(admission.enter(),null);
 release();await closing;assert.equal(closed,true);assert.equal(admission.enter(),null);
 admission.open();const next=admission.enter();assert.equal(typeof next,'function');next();await admission.close();
});


test('task readiness remains a snapshot read while task commands require write admission',()=>{
 assert.equal(workspaceSnapshotRequest('POST','/api/modules/planning/readiness'),true);
 assert.equal(workspaceSnapshotRequest('GET','/api/modules/planning/readiness'),false);
 assert.equal(workspaceSnapshotRequest('POST','/api/modules/command'),false);
});
