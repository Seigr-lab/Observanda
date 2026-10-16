import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {reconcileRecords} from '../src/web/record-merge.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';

test('native result checkpoints survive restart, concurrent results, rejected writes and verified restore',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-draft-results-')),book=sampleNotebook(),base=book.entries[0];
 const a={id:randomUUID(),kind:'number',title:'Exact result',text:'9007199254740993/6',basis:'authored',source:null,limitations:'Synthetic measurement scope'},b={...a,id:randomUUID(),title:'Other conclusion',text:'Original statement'};
 base.results={version:1,statements:[a,b]};
 const f=await encryptedFixture(directory,book),drafts=new ResearchDrafts(f.workspace),mine=structuredClone(base);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 mine.body='Unfinished analysis notes';mine.results.statements[0].text='9007199254740995/6';
 const command={id:randomUUID(),workspaceId:book.id,expectedRevision:null,changes:[{baseRevision:recordRevision(base),expectedRevision:recordRevision(base),record:mine}]};
 const saved=await drafts.write(command);assert.equal((await drafts.write(command)).revision,saved.revision);
 assert.equal((await drafts.list({workspaceId:book.id})).drafts[0].id,command.id);
 const invalid=structuredClone(command);invalid.expectedRevision=saved.revision;invalid.changes[0].record.results.statements[0].source={kind:'invented'};
 await assert.rejects(drafts.write(invalid),{code:'INVALID'});assert.equal((await drafts.read(command.id)).revision,saved.revision);
 const remote=structuredClone(base);remote.results.statements[1].text='Concurrent conclusion';
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:remote}]},{receipt:true});
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault});
 for(const workspace of [new Workspace(f.workspace.root,f.vault),new Workspace(destination,f.vault)]){
  const recovered=await new ResearchDrafts(workspace).read(command.id);assert.equal(recovered.revision,saved.revision);assert.deepEqual(recovered.draft.changes[0].record,mine);assert.deepEqual(recovered.draft.changes[0].base,base);
  const latest=await workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,base.id);return store.record(row.id,row.revision);});
  const plan=reconcileRecords(recovered.draft.changes,[latest]);assert.equal(plan.conflicts.length,0);const [record]=plan.resolve(new Map());
  await new ResearchRecords(workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(latest),record}]},{receipt:true});
  assert.deepEqual(record.results.statements.map(s=>s.text),['9007199254740995/6','Concurrent conclusion']);assert.equal(record.body,mine.body);
 }
});
