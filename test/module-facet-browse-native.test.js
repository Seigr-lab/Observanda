import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {moduleDomainStore} from './module-domain-fixture.js';
import {seedModuleCurrent,legacyModuleHead} from './module-current-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ModuleFacetBrowseIndex} from '../src/modules/facet-browse-index.js';
import {ModuleReader} from '../src/modules/reader.js';
import {workspaceModules} from '../src/modules/index.js';

test('facet upgrades, membership upgrades and edits publish atomically without weakening full integrity checks',async t=>{
 const temporary=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(temporary,'observanda-facet-projection-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString();
 t.after(async()=>{await clearVault(f.vault);assert.equal(path.dirname(directory),temporary);assert.ok(path.basename(directory).startsWith('observanda-facet-projection-'));await rm(directory,{recursive:true,force:true});});
 const resources=Array.from({length:55},(_,index)=>({id:randomUUID(),type:'resource',revision:1,createdAt:now,updatedAt:now,data:{projectId:null,placementId:null,name:'Stock '+String(index).padStart(3,'0'),code:'',kind:index%2?'equipment':'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',tags:['sample',...(index%2?['secondary']:[])],links:[]}}));
 await seedModuleCurrent(f.workspace,book.id,resources);
 const run=(operation,write=false)=>moduleDomainStore(f.workspace,book.id,'inventory',operation,{write}),reader=new ModuleReader(f.workspace),modules=workspaceModules(f.workspace),query={workspaceId:book.id,type:'resource',tags:['sample']};
 const page=await reader.list(query);assert.equal(page.items.length,25);assert.equal(page.total,55);
 await run(async store=>{const head=await legacyModuleHead(store,book.id);delete head.facetIndex;await store.db.run("DELETE FROM state WHERE starts_with(slot,'module-facet-index:')");await store.db.run("UPDATE state SET payload=$1 WHERE slot='modules'",store.encode('state','modules',head));},true);
 assert.equal((await reader.list(query)).total,55);await run(async store=>assert.equal((await new ModuleCatalogue(store).head(book.id)).facetIndex,undefined));
 const resource=resources[0],command={workspaceId:book.id,commandId:randomUUID(),action:'resource.save',payload:{id:resource.id,expectedRevision:1,data:{...resource.data,tags:['changed'],name:'Changed stock'}}},write=ModuleCatalogue.prototype.writeChanges;
 t.mock.method(ModuleCatalogue.prototype,'writeChanges',async function(...args){await write.apply(this,args);throw Object.assign(Error('Interrupted facet commit'),{code:'ENOSPC'});});
 await assert.rejects(modules.execute(command,{compact:true}),{code:'ENOSPC'});t.mock.restoreAll();
 await run(async store=>{const head=await new ModuleCatalogue(store).head(book.id);assert.equal(head.facetIndex,undefined);assert.equal(head.memberVersion,undefined);assert.equal(await store.db.get("SELECT 1 FROM state WHERE starts_with(slot,'module-facet-index:') LIMIT 1"),undefined);});
 await modules.execute(command,{compact:true});await modules.execute(command,{compact:true});assert.equal((await reader.list(query)).total,54);assert.equal((await reader.list({...query,tags:['changed']})).total,1);
 await run(async store=>{const catalogue=new ModuleCatalogue(store),head=await catalogue.head(book.id);assert.ok(head.facetIndex);assert.equal(head.memberVersion,1);await new ModuleFacetBrowseIndex(catalogue).verify(head);});
 await f.workspace.catalogue(store=>modules.verifyCatalogue(store,book.id));
 // Removing a current original still fails ordinary head admission even if
 // the requested facet would not have returned that member.
 await run(async store=>{await store.db.run('DELETE FROM module_entities WHERE id=$1',resources[1].id);},true);
 await assert.rejects(reader.list({...query,tags:['changed']}),{code:'CATALOGUE_DAMAGED'});
});
