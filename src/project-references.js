import {validProjectTarget} from './web/project-reference.js';
import {locateResearchReference} from './research-owner-reference.js';
import {AppError} from './errors.js';
export class ProjectReferences{
 constructor(router){this.router=router;}
 async locate(target){
  if(!validProjectTarget(target))throw new AppError('INVALID');
  const result=await this.router.withProject(target.projectId,storage=>locateResearchReference(storage,target),{action:'read',target});
  return {...result,projectId:target.projectId};
 }
}
