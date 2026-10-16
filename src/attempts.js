import {workspaceReferenceNamespaceMatches} from './research-reference-namespace.js';
import {AppError} from './errors.js';
import {appendOnlyAttempt,attemptReferences} from './web/attempt-model.js';
import {ResearchMaterials} from './research-materials.js';
import {revisionText} from './web/revision-model.js';

// Executed within the caller's record transaction. References are already
// pinned immutable revisions; validating them never captures a moving head.
export async function validateAttemptChange(workspace,workspaceId,previous,record){
 if(!appendOnlyAttempt(previous?.attempt,record.attempt))throw new AppError('ATTEMPT_IMMUTABLE');
 const retained=new Set(attemptReferences(previous?.attempt).map(revisionText)),materials=new ResearchMaterials(workspace);
 for(const ref of attemptReferences(record.attempt)){
  if(!ref.workspaceId||!await workspaceReferenceNamespaceMatches(workspace,ref)||ref.kind==='record'&&ref.id===record.id)throw new AppError('ATTEMPT_REFERENCE');
  if(!retained.has(revisionText(ref))){await materials.checkReference(ref);retained.add(revisionText(ref));}
 }
}
