import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {projectRequest} from '../src/project-application.js';import {activityOwner} from '../src/web/activity-owner.js';
test('project lifecycle mutations are observed writes and their status routes are read-only',()=>{
 const projectId=randomUUID(),prefix='/api/projects/'+projectId+'/';
 for(const suffix of ['storage/copy','storage/copy/resume','storage/copy/cancel','storage/export','storage/export/resume','storage/export/cancel','storage/move','storage/move/resume','storage/move/cancel','storage/delete','storage/delete/resume'])assert.equal(projectRequest(prefix+suffix).write,true,suffix);
 for(const suffix of ['storage/details','storage/move/status','storage/delete/status'])assert.equal(projectRequest(prefix+suffix).write,false,suffix);
 for(const suffix of ['storage/delete','storage/delete/resume'])assert.equal(activityOwner(prefix+suffix,'#/preferences'),'#/projects');
 assert.equal(projectRequest('/api/projects/delete/pending').write,false);
});
