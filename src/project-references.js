import {validProjectTarget} from './web/project-reference.js';
import {locateResearchReference,resolveResearchReference} from './research-owner-reference.js';
import {AppError} from './errors.js';
export class ProjectReferences{
 constructor(router){this.router=router;}
 async locate(target){
  if(!validProjectTarget(target))throw new AppError('INVALID');
  const result=await this.router.withProject(target.projectId,storage=>locateResearchReference(storage,target),{action:'read',target});
  return {...result,projectId:target.projectId};
 }
 async resolve(target){
  if(!validProjectTarget(target))throw new AppError('INVALID');
  return this.router.withProject(target.projectId,storage=>resolveResearchReference(storage,target),{action:'read',target});
 }
}
