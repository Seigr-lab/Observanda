// Draft transport and recovery commands run against their authenticated owner.
// Workspace and project HTTP routes use this same admission contract.
import {ResearchDrafts} from './research-drafts.js';
import {ResearchDraftContent} from './research-draft-content.js';
import {ResearchDraftTransfer} from './research-draft-transfer.js';
import {RecordDraftReview} from './record-draft-review.js';
import {RecordWritingDrafts} from './record-writing-drafts.js';
import {RecordValueDrafts} from './record-value-drafts.js';
import {MediaStore} from './media.js';
import {MAX_BYTES} from './model.js';
import {MAX_RECORD_COMMAND_BYTES} from './web/research-capacity.js';
import {AppError} from './errors.js';

const commands=new Map();
function define(name,Owner,method,{write=false,large=false,cancellable=false,run}={}){
 commands.set('/api/research/drafts/'+name,{write,cancellable,limit:large?MAX_RECORD_COMMAND_BYTES:MAX_BYTES,capacity:large?'checkpointRequest':null,run:run??((storage,data,options)=>new Owner(storage,...(Owner===RecordDraftReview?[new MediaStore(storage)]:[]))[method](data,options))});
}
for(const method of ['list','write','remove'])define(method,ResearchDrafts,method,{write:method!=='list',large:method==='write'});
for(const [name,Owner] of [['writing',RecordWritingDrafts],['values',RecordValueDrafts]])for(const method of ['read','write'])define(name+'/'+method,Owner,method,{write:method==='write',large:method==='write'});
define('content',ResearchDraftContent,'read');
define('read',null,null,{run:async(storage,data)=>{
 if(!data||Object.keys(data).some(key=>!['id','summary'].includes(key))||data.summary!==undefined&&typeof data.summary!=='boolean')throw new AppError('INVALID');
 const result=await new ResearchDrafts(storage).read(data.id,{header:true,...(data.summary?{expand:false}:{})});
 if(!result)throw new AppError('NOT_FOUND');
 if(result.draft.workspaceId!==(await storage.outline()).metadata.id)throw new AppError('WORKSPACE_CHANGED');
 if(data.summary&&[1,2].includes(result.draft.formatVersion)){
  const {draft,revision}=result;return {revision,draft:{formatVersion:draft.formatVersion,id:draft.id,workspaceId:draft.workspaceId,updatedAt:draft.updatedAt,count:draft.changes.length,titles:draft.changes.slice(0,3).map(change=>change.record.title.slice(0,160))}};
 }
 return result;
}});
for(const method of ['start','part','finish','readPart','readBase'])define('transfer/'+method,ResearchDraftTransfer,method,{write:['start','part','finish'].includes(method),cancellable:method==='finish'});
for(const method of ['prepare','choose','apply','editWrite','page','value','records','content','editFields','editRead','editFigures','editAttempts','editChoices'])define('review/'+method,RecordDraftReview,method,{write:['prepare','choose','apply','editWrite'].includes(method),large:true});
export const recordDraftRequest=route=>commands.get(route)??null;
