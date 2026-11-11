import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {clearVault} from '../src/encryption.js';
import {websiteWorkspace} from '../src/website-workspace.js';

// A cancelled preparation (for example when the application closes) can fail
// while reading its edition. Cleanup takes time; the failure must still reach
// the caller instead of becoming an unhandled rejection of the service.
test('an inline edition read that fails during cleanup rejects its caller, never the process',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inline-cleanup-')),f=await encryptedFixture(directory,sampleNotebook());
 const unhandled=[],observe=error=>unhandled.push(error);process.on('unhandledRejection',observe);
 t.after(async()=>{process.off('unhandledRejection',observe);await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const site=websiteWorkspace(f.workspace,null),jobs=new PublicationJobs(site),clean=jobs.clean.bind(jobs),cancelled=new DOMException('This operation was aborted','AbortError');
 jobs.read=async()=>{await delay(1);throw cancelled;};
 jobs.clean=async(...args)=>{await delay(200);return clean(...args);};
 await assert.rejects(jobs.inline(await site.outline()),error=>error===cancelled);
 await delay(10);assert.deepEqual(unhandled,[]);
});
