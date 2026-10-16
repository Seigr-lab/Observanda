import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {placementOwners,validProjectPlacementTransfer} from '../src/project-placement-transfer-state.js';

const proof=()=>({snapshots:{max:0,count:1,digest:'a'.repeat(64)},module_events:{max:-1,count:0,digest:'b'.repeat(64)}});
function receipt(){
 const value={version:2,id:randomUUID(),projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),phase:'copying',placement:{parentId:randomUUID(),expectedParentId:null},rootBooks:{books:[]},projects:[{projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),relative:'Project Z',books:[]},{projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),relative:'Project \u00c5',books:[{labBookId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),directory:'Original Notes'}]}]};
 value.transfer={owners:placementOwners(value).map((owner,index)=>({...owner,id:randomUUID(),sourceId:randomUUID(),sourceIdentity:{dev:'1',ino:String(index+1)}}))};return value;
}
test('tree transfer receipts require every authenticated owner before registration or retirement',()=>{
 const value=receipt();assert.equal(validProjectPlacementTransfer(value),true);
 for(const phase of ['moved','registered','retiring','retired','complete'])assert.equal(validProjectPlacementTransfer({...value,phase}),false);
 for(const owner of value.transfer.owners)Object.assign(owner,{destinationId:randomUUID(),destinationIdentity:{dev:'2',ino:owner.sourceIdentity.ino},retention:proof()});
 for(const phase of ['copying','moved','registered','retiring','retired','complete'])assert.equal(validProjectPlacementTransfer({...value,phase}),true);
 for(const change of [value=>value.transfer.owners.pop(),value=>value.transfer.owners.reverse(),value=>value.transfer.owners[1].namespaceId=randomUUID(),value=>value.transfer.owners[1].id=value.transfer.owners[0].id,value=>value.transfer.owners[0].destinationId=value.transfer.owners[0].sourceId,value=>value.transfer.owners[0].sourceIdentity.ino='NaN',value=>value.transfer.owners[2].relative='../Outside',value=>delete value.transfer.owners[1].retention]){const bad=structuredClone(value);change(bad);assert.equal(validProjectPlacementTransfer(bad),false);}
});
test('persisted owner order is independent of the current collation and legacy states cannot authorize transfer cleanup',()=>{
 const value=receipt(),original=String.prototype.localeCompare;String.prototype.localeCompare=()=>{throw Error('Locale-dependent ownership order');};
 try{assert.deepEqual(placementOwners(value).map(owner=>owner.relative),['','Project Z','Project \u00c5','Project \u00c5/Original Notes']);assert.equal(validProjectPlacementTransfer(value),true);}finally{String.prototype.localeCompare=original;}
 assert.equal(validProjectPlacementTransfer({version:1,phase:'cancelling'}),true);assert.equal(validProjectPlacementTransfer({version:1,phase:'retired'}),false);assert.equal(validProjectPlacementTransfer({...value,version:1}),false);
});
