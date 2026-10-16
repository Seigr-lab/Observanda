import {analysisDependencyState} from './analysis-dependencies.js';
import {createComparisonInputReader} from './comparison-input-reader.js';

// Publication consent selects output content. Dependency checks separately use
// the requesting client's read access, without adding those inputs to output.
export async function publicationDependencyState(materials,sources,{sourceReader,workspaceId,recordHead,signal}={}){
 if(!sources.length||typeof sourceReader?.materialAccess!=='function')return analysisDependencyState(materials,sources,{recordHead,signal});
 signal?.throwIfAborted();
 workspaceId??=(await materials.workspace.outline()).metadata.id;
 const access=await sourceReader.materialAccess({workspace:materials.workspace,signal});let inputs;
 try{
  inputs=createComparisonInputReader(materials,{workspaceId,access,signal});
  return await analysisDependencyState(materials,sources,{recordHead,signal,inputs});
 }finally{if(inputs)await inputs.close();else await access.close();}
}
