import {researchId} from './research-reference.js';
import {t} from './i18n/index.js';
import {workspaceAvailable} from './workspace-availability.js';

// Only the selected owners' directory pages are retained. Completed commands
// invalidate names and membership; record writes and progress never do.
export function labBookDirectoryState({state,api,changed,counted=changed}){
 let context=null,generation=0,pages=new Map(),entered=null,completed=new Set(),counts=new Map(),recounted=new Set(),countQueue=Promise.resolve(),countTurn=0;
 const key=()=>JSON.stringify([state.storage?.contextId,workspaceAvailable(state),!!state.access?.locked,!!state.storageUnavailable,!!state.newWorkspace]);
 function sync(){const next=key();if(context!==next){context=next;generation++;pages=new Map();entered=null;completed=new Set();counts=new Map();recounted=new Set();countQueue=Promise.resolve();countTurn=0;}}
 const available=()=>workspaceAvailable(state)&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace;
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
 // A lab book's record count lives in its own catalogue. Counts are read after the
 // cards render, one lab book at a time, with its revision; each is kept until that
 // lab book is seen to change. A book that cannot be read now (locked with its own
 // password, moved, unavailable) shows no count and asks for nothing.
 const countKey=entry=>entry.labBookId+':'+entry.namespaceId;
 function recordCount(entry){sync();const value=counts.get(countKey(entry));return Number.isSafeInteger(value?.count)?value.count:null;}
 async function readCount(projectId,entry,slot,token){
  if(token!==generation||counts.get(countKey(entry))!==slot||!available()){slot.loading=false;return;}
  const version=slot.version;let next;
  try{
   const result=await api('/api/projects/'+projectId+'/lab-books/'+entry.labBookId+'/workspace/read/version',{workspaceId:entry.namespaceId},{adopt:false});
   next=result?.workspaceId===entry.namespaceId&&Number.isSafeInteger(result.recordCount)&&result.recordCount>=0?{count:result.recordCount,etag:result.etag}:{count:null,etag:null};
  }catch{next={count:null,etag:null};}
  if(token!==generation||counts.get(countKey(entry))!==slot)return;
  const shown=slot.count!==next.count;Object.assign(slot,next,{loading:false,stale:slot.version!==version});
  if(shown)counted(projectId);if(slot.stale)loadCounts(projectId);
 }
 function loadCounts(projectId){
  sync();if(!available()||!researchId(projectId))return;const value=pages.get(projectId);if(!value?.loaded)return;const token=generation;
  for(const entry of value.items){
   if(!researchId(entry.namespaceId))continue;
   const key=countKey(entry);let slot=counts.get(key);
   if(slot&&(slot.loading||!slot.stale))continue;
   if(!slot)counts.set(key,slot={count:null,etag:null,stale:true,loading:false,version:0});
   slot.loading=true;countQueue=countQueue.then(()=>readCount(projectId,entry,slot,token));
  }
 }
 // Only counts already read are read again; a book never shown has none to refresh.
 function invalidateCounts(labBookId){let found=false;for(const [key,slot] of counts)if(key.startsWith(labBookId+':')){slot.stale=true;slot.version++;found=true;}return found;}
 async function activity(snapshot){
  sync();if(!available()||!state.book||snapshot.contextId!==state.storage?.contextId)return;
  const observed=new Set(snapshot.operations.map(entry=>entry.id));for(const id of completed)if(!observed.has(id))completed.delete(id);for(const id of recounted)if(!observed.has(id))recounted.delete(id);
  const affected=new Set(),recount=new Set();let moved=false;
  for(const entry of snapshot.operations){
   // Any finished command inside a lab book (records saved, removed, imported) may change its count.
   const book=entry.state==='completed'&&!recounted.has(entry.id)&&/^\/api\/projects\/([a-f0-9-]{36})\/lab-books\/([a-f0-9-]{36})\//.exec(entry.kind);
   if(book&&researchId(book[1])&&researchId(book[2])){recounted.add(entry.id);if(invalidateCounts(book[2]))recount.add(book[1]);}
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
  for(const id of recount)loadCounts(id);
 }
 // The navigation lists every project's lab books: a project's list is read
 // once when the project is shown, never again after it failed or loaded.
 function ensure(projectIds){sync();if(!available())return;for(const id of projectIds){if(!researchId(id))continue;const value=page(id);if(!value.loaded&&!value.task&&!value.error)void request(id);}}
 // Lab books added or removed outside this window (another window, an agent) change the list's
 // revision without changing the project's records: the open project's list is checked on its own.
 async function check(){
  sync();if(!available())return;const id=state.page==='project'?state.projectOwner?.projectId:null;if(!researchId(id))return;
  const value=page(id);if(!value.loaded||value.task)return;
  const result=await api('/api/projects/'+id+'/lab-books/list',{after:null,limit:1,revision:null},{adopt:false}).catch(()=>null);
  if(result&&page(id)===value&&!value.task&&result.revision!==value.revision)await request(id,{invalidate:true});
  // Records written elsewhere do not change the list: each check reads one shown lab
  // book's count again, in turn, so a change made outside this window appears.
  const shown=page(id).items.filter(entry=>researchId(entry.namespaceId));if(!shown.length)return;
  const entry=shown[countTurn++%shown.length],slot=counts.get(countKey(entry));if(slot&&!slot.loading){slot.stale=true;slot.version++;}loadCounts(id);
 }
 return {page,activity,ensure,check,recordCount,loadCounts,entries(){sync();return [...pages.values()].flatMap(value=>value.items.map(entry=>({...entry,projectId:value.projectId})));},
  refresh:projectId=>request(projectId,{invalidate:true}),more:projectId=>request(projectId,{more:true}),
  bind(){sync();if(!available()){entered=null;return;}const id=state.projectOwner?.projectId,view=state.page==='project'?id:null,entering=!!view&&view!==entered;entered=view;if(!id)return;const value=page(id);if(entering||view&&value.stale)return request(id,{invalidate:value.loaded});if(!value.loaded&&!value.error)return request(id);}
 };
}
