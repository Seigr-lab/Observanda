import {AppError} from './errors.js';
import {revisionText} from './web/revision-model.js';
import {EvaluationPageCache} from './evaluation-page-cache.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const index=value=>Number.isSafeInteger(value)&&value>=0;
// Bounded authenticated metadata pages per graph operation. Source visibility is
// rechecked on every read; selected cell blocks remain lazy and are not cached.
export class GraphSourceReader{
 constructor(materials,options){this.materials=materials;this.pages=new EvaluationPageCache(options);}
 async read(binding,location,{signal}={}){
  signal?.throwIfAborted();if(binding?.source?.kind!=='dataset'||location?.kind!=='dataset'||!index(location.page)||!index(location.row))fail();
  const doc=await this.materials.read(binding.source);signal?.throwIfAborted();
  const key=revisionText([binding.source,location.page]);let data=this.pages.get(key);
  if(!data){data=await this.materials.retainedDatasetPage(doc,location.page,{metadataOnly:true});signal?.throwIfAborted();if(!Array.isArray(data?.rows))fail();this.pages.set(key,data,{signal});}
  const row=data.rows[location.row];if(!row||row.id!==location.id)fail();
  return {doc,row};
 }
}
