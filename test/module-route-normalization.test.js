import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {replaceRestoredModuleRoute} from '../src/web/module-route-normalization.js';
import {routeFor} from '../src/web/navigation.js';
import {ownedRoute} from '../src/web/project-context.js';
const address=state=>ownedRoute(routeFor(state),state.projectOwner);
function fixture({moduleId='planning',modulePath='task/'+randomUUID(),owner=null}={}){
 const state={page:'module',moduleId,modulePath,projectOwner:owner},saved={observandaIndex:4,search:'retained filter'},entries=['#/preferences/general',address(state)],calls=[];
 const history={state:saved,replaceState(value,title,url){calls.push({value,title,url});entries[entries.length-1]=url;},pushState(){assert.fail('Normalization must not push a history entry');}};
 return {state,saved,entries,calls,history,normalize:current=>replaceRestoredModuleRoute(state,{current:current??(()=>true),history,routeFor:address})};
}
for(const owner of [null,{projectId:randomUUID()},{projectId:randomUUID(),labBookId:randomUUID()}])test('restored scoped address replaces one entry and preserves its owner '+(owner?.labBookId?'book':owner?'project':'workspace'),()=>{
 const f=fixture({owner}),original=f.state.modulePath,normalized=f.normalize();
 assert.equal(f.state.modulePath,'scope/workspace/'+original);assert.equal(normalized,address(f.state));assert.equal(f.entries.length,2);assert.equal(f.calls.length,1);assert.equal(f.calls[0].value,f.saved);assert.equal(f.entries.pop(),normalized);assert.equal(f.entries.at(-1),'#/preferences/general');assert.equal(f.normalize(),null);assert.equal(f.calls.length,1);
});
test('scope and module defaults follow the selected descriptor',()=>{
 const projectId=randomUUID(),f=fixture({modulePath:'scope/'+projectId});f.normalize();assert.equal(f.state.modulePath,'scope/'+projectId+'/agenda');
 const inventory=fixture({moduleId:'resources',modulePath:''});inventory.normalize();assert.equal(inventory.state.modulePath,'scope/workspace/resource');
});
test('a superseded route cannot replace newer history or alter module state',()=>{
 const f=fixture(),original=structuredClone(f.state);f.entries[f.entries.length-1]='#/preferences/general';assert.equal(f.normalize(()=>false),null);assert.deepEqual(f.state,original);assert.equal(f.calls.length,0);assert.equal(f.entries.at(-1),'#/preferences/general');
});
test('restoration retains URL and request-version cancellation after canonical replacement',()=>{
 const f=fixture();let requested=f.entries.at(-1),version=1;const request=version,current=()=>request===version&&f.entries.at(-1)===requested;
 requested=f.normalize(current)??requested;assert.equal(current(),true);f.entries.push('#/preferences/general');assert.equal(current(),false);f.entries.pop();version++;assert.equal(current(),false);assert.equal(f.normalize(current),null);assert.equal(f.calls.length,1);
});
test('unscoped module types and nonmodule screens retain their own routes',()=>{
 for(const [moduleId,page] of [['scientific-calculator','module'],['planning','preferences'],['unknown-module','module']]){const f=fixture({moduleId});f.state.page=page;const original=structuredClone(f.state);assert.equal(f.normalize(),null);assert.deepEqual(f.state,original);assert.equal(f.calls.length,0);}
});
