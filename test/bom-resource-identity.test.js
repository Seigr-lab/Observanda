import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {validBOMResource,bomResourceReference,bomResourceKey,localBOMResource,bomRequirements,bomAvailability,requiredQuantity} from '../src/web/modules/bom-model.js';
const line=(resourceId,quantity='0.1',sourceProjectId=null)=>({id:id(),resourceId,quantity,sourceProjectId,dnp:false});
test('BOM resource identities preserve historical local values and require exact addressed resources',()=>{
 const namespace=id(),resource=id(),foreign=id(),value=line(resource),reference={workspaceId:foreign,type:'resource',id:resource};
 assert.ok(validBOMResource(null));assert.ok(validBOMResource(resource));assert.ok(validBOMResource(reference));assert.ok(!validBOMResource({...reference,path:'not accepted'}));assert.ok(!validBOMResource({...reference,type:'task'}));assert.ok(!validBOMResource({id:resource}));
 assert.deepEqual(bomResourceReference(value,namespace),{workspaceId:namespace,type:'resource',id:resource});assert.equal(value.resourceId,resource);assert.equal(localBOMResource(value,namespace),resource);assert.equal(localBOMResource(line(reference),namespace),null);assert.equal(localBOMResource(line({...reference,workspaceId:namespace}),namespace),resource);
 assert.equal(bomResourceKey(reference),bomResourceKey({id:resource,type:'resource',workspaceId:foreign}));
});
test('BOM requirements separate owner and placement with exact decimals and preserve local output shape',()=>{
 const namespace=id(),foreign=id(),resource=id(),place=id(),local=line(resource),external={workspaceId:foreign,type:'resource',id:resource};
 const legacy={buildCount:'3',lines:[local,line(resource,'0.2')]};assert.deepEqual(bomRequirements(legacy),[{resourceId:resource,projectId:null,quantity:'0.9'}]);
 const bom={buildCount:'3',lines:[local,line(external,'0.2'),line({id:resource,type:'resource',workspaceId:foreign},'0.1'),line(external,'0.4',place),{...line(external,'99'),dnp:true}]};
 const groups=bomRequirements(bom,namespace);assert.equal(groups.length,3);assert.deepEqual(groups.map(row=>row.quantity),['0.3','0.9','1.2']);assert.equal(requiredQuantity(bom,bom.lines.at(-1)),'0');
 assert.equal(bomRequirements({buildCount:'1',lines:[local,line({workspaceId:namespace,type:'resource',id:resource},'0.2')]},namespace).length,1);
});
test('a foreign BOM resource never borrows a same-ID local stock balance',()=>{
 const namespace=id(),foreign=id(),resource=id(),entities=[{id:resource,type:'resource',data:{projectId:null}},{id:id(),type:'movement',data:{resourceId:resource,projectId:null,delta:'10'}}];
 const bom={buildCount:'1',lines:[line(resource),line({workspaceId:foreign,type:'resource',id:resource})]},rows=bomAvailability(bom,entities,namespace);
 assert.equal(rows[0].available,'10');assert.equal(rows[1].available,null);assert.equal(rows[1].shortage,null);assert.equal(rows[1].status,'unavailable');assert.equal(bomAvailability({buildCount:'1',lines:[bom.lines[1]]},entities)[0].available,null);
});

test('missing BOM linkage is safely classified before authored shape validation',()=>{for(const value of [null,undefined,{}, {resourceId:null}]){assert.equal(bomResourceReference(value),null);assert.equal(localBOMResource(value),null);}});
