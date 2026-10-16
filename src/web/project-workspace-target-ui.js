import {localizedText} from './i18n/index.js';
const text=localizedText('projectStorage');
// Destination credentials are entered only when device access cannot open it.
export function projectWorkspaceTargetUI({state,api,esc,field,current,changed,ready}){
 const valid=entry=>current(entry)&&entry.context===state.storage?.contextId;
 const release=target=>target&&api('/api/projects/move/target/release',{target:target.id},{adopt:false}).catch(()=>{});
 async function open(entry,credentials={username:'',password:'',recovery:''}){
  const path=entry.targetPath,request=entry.targetRequest=(entry.targetRequest??0)+1;entry.targetBusy=true;entry.targetError='';changed(entry);
  try{const target=await api('/api/projects/move/target/open',{path,...credentials},{adopt:false});if(!valid(entry)||request!==entry.targetRequest||path!==entry.targetPath){await release(target);return;}entry.target=target;entry.targetAuth=false;await ready(entry);}
  catch(error){if(valid(entry)&&request===entry.targetRequest){entry.targetError=error.message;entry.targetAuth=true;}}
  finally{if(valid(entry)&&request===entry.targetRequest){entry.targetBusy=false;changed(entry);}}
 }
 return {
  async load(entry){try{const result=await api('/api/projects/move/targets',{}, {adopt:false});if(valid(entry)){entry.workspaces=result.workspaces;changed(entry);}}catch(error){if(valid(entry)){entry.targetError=error.message;changed(entry);}}},
  async select(entry,path){entry.targetRequest=(entry.targetRequest??0)+1;const old=entry.target;entry.target=null;entry.targetPath=path;entry.targetAuth=false;entry.targetError='';entry.targetBusy=false;await release(old);if(!valid(entry))return;if(path)await open(entry);else{await ready(entry);changed(entry);}},
  open,
  view(entry,{fixed=false}={}){
   return (fixed?'<p>'+esc(entry.targetTitle??entry.targetPath)+'</p>':field(text('destinationWorkspace'),'<select name="targetWorkspace" '+(entry.busy||entry.started?'disabled':'')+'><option value="">'+esc(text('currentWorkspace'))+'</option>'+(entry.workspaces??[]).map(item=>'<option value="'+esc(item.path)+'" '+(item.path===entry.targetPath?'selected':'')+'>'+esc(item.title)+'</option>').join('')+'</select>'))+
    (entry.targetBusy?'<p role="status">'+esc(text('openingDestination'))+'</p>':'')+(entry.targetError?'<p role="alert">'+esc(entry.targetError)+'</p>':'')+
    (entry.targetAuth?'<fieldset '+(entry.targetBusy?'disabled':'')+'>'+field(text('accessUsername'),'<input name="targetUsername" autocomplete="username">')+field(text('destinationPassword'),'<input name="targetPassword" type="password" autocomplete="current-password">')+'<details><summary>'+esc(text('useRecovery'))+'</summary>'+field(text('recoveryKey'),'<input name="targetRecovery" type="password" autocomplete="off">')+'</details><button type="button" class="button" data-action="project-storage-target-unlock">'+esc(text('unlockWorkspace'))+'</button></fieldset>':'');
  },
  async unlock(entry,form){const credentials={username:form.elements.targetUsername.value,password:form.elements.targetPassword.value,recovery:form.elements.targetRecovery.value};form.elements.targetPassword.value='';form.elements.targetRecovery.value='';await open(entry,credentials);},
  accessOptions:entry=>error=>error.destinationWorkspaceId&&entry.target?{unlock:(credentials,options)=>api('/api/projects/move/target/unlock',{target:entry.target.id,...credentials},{...options,adopt:false})}:{},
  release:entry=>release(entry.target)
 };
}
