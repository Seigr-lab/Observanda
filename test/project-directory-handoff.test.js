import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyProjectTreeDirectory} from '../src/project-tree-manifest.js';
import {recordProjectDeparture} from '../src/project-relocation-directory.js';
import {admitNativeWorkspaceTree} from '../src/native-relocation-publication.js';
import {ownerDirectoryKeys,ownerDirectoryRow} from '../src/owner-directory-model.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {AppError} from '../src/errors.js';
const entry=(root,parentId=null)=>({projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),root,parentId,summary:null});
function fixture(entries,extra=[]){
 const workspace={root:path.resolve('Workspace')},workspaceId=randomUUID(),rows=new Map([...entries.map(entry=>({state:'active',entry})),...extra].map(row=>[row.entry.projectId,row]));
 let revision=0,reads=0,streamed=0,writes=0;const indexes=new Map();
 const rebuild=()=>{indexes.clear();for(const row of rows.values())for(const [index,key] of Object.entries(ownerDirectoryKeys('projects',ownerDirectoryRow('projects',row.state,row.entry,workspace.root)))){if(!indexes.has(index))indexes.set(index,new Map());indexes.get(index).set(key,row);}};rebuild();
 const registry={workspace,workspaceId,
  read(){assert.fail('Handoff must not materialize the registry');},change(){assert.fail('Handoff must not replace the registry');},
  inspect:async use=>use({revision:String(revision),get:async(key,{index='identity'}={})=>{reads++;return indexes.get(index)?.get(key)??null;},entries:async function*({index,prefix}){for(const [key,row] of indexes.get(index)??[])if(key.startsWith(prefix)){streamed++;yield {key,...row};}}}),
  apply:async(expected,changes)=>{assert.equal(expected,String(revision));writes++;for(const row of changes)rows.set(row.entry.projectId,row);revision++;rebuild();return {revision:String(revision)};},
 };
 return {registry,rows,stats:()=>({reads,streamed,writes}),reset:()=>{reads=0;streamed=0;writes=0;},set:row=>{rows.set(row.entry.projectId,row);revision++;rebuild();}};
}
test('project departure selects its complete tree among unrelated owners and repeats only the same acknowledgement',async()=>{
 const root=entry(path.resolve('Workspace','Selected')),child=entry(path.join(root.root,'Child'),root.projectId),others=Array.from({length:5000},(_,i)=>entry(path.resolve('Workspace','Other '+i))),f=fixture([root,child,...others]),command={workspaceId:randomUUID(),operationId:randomUUID()};
 await recordProjectDeparture(f.registry,[root,child],command);assert.deepEqual(f.stats(),{reads:2,streamed:2,writes:1});assert.equal(f.rows.get(others[0].projectId).state,'active');
 f.reset();await recordProjectDeparture(f.registry,[root,child],command);assert.deepEqual(f.stats(),{reads:2,streamed:0,writes:0});
 await assert.rejects(recordProjectDeparture(f.registry,[root,child],{...command,operationId:randomUUID()}),{code:'CONFLICT'});
});
test('departure refuses omitted descendants, misplaced physical owners and concurrent changes before retirement',async()=>{
 const root=entry(path.resolve('Workspace','Selected')),child=entry(path.join(root.root,'Child'),root.projectId),command={workspaceId:randomUUID(),operationId:randomUUID()};
 const omitted=fixture([root,child]);await assert.rejects(recordProjectDeparture(omitted.registry,[root],command),{code:'CONFLICT'});assert.equal(omitted.stats().writes,0);
 const misplaced=fixture([root,{...child,parentId:null}]);await assert.rejects(recordProjectDeparture(misplaced.registry,[root],command),{code:'STORAGE_PATH'});assert.equal(misplaced.stats().writes,0);
 const changed=fixture([root,child]),apply=changed.registry.apply;let retry=false;changed.registry.apply=async(...args)=>{if(!retry){retry=true;changed.set({state:'active',entry:{...child,namespaceId:randomUUID()}});throw new AppError('CONFLICT');}return apply(...args);};
 await assert.rejects(recordProjectDeparture(changed.registry,[root,child],command),{code:'CONFLICT'});assert.equal(changed.stats().writes,0);
});
test('destination admission rejects retired and foreign identities while accepting an exact authorized return',async t=>{
 t.mock.method(LabBookDirectory.prototype,'read',async()=>null);
 const selected=entry(path.resolve('Workspace','Selected')),item={kind:'project',relative:'',projectId:selected.projectId,namespaceId:selected.namespaceId,vaultId:selected.vaultId,parentId:null,summary:null},moving={value:{placement:{parentId:null}},command:{scope:()=>({destination:selected.root})},owners:{async *entries(){yield item;}}},f=fixture([]);
 await admitNativeWorkspaceTree(f.registry,moving);
 f.set({state:'relocated',entry:{projectId:selected.projectId,namespaceId:selected.namespaceId,vaultId:selected.vaultId,workspaceId:randomUUID(),operationId:randomUUID()}});
 await admitNativeWorkspaceTree(f.registry,moving);
 const foreign=entry(path.resolve('Workspace','Other'));foreign.namespaceId=selected.namespaceId;const collision=fixture([foreign]);await assert.rejects(admitNativeWorkspaceTree(collision.registry,moving),{code:'DATABASE_LOCATION'});
 const deleted=fixture([],[{state:'deleted',entry:{projectId:selected.projectId,namespaceId:selected.namespaceId,vaultId:selected.vaultId,operationId:randomUUID()}}]);await assert.rejects(admitNativeWorkspaceTree(deleted.registry,moving),{code:'DATABASE_LOCATION'});
 const active=fixture([selected]);await assert.rejects(admitNativeWorkspaceTree(active.registry,moving,{fresh:true}),{code:'PROJECT_LOCATION_EXISTS'});await admitNativeWorkspaceTree(active.registry,moving);
});

test('portable tree discovery is independent of sibling count and refuses logical children outside its folders',async()=>{
 const root=entry(path.resolve('Workspace','Selected')),child=entry(path.join(root.root,'Child'),root.projectId),others=Array.from({length:5000},(_,i)=>entry(path.resolve('Workspace','Other '+i))),f=fixture([root,child,...others]),storage={...root,vault:{id:root.vaultId}};
 // The portable tree a copy captured is checked against the registry through the selected folders only.
 const row=value=>({kind:'project',projectId:value.projectId,namespaceId:value.namespaceId,vaultId:value.vaultId,parentId:value.projectId===root.projectId?null:value.parentId,relative:path.relative(root.root,value.root).split(path.sep).join('/')});
 const captured=new Map([root,child].map(value=>[row(value).relative,row(value)])),tree={collection:{count:captured.size,get:async relative=>captured.get(relative)??null}};
 await verifyProjectTreeDirectory(f.registry,storage,tree);assert.deepEqual(f.stats(),{reads:2,streamed:2,writes:0});
 f.set({state:'active',entry:{...others[0],parentId:root.projectId}});await assert.rejects(verifyProjectTreeDirectory(f.registry,storage,tree),{code:'STORAGE_PATH'});
});
