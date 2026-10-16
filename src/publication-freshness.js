import {serialize} from './storage-format.js';
import {revisionId} from './web/revision-model.js';

function inputs(snapshot){
 const {revision,updatedAt,...metadata}=snapshot.metadata;void revision;void updatedAt;
 return {metadata,selection:snapshot.websiteSelection,records:snapshot.membership??snapshot.records};
}
// A retained edition keeps its immutable host snapshot. Other websites may
// advance that host without changing this website or its research membership.
// Source authorization and destination configuration have separate owners.
export async function publicationRevisionCurrent(workspace,revision,{current}={}){
 if(!revisionId(revision))return false;
 current??=await workspace.outline();
 if(revision===current.etag)return true;
 if(!workspace.websiteId)return false;
 return workspace.catalogue(async store=>{
  let before;
  try{before=await store.snapshot(revision);}catch(error){if(['NOT_FOUND','RECORD_HISTORY_MISSING'].includes(error.code))return false;throw error;}
  const after=await store.snapshot(current.etag);
  return serialize(inputs(before))===serialize(inputs(after));
 });
}
