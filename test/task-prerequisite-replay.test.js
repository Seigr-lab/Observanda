import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';

test('a task retry discovers the exact receipt committed after its first local preflight',{timeout:60000},async t=>{
 const f=await fixture(t),commands=new ProjectModuleCommands(f.storage,f.book.id);await commands.initialize();
 const command={workspaceId:f.book.id,commandId:randomUUID(),action:'task.save',payload:{id:randomUUID(),expectedRevision:null,data:{title:'Concurrent retry',description:'',status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]}}};
 let enter,release,first=true;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve),catalogue=f.storage.catalogue;
 // ProjectDomains reads the command receipt directly. This gate pauses only
 // the first task-facts read, after that receipt lookup returned absent.
 f.storage.catalogue=async function(...args){if(first){first=false;enter();await held;}return catalogue.apply(this,args);};
 let pending;
 try{
  pending=commands.execute(command,{taskSourceAccess:()=>assert.fail('A source-free retry opened foreign access')});await entered;
  const winner=await commands.execute(command);assert.equal(winner.replayed,false);
  release();const replay=await pending;assert.equal(replay.replayed,true);assert.equal(replay.entities[0].revision,1);assert.deepEqual(replay.entities[0],winner.entities[0]);
 }finally{release();f.storage.catalogue=catalogue;await pending?.catch(()=>{});}
});
