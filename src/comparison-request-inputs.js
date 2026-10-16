import {createComparisonInputReader} from './comparison-input-reader.js';
// A request may inspect a retained result even when its live inputs are locked;
// only the explicit dependency-review request obtains these source capabilities.
export async function withComparisonInputs(materials,{sourceAccess,signal}={},consume){
 if(!sourceAccess||await materials.workspace.storageKind()!=='catalogue')return consume(undefined);
 const access=await sourceAccess(materials.workspace,{signal});
 const inputs=createComparisonInputReader(materials,{workspaceId:access.workspaceId,access,signal});
 try{const value=await consume(inputs);await inputs.verify();return value;}finally{await inputs.close();}
}
