import {projectApiRoute,ownedRoute,researchOwner} from '../project-context.js';
// Capture the editor owner once. Recovery finishing after navigation still
// reaches that owner; a different workspace session cannot inherit the request.
export function moduleOwnerApi({api,state},moduleId){
 const owner=researchOwner(state),workspaceId=state.book.id,context=state.storage?.contextId;
 return (route,data,options={})=>{
  if(context!==state.storage?.contextId)throw {code:'WORKSPACE_CHANGED'};
  if(owner&&route.startsWith('/api/modules/history?')){
   const query=new URLSearchParams(route.slice(route.indexOf('?')+1)),revision=query.get('revision');
   route='/api/modules/history/'+(revision===null?'page':'read');data={workspaceId,id:query.get('id'),...(revision===null?{cursor:query.get('cursor')}:{revision:Number(revision)})};
  }
  if(route.startsWith('/api/modules/drafts/'))data={...data,workspaceId,moduleId};
  if(owner&&route.startsWith('/api/calendars/'))data={...data,workspaceId};
  if(owner&&data?.workspaceId!==undefined&&data.workspaceId!==workspaceId)throw {code:'WORKSPACE_CHANGED'};
  return api(projectApiRoute(route,owner),data,{...options,owner,adopt:false,view:ownedRoute('#/modules/'+moduleId,owner?(typeof owner==='object'?owner:{projectId:owner}):null)});
 };
}
