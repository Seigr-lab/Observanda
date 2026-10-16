import {ResearchDrafts} from './research-drafts.js';
import {withDraftDocument} from './record-draft-document.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';

// The revision guard pins the checkpoint across page requests. A second editor
// cannot silently replace the contents being inspected by the first.
export class ResearchDraftContent{
 constructor(workspace){this.workspace=workspace;}
 async read(command,{signal}={}){
  if(!command||Object.keys(command).sort().join()!=='expectedRevision,id,offset,workspaceId'||!researchId(command.id)||!researchId(command.workspaceId)||!revisionId(command.expectedRevision)||!Number.isSafeInteger(command.offset)||command.offset<0)throw new AppError('INVALID');
  signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const result=await new ResearchDrafts(this.workspace).read(command.id,{expand:false,header:true});
   if(!result||result.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   const {draft}=result;if(draft.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(draft.formatVersion!==4)throw new AppError('FORMAT');
   return withDraftDocument(store,draft,async document=>{
    const title=(await document.field(['title'],{signal})).value;
    const body=command.offset===0?(await document.field(['body'],{signal})).value:null;
    const sections=await document.tree.page(document.root,['sections'],{offset:command.offset,limit:4});
    signal?.throwIfAborted();return {id:draft.id,workspaceId:draft.workspaceId,revision:result.revision,recordId:draft.base.recordId,title,body,sections};
   });
  });
 }
}
