import {ContentAccess} from './content-access.js';
import {liveValid as valid} from './live-protocol.js';
import {uuid} from '../modules/validation.js';

// Call inside the same transaction as the protected read or mutation.
export async function authorizeLive(workspace,identity,scope,{write=false}={}){
 valid(scope&&[scope.workspaceId,scope.organizationId,scope.grantId].every(uuid));
 const service=new ContentAccess(workspace),authority=await service.organizations.load();
 valid(authority.authorityId===scope.workspaceId,'COLLABORATION_DENIED');
 const principalId=service.organizations.principal(authority,identity),access=await service.authorize({...scope,principalId,write});
 return {...access,principalId,name:authority.principals.find(p=>p.id===principalId)?.name??''};
}
export async function liveRecord(store,access,id){
 valid(uuid(id));const member=await store.member(await store.snapshot(),id);
 valid(member&&access.notebookIds.includes(member.notebookId),'COLLABORATION_DENIED');
 return store.record(id,member.revision);
}
