import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,calculation} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
test('foreign link capability rechecks before commit, rolls back revocation, and leaves retained links and replay independent',{timeout:120000},async t=>{
 const f=await fixture(t),commands=new ProjectModuleCommands(f.storage,f.book.id);await commands.initialize();
 const command=calculation(f),ref={workspaceId:randomUUID(),type:'record',id:randomUUID()};command.payload.data.links=[ref];
 await assert.rejects(commands.execute(command),{code:'MODULE_REFERENCE'});
 let opened=0,closed=0,verified=0,revoked=false;
 const referenceAccess=async namespace=>{assert.equal(namespace,f.book.id);opened++;return {validate:async value=>{assert.deepEqual(value,ref);return true;},verify:async()=>{verified++;if(revoked)throw Object.assign(Error('revoked'),{code:'ACCESS_LOCKED'});},close:async()=>closed++};};
 const write=ModuleCatalogue.prototype.writeChanges;
 ModuleCatalogue.prototype.writeChanges=async function(...args){const result=await write.apply(this,args);revoked=true;return result;};
 try{await assert.rejects(commands.execute(command,{referenceAccess}),{code:'ACCESS_LOCKED'});}finally{ModuleCatalogue.prototype.writeChanges=write;}
 assert.equal(opened,1);assert.equal(closed,1);assert.equal(verified,1);revoked=false;
 const saved=await commands.execute(command,{referenceAccess});assert.equal(saved.replayed,false);assert.equal(saved.revisions.calculator,1);assert.deepEqual(Object.keys(saved.revisions),['calculator']);assert.equal(closed,2);
 const unavailable=async()=>{throw Error('Retained reference must not reopen target');};
 assert.equal((await commands.execute(command,{referenceAccess:unavailable})).replayed,true);
 const edit={...command,commandId:randomUUID(),payload:{...command.payload,expectedRevision:1,data:{...command.payload.data,name:'Retained unavailable link'}}};
 assert.equal((await commands.execute(edit,{referenceAccess:unavailable})).entities[0].data.name,'Retained unavailable link');
 const remove={...edit,commandId:randomUUID(),payload:{...edit.payload,expectedRevision:2,data:{...edit.payload.data,links:[]}}};
 assert.deepEqual((await commands.execute(remove,{referenceAccess:unavailable})).entities[0].data.links,[]);
});
