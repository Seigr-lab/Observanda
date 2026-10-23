// Exact evidence addresses select registered owners. Edits retain their
// explicitly selected project command and cannot use this read adapter.
import {materialRequest} from './material-requests.js';
import {materialReference,validMaterialReference} from './web/material-reference.js';
import {addressedMaterialRead,materialReadReference,withMaterialReadReference} from './web/material-reference-requests.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export function projectMaterialReferenceRequest(route){
 const original=/^\/api\/projects\/material-reference\/original\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(route);
 if(original){
  const ref={kind:'artifact',workspaceId:original[1],id:original[2],revision:original[3]};
  if(!validMaterialReference(ref))throw new AppError('INVALID');
  return {material:'download',method:'GET',write:false,download:true,ref,referenceOwner:true};
 }
 const match=/^\/api\/projects\/material-reference\/([a-z-]+)$/.exec(route);
 if(!match||!addressedMaterialRead(match[1]))return null;
 const request=materialRequest('/api/research/materials/'+match[1]);
 if(!request||request.write||request.method!=='POST'&&!(match[1]==='retained-figure-export'&&request.method==='GET'&&request.querySelection))throw new AppError('INVALID');
 return {...request,referenceOwner:true};
}
export function addressedMaterialReference(data,request={material:'read'}){
 const ref=request.ref??materialReadReference(request.material,data);
 if(!validMaterialReference(ref)||!researchId(ref.workspaceId))throw new AppError('INVALID');
 return materialReference(ref);
}
export function addressedMaterialCommand(request,data){const ref=addressedMaterialReference(data,request);return {ref,command:withMaterialReadReference(request.material,data,ref)};}
