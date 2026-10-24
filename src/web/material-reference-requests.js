// Only these evidence queries can follow a retained address to another owner.
const reads=new Set(['retained-figure','retained-figure-export','read','record','references','reference-addresses','schema','rows','retained-table','calculation-schema','analysis-status','download','comparison-page','plot-points','plot-point','correction-status','measurement-inspect','measurement-scalar','measurement-component']);
export const addressedMaterialRead=name=>reads.has(name);
export const materialReadReference=(name,data)=>name==='measurement-inspect'?data?.source?.ref:data?.ref;
export const withMaterialReadReference=(name,data,ref)=>name==='measurement-inspect'?{...data,source:{...data.source,ref}}:{...data,ref};
export const inheritMaterialNamespace=(ref,workspaceId)=>ref.workspaceId===undefined&&workspaceId?{...ref,workspaceId}:ref;
export function materialOriginalRoute(ref){
 return ref.workspaceId?'/api/projects/material-reference/original/'+ref.workspaceId+'/'+ref.id+'/'+ref.revision:null;
}
export function materialReferenceReader({api,local,onOwner=()=>{}}){
 return async(name,data={},options={})=>{
  const ref=materialReadReference(name,data);
  if(!addressedMaterialRead(name)||ref?.workspaceId===undefined)return local(name,data,options);
  const result=await api('/api/projects/material-reference/'+name,data,{...options,adopt:false});
  if(options.adoptOwner!==false)onOwner(result,name,ref);return result.value;
 };
}
