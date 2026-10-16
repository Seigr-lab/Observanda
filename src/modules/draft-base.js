import {AppError} from '../errors.js';
import {ModuleHistory} from './history.js';
import {requireValue} from './validation.js';

const history=(workspace,id)=>new ModuleHistory(workspace,workspace.moduleHistory?{context:operation=>workspace.moduleHistory(id,operation)}:{});

// Saved module revisions are immutable and retained by the module catalogue.
// Checkpoints pin them instead of duplicating a potentially large base body.
export async function validateDraftBase(workspace,draft){
 if(draft.baseRevision===null)return;
 await history(workspace,draft.id).context(async context=>{
  const member=await context.member(draft.id),type=member?.type??(member&&context.catalogue?(await context.catalogue.selected(context.head,draft.id)).type:null);
  requireValue(member&&type===draft.type&&member.revision>=draft.baseRevision,'Recovery base revision');
 },draft.id);
}
export async function expandDraftBase(workspace,draft){
 if(!Object.hasOwn(draft,'baseRevision'))return draft;
 const {baseRevision,...value}=draft;
 if(baseRevision===null)return {...value,base:null};
 const {entity}=await history(workspace,draft.id).read({id:draft.id,revision:baseRevision});
 if(entity.type!==draft.type||entity.revision!==draft.expectedRevision)throw new AppError('CATALOGUE_DAMAGED');
 return {...value,base:entity.data};
}
