import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';import {randomUUID} from 'node:crypto';
import {readFile,access,stat} from 'node:fs/promises';
import {fixture,calculation} from './project-domain-fixture.js';
import {copyProjectLocation} from '../src/project-transfer.js';
import {ProjectStorage} from '../src/project-storage.js';
import {ProjectDomains} from '../src/project-domains.js';
import {executeModuleCommand} from '../src/modules/command.js';
import {moduleCommandFingerprint} from '../src/modules/command-fingerprint.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {CATALOGUE_ARCHIVE,catalogueBinding} from '../src/postgres-activation.js';
const save=(f,command)=>f.domains.run(['calculator'],get=>executeModuleCommand(workspaceModules(f.storage),get('calculator'),{book:f.book},command,moduleCommandFingerprint(command),{compact:true}),{write:['calculator']});
for(const portable of [false,true])test('changed '+(portable?'portable archive':'physical project')+' snapshots include independently saved module data',async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator']);const first=calculation(f);await save(f,first);
 const id=randomUUID(),destination=path.join(f.root,portable?'backup':'copy'),relative='.observanda/retained.bin';await f.storage.writeFile(path.join(f.storage.root,relative),'unchanged evidence');
 await assert.rejects(copyProjectLocation(f.storage,destination,{id,portable,checkpoint:async stage=>{if(stage==='database')throw Error('First snapshot');}}),/First snapshot/);
 const original=portable?await readFile(path.join(destination,CATALOGUE_ARCHIVE)):null,unchanged=await stat(path.join(destination,relative)),head=(await f.storage.outline()).etag;
 const second=calculation(f);await save(f,second);assert.equal((await f.storage.outline()).etag,head);
 await assert.rejects(copyProjectLocation(f.storage,destination,{id,portable,checkpoint:async stage=>{if(stage==='database-committed')throw Error('New snapshot committed');}}),/New snapshot committed/);
 await copyProjectLocation(f.storage,destination,{id,portable});assert.equal((await stat(path.join(destination,relative))).mtimeMs,unchanged.mtimeMs);
 if(portable){assert.equal(await catalogueBinding(destination),null);await assert.rejects(access(path.join(destination,'.observanda/postgresql')),{code:'ENOENT'});assert.notDeepEqual(await readFile(path.join(destination,CATALOGUE_ARCHIVE)),original);}
 const restored=new ProjectStorage(destination,f.projectId,f.vault);assert.deepEqual(await restored.read(),await f.storage.read());
 await new ProjectDomains(restored,f.book.id).run(['calculator'],async get=>{const store=new ModuleCatalogue(get('calculator')),head=await store.head(f.book.id);assert.equal(head.revision,2);for(const command of [first,second])assert.equal((await store.selected(head,command.payload.id)).data.name,command.payload.data.name);});
});
