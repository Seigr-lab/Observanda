import {researchId} from './research-reference.js';
import {t} from './i18n/index.js';

// Only the selected owners' directory pages are retained. Completed commands
// invalidate names and membership; record writes and progress never do.
export function labBookDirectoryState({state,api,changed}){
 let context=null,generation=0,pages=new Map(),entered=null,completed=new Set();
 const key=()=>JSON.stringify([state.storage?.contextId,state.storage?.researchStorage,!!state.access?.locked,!!state.storageUnavailable,!!state.newWorkspace]);
 function sync(){const next=key();if(context!==next){context=next;generation++;pages=new Map();entered=null;completed=new Set();}}
 const available=()=>state.storage?.researchStorage==='catalogue'&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace;
 function page(projectId){sync();if(!pages.has(projectId))pages.set(projectId,{projectId,items:[],next:null,total:null,revision:null,loaded:false,loading:false,error:'',depth:0,wantedDepth:1,stale:false,task:null,refresh:false,more:false,version:0});return pages.get(projectId);}
 const current=(token,value)=>token===generation&&context===key()&&pages.get(value.projectId)===value&&available();
 async function read(value,{more,token,version}){
  const depth=value.wantedDepth;let restart=false;
  for(let attempt=0;;attempt++){
   const append=more&&!restart&&value.loaded,items=append?[...value.items]:[];let after=append?value.next:null,revision=append?value.revision:null,total=value.total,count=append?value.depth:0;
   try{
    do{
     const result=await api('/api/projects/'+value.projectId+'/lab-books/list',{after,limit:50,revision},{adopt:false});
     if(!current(token,value)||version!==value.version)return null;
     items.push(...result.items);after=result.next;revision=result.revision;total=result.total;count++;
    }while(after&&count<depth);
    return {items,next:after,total,revision,depth:count};
   }catch(error){if(error.code!=='CONFLICT'||attempt>=1)throw error;restart=true;}
  }
 }
 function request(projectId,{more=false,invalidate=false}={}){
  const value=page(projectId);if(!available())return Promise.resolve();
  if(more){if(value.task||value.loaded&&!value.next)return value.task??Promise.resolve();value.more=true;value.wantedDepth=value.depth+1;}
  else{if(value.task&&!invalidate)return value.task;value.refresh=true;value.stale=false;value.version++;}
  if(value.task)return value.task;
  const token=generation;value.loading=true;value.error='';
  value.task=(async()=>{
   try{
    while(current(token,value)&&(value.refresh||value.more)){
     const next=value.more&&!value.refresh;value.refresh=value.more=false;const version=value.version;
     try{const result=await read(value,{more:next,token,version});if(!current(token,value))return;if(version!==value.version)continue;if(!result)return;Object.assign(value,result,{loaded:true,error:'',stale:false});}
     catch(error){if(!current(token,value))return;if(version!==value.version)continue;value.error=error.message??t('labBookDirectory','failed');}
    }
   }finally{if(current(token,value)){value.loading=false;value.task=null;changed(projectId);}}
  })();
  changed(projectId);return value.task;
 }
 async function activity(snapshot){
  sync();if(!available()||!state.book||snapshot.contextId!==state.storage?.contextId)return;
  const observed=new Set(snapshot.operations.map(entry=>entry.id));for(const id of completed)if(!observed.has(id))completed.delete(id);
  const affected=new Set();let moved=false;
  for(const entry of snapshot.operations){
   if(entry.state!=='completed'||completed.has(entry.id))continue;
   const match=/^\/api\/projects\/([a-f0-9-]{36})\/lab-books\/(?:(create|import)(?:\/(resume|cancel))?|([a-f0-9-]{36})\/(settings\/save|storage\/(?:rename|delete(?:\/resume)?|move(?:\/resume)?)))$/.exec(entry.kind);
   if(!match||!researchId(match[1])||match[4]&&!researchId(match[4]))continue;
   completed.add(entry.id);
   affected.add(match[1]);
   if(match[5]?.startsWith('storage/move'))moved=true;
  }
  if(moved){
   // A move's observation identifies its source, not its destination. Invalidate
   // cached membership conservatively, but read only the visible candidate.
   for(const value of pages.values())if(!affected.has(value.projectId)){value.stale=true;value.version++;}
   if(state.page==='project'&&state.projectOwner?.projectId)affected.add(state.projectOwner.projectId);
  }
  await Promise.all([...affected].filter(id=>pages.has(id)).map(id=>request(id,{invalidate:true})));
 }
 return {page,activity,entries(){sync();return [...pages.values()].flatMap(value=>value.items.map(entry=>({...entry,projectId:value.projectId})));},
  refresh:projectId=>request(projectId,{invalidate:true}),more:projectId=>request(projectId,{more:true}),
  bind(){sync();if(!available()){entered=null;return;}const id=state.projectOwner?.projectId,view=state.page==='project'?id:null,entering=!!view&&view!==entered;entered=view;if(!id)return;const value=page(id);if(entering||view&&value.stale)return request(id,{invalidate:value.loaded});if(!value.loaded&&!value.error)return request(id);}
 };
}
