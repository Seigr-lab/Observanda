import {analysisDependencyState} from './analysis-dependencies.js';
import {createComparisonInputReader} from './comparison-input-reader.js';

// Publication consent selects output content. Dependency checks separately use
// the requesting client's read access, without adding those inputs to output.
export async function publicationDependencyState(materials,sources,{sourceReader,workspaceId,recordHead,signal,onItem,onCheck}={}){
 if(typeof sourceReader?.materialAccess!=='function'||Array.isArray(sources)&&!sources.length)return analysisDependencyState(materials,sources,{recordHead,signal,onItem,onCheck});
 signal?.throwIfAborted();const iterator=sources[Symbol.asyncIterator]?.()??sources[Symbol.iterator]();let inputs,access;
 try{
  const first=await iterator.next();signal?.throwIfAborted();
  // An empty retained collection has the same authorization boundary as the
  // former empty inline array; it does not open unrelated dependency owners.
  if(first.done)return analysisDependencyState(materials,[],{recordHead,signal,onItem,onCheck});
  async function* selected(){yield first.value;for(;;){const item=await iterator.next();if(item.done)return;yield item.value;}}
  workspaceId??=(await materials.workspace.outline()).metadata.id;
  access=await sourceReader.materialAccess({workspace:materials.workspace,signal});
  inputs=createComparisonInputReader(materials,{workspaceId,access,signal});
  return await analysisDependencyState(materials,selected(),{recordHead,signal,inputs,onItem,onCheck});
 }finally{try{if(inputs)await inputs.close();else if(access)await access.close();}finally{await iterator.return?.();}}
}
