import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../src/model.js';
import {WebsiteSites} from '../src/website-sites.js';
import {installDatabaseProvider,scopedDatabaseConnection} from '../src/workspace-database-context.js';
import {withScratch} from '../src/scratch-work.js';
import {clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {withPublicationOutputWriter} from '../src/publication-output.js';
import {randomUUID} from 'node:crypto';

test('website validation borrows its active owner context without starting an unrelated scratch database',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-write-scope-'));
 const fixture=await encryptedFixture(directory,createNotebook('Website write scope'));
 t.after(async()=>{await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true});});
 const sites=new WebsiteSites(fixture.workspace);await sites.initialize();
 const detach=installDatabaseProvider({environment:async()=>process.env,scratch:async()=>{assert.fail('Website write started an unrelated database');}});
 try{
  await sites.write(null,{},async store=>{
   assert.equal(scopedDatabaseConnection(),store.db);
   await withScratch(async work=>{assert.equal(await work.add('selection',{checked:true}),true);assert.deepEqual(await work.get('selection'),{checked:true});});
  });
  await withPublicationCapture(fixture.workspace,async(_workspace,_id,finish)=>finish(()=>true));
  const job={id:randomUUID(),lease:{token:randomUUID()}};
  await withPublicationOutputWriter(fixture.workspace,{workspaceId:fixture.workspace.vault.id,websiteId:null},job,{},async()=>{
   assert.ok(scopedDatabaseConnection(),'Output work must retain its owner context');
   await withScratch(async work=>{await work.put('output','retained');assert.equal(await work.get('output'),'retained');});
  });
 }finally{detach();}
});
