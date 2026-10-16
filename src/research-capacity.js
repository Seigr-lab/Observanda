import {AppError} from './errors.js';
import {researchCapacityIssue} from './web/research-capacity.js';
export function admitResearchBytes(owner,bytes,context){
 const issue=researchCapacityIssue(owner,bytes,context);
 if(issue)throw new AppError(issue.code,issue.details);
}
