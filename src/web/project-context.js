import {workspaceReader} from './workspace-reader.js';
import {researchId} from './research-reference.js';

// The shell owns a workspace context; the research editor owns one selected
// project namespace. Requests and route history carry that selection explicitly.
export const researchContext=state=>JSON.stringify([state.storage?.contextId,state.projectOwner?.projectId??null,state.projectOwner?.labBookId??null]);
export const researchOwner=state=>state.projectOwner?.labBookId?{projectId:state.projectOwner.projectId,labBookId:state.projectOwner.labBookId}:state.projectOwner?.projectId??null;
export const sameResearchOwner=(a,b)=>JSON.stringify([typeof a==='object'&&a!==null?a.projectId:a??null,a?.labBookId??null])===JSON.stringify([typeof b==='object'&&b!==null?b.projectId:b??null,b?.labBookId??null]);
export function projectApiRoute(route,owner){
 const projectId=typeof owner==='object'&&owner!==null?owner.projectId:owner,labBookId=typeof owner==='object'&&owner!==null?owner.labBookId:null;
 if(labBookId!==undefined&&labBookId!==null&&!researchId(labBookId))throw new TypeError('Invalid lab-book owner');
 if(projectId===null||projectId===undefined)return route;
 if(!researchId(projectId))throw new TypeError('Invalid project owner');
 return /^\/api\/(?:research\/|reviews\/|v1\/intake\/|workspace\/(?:read\/|structure$|notebook$|save$)|modules\/|laboratory(?:\/|$)|calendars\/|fonts(?:\/|$)|media(?:\/|-imports\/|-policy$)|websites\/|website\/|publishing(?:\/|$)|publication-|deployment-jobs\/|repository-setup\/|github-connection\/|local-export\/|preview$|design-preview$|export(?:\/|$))/.test(route)?'/api/projects/'+projectId+(labBookId?'/lab-books/'+labBookId:'')+route.slice(4):route;
}
export function projectRoute(hash){
 const match=/^#\/owners\/([a-f0-9-]{36})(?:\/books\/([a-f0-9-]{36}))?(\/.*)$/.exec(hash);
 return match&&researchId(match[1])&&(!match[2]||researchId(match[2]))?{projectId:match[1],...(match[2]?{labBookId:match[2]}:{}),hash:'#'+match[3]}:{projectId:null,hash};
}
export const ownedRoute=(hash,owner)=>owner?'#/owners/'+owner.projectId+(owner.labBookId?'/books/'+owner.labBookId:'')+hash.slice(1):hash;
export function projectContexts({state,api,adopt,access=operation=>operation(),afterEnter=async()=>{},isOwned=()=>false,bookOwner=()=>null}){
 let generation=0,pending=null,rootBook=null,context=state.storage?.contextId;
 const sync=()=>{if(context!==state.storage?.contextId){generation++;pending=null;context=state.storage?.contextId;rootBook=null;state.projectOwner=null;state.ownerOperation=null;}};
 function reset(){generation++;pending=null;context=state.storage?.contextId;rootBook=null;state.projectOwner=null;state.ownerOperation=null;}
 async function enter(projectId,labBookId=null){
  sync();if(labBookId!==null&&(!researchId(labBookId)||!researchId(projectId)))throw new TypeError('Invalid lab-book owner');if(projectId!==null&&!researchId(projectId))throw new TypeError('Invalid project owner');
  if(pending?.projectId===projectId&&pending.labBookId===labBookId)return pending.task;
  const request=++generation,captured=context;pending=null;
  if((state.projectOwner?.projectId??null)===projectId&&(state.projectOwner?.labBookId??null)===labBookId)return;
  const activation={request,projectId,labBookId,task:null};pending=activation;
  activation.task=(async()=>{
  try{
  const result=await access(()=>workspaceReader((route,data,options)=>api(route,data,{...options,adopt:false,owner:labBookId?{projectId,labBookId}:projectId})).read({metadataOnly:true,requireOutline:true})).catch(error=>{if(request!==generation||captured!==state.storage?.contextId)throw {name:'AbortError'};if(error.code==='STORAGE_RENAMING')error.requestedOwner={projectId,...(labBookId?{labBookId}:{})};throw error;});
  if(request!==generation||captured!==state.storage?.contextId)throw {name:'AbortError'};
  if(projectId&&(result.book.projects.length!==1||result.book.projects[0].id!==projectId||result.book.projects[0].parentId!=null||result.book.notebooks.some(n=>n.projectId!==projectId)))throw {code:'WORKSPACE_READ_INVALID'};
  if(labBookId&&(result.book.notebooks.length!==1||result.book.notebooks[0].id!==labBookId))throw {code:'WORKSPACE_READ_INVALID'};
  if(!state.projectOwner)rootBook=state.book;
  state.projectOwner=projectId?{projectId,...(labBookId?{labBookId}:{}),namespaceId:result.book.id}:null;
  if(!projectId)rootBook=null;
  adopt(result);
  try{await afterEnter(result);}catch(error){
   if(request!==generation||captured!==state.storage?.contextId)throw {name:'AbortError'};
   throw error;
  }
  if(request!==generation||captured!==state.storage?.contextId)throw {name:'AbortError'};
  }finally{if(pending===activation)pending=null;}
  })();
  return activation.task;
 }
 return {enter,reset,pending(){sync();return pending!==null;},root(){sync();return rootBook??state.book;},navigation(){sync();if(!rootBook||!state.projectOwner)return state.book;const id=state.projectOwner.projectId;return {...rootBook,projects:[...rootBook.projects.filter(p=>p.id!==id),...state.book.projects],notebooks:[...rootBook.notebooks.filter(n=>n.projectId!==id),...state.book.notebooks]};},async restore(hash){const owner=projectRoute(hash);await enter(owner.projectId,owner.labBookId??null);},
  async beforeAction(node){
   const name=node.dataset.action;
   if(['open-project','project-records','edit-project','edit-project-template'].includes(name)){
    const id=node.dataset.id;if(researchId(id)&&(state.projectOwner?.projectId!==id||state.projectOwner?.labBookId))await enter(!isOwned(id)&&(rootBook??state.book)?.projects.some(p=>p.id===id)?null:id);
   }else if(name==='site-list'){await enter(null);}
   else if(['filter-notebook','edit-notebook','rename-notebook','configure-lab-notebook','specialize-notebook'].includes(name)&&bookOwner(node.dataset.id)){const owner=bookOwner(node.dataset.id);await enter(owner.projectId,owner.labBookId);}
   else if(name==='new-notebook'&&researchId(node.dataset.id)&&isOwned(node.dataset.id))await enter(node.dataset.id);
   else if(state.projectOwner&&name==='filter-notebook'&&rootBook?.notebooks.some(n=>n.id===node.dataset.id))await enter(null);
   else if(name==='module-open'&&node.dataset.moduleProjectId!==undefined){
    const id=node.dataset.moduleProjectId;if(!researchId(id))throw new TypeError('Invalid module project owner');
    await enter(!isOwned(id)&&(rootBook??state.book)?.projects.some(p=>p.id===id)?null:id);
   }else if(name==='module-open'&&node.dataset.moduleWorkspace==='true')await enter(null);
   else if(['workspace','projects','preferences','user-profile','dashboard-settings','templates','appearance','integrations','storage','storage-workspaces','website','publishing','help'].includes(name))await enter(null);
  }
 };
}

// Deferred provider reads retain the owner selected when the query was made.
export function projectContextAPI(api,context){
 if(!Object.hasOwn(context,'projectOwner'))return api;
 const owner=researchOwner(context);
 return (route,data,options={})=>api(route,data,{owner,...options});
}
export const ownedAssetURL=(state,route)=>projectApiRoute(route,researchOwner(state));
