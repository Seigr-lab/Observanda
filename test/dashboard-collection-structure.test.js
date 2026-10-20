import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardCollectionStructure} from '../src/dashboard-collection-structure.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';

test('project cards read twelve native book labels and exact counts while masking retired and dedicated inline identities',async t=>{
 const workspaceId=randomUUID(),projectId=randomUUID(),nativeId=randomUUID(),retiredId=randomUUID(),legacyId=randomUUID(),metadata={id:workspaceId,title:'Project owner',projects:[{id:projectId,title:'Project'}],notebooks:[{id:nativeId,projectId,title:'Old duplicate'},{id:retiredId,projectId,title:'Deleted duplicate'},{id:legacyId,projectId,title:'Retained local book'}]},entries=Array.from({length:400},(_,i)=>({labBookId:i===0?nativeId:randomUUID(),namespaceId:randomUUID(),directory:'Book '+i})),owner={workspaceId,projectId,labBookId:null},selected={projectIds:new Set([projectId]),projectOwners:new Map([[projectId,workspaceId]]),notebookIds:null},pages=new RecordCollectionPages(),client={},calls=[];let revision='first';
 const original=LabBookRegistry.prototype.inspect,read=LabBookRegistry.prototype.read;LabBookRegistry.prototype.read=()=>{throw Error('Card loaded whole book directory');};LabBookRegistry.prototype.inspect=async operation=>operation({revision,count:entries.length,get:async id=>id===nativeId?{state:'active',entry:entries[0]}:id===retiredId?{state:'deleted',entry:{labBookId:retiredId}}:null,page:async options=>{calls.push(options.limit);return {items:entries.slice(0,options.limit).map(entry=>({state:'active',entry})),total:entries.length};}});
 t.after(()=>{pages.clear();LabBookRegistry.prototype.inspect=original;LabBookRegistry.prototype.read=read;});
 const storage={root:process.cwd(),projectId,catalogue:async operation=>operation({head:async()=>'a'.repeat(64),snapshot:async()=>({metadata})})},visit=async operation=>operation(storage,owner,selected),command={workspaceId,etag:'b'.repeat(64),provider:'projects',config:defaultPanelConfig(),options:{},limit:1,cursor:null,key:null};
 const first=await dashboardCollectionStructure(pages,client,command,{visit});assert.equal(first.items.length,1);const value=first.items[0].data;assert.equal(value.notebookTotal,401);assert.equal(value.notebooks.length,12);assert.equal(value.notebooks[0].id,legacyId);assert.equal(value.notebooks.filter(book=>book.id===nativeId).length,1);assert.equal(value.notebooks.some(book=>book.id===retiredId),false);assert.deepEqual(calls,[12]);
 revision='second';await assert.rejects(dashboardCollectionStructure(pages,client,{...command,cursor:first.cursor},{visit}),{code:'RECORD_QUERY_CURSOR'});
});
