import {ModuleHistory} from './modules/history.js';
import {validCalculatorSource} from './web/calculator-result-model.js';
import {AppError} from './errors.js';
// Capture a single authenticated immutable module revision. The destination
// writer and source credentials remain separate; no credential enters a recipe.
export async function calculatorResultSource(storage,source,{referenceAccess,check=async()=>{},signal}={}){
 if(!validCalculatorSource(source))throw new AppError('CALCULATOR_RESULT_INVALID');await check();signal?.throwIfAborted();
 const workspaceId=(await storage.outline()).metadata.id;let access;
 try{
  const read=async workspace=>{const result=await new ModuleHistory(workspace).read({id:source.id,revision:source.revision});if(result.entity.type!=='calculation')throw new AppError('CALCULATOR_RESULT_INVALID');return structuredClone(result.entity);};
  const entity=source.workspaceId===workspaceId?await read(storage):await(async()=>{if(!referenceAccess)throw new AppError('ACCESS_LOCKED');access=await referenceAccess(workspaceId,{signal});return access.useReference({workspaceId:source.workspaceId,type:source.type,id:source.id},read);})();
  await check();signal?.throwIfAborted();return {entity,verify:async()=>{await check();signal?.throwIfAborted();await access?.verify();},close:async()=>{await access?.close();}};
 }catch(error){await access?.close();throw error;}
}
