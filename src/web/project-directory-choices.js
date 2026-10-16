import {localizedText} from './i18n/index.js';
const text=localizedText('projectChoices');
export function projectDirectoryChoices({state,api,esc,changed}){
 let generation=0,context=null,exclude=null;const pages=new Map(),known=new Map();
 const page=kind=>{if(!pages.has(kind))pages.set(kind,{kind,query:'',items:[],total:0,revision:null,loaded:false,loading:false,error:'',request:0,timer:null});return pages.get(kind);};
 const current=(epoch,value,request)=>epoch===generation&&context===state.storage?.contextId&&value.request===request;
 async function load(kind,{more=false,retry=true}={}){
  const value=page(kind),epoch=generation,request=++value.request;value.loading=true;value.error='';changed(kind);
  try{
   const result=await api('/api/projects/choices',{kind,exclude,query:value.query,offset:more?value.items.length:0,limit:25,revision:more?value.revision:null},{adopt:false});
   if(!current(epoch,value,request))return;
   value.items=more?[...value.items,...result.projects]:result.projects;for(const entry of value.items)known.set(entry.projectId,entry);value.total=result.total;value.revision=result.revision;value.loaded=true;
  }catch(error){if(!current(epoch,value,request))return;if(error.code==='CONFLICT'&&more&&retry){value.loading=false;return load(kind,{retry:false});}value.error=error.message??text('failed');}
  finally{if(current(epoch,value,request)){value.loading=false;changed(kind);}}
 }
 function reset(){generation++;for(const value of pages.values())clearTimeout(value.timer);pages.clear();known.clear();context=state.storage?.contextId;}
 return {
  start(id,{parents=false,templates=true,bookParents=false,recordParents=false}={}){reset();exclude=id;if(parents)void load('parents');if(bookParents)void load('book-parents');if(recordParents)void load('record-parents');if(templates)void load('templates');},reset,
  rows(kind,fallback=[]){if(context!==state.storage?.contextId)return [];const value=page(kind);return value.loaded?value.items:fallback;},known:id=>context===state.storage?.contextId?known.get(id):undefined,query:kind=>page(kind).query,
  view(kind){const value=page(kind);return '<div data-project-choices="'+kind+'"><small>'+esc(text(kind))+'</small><input type="search" data-project-choice-search="'+kind+'" value="'+esc(value.query)+'" maxlength="160" aria-label="'+esc(text(kind))+'" placeholder="'+esc(text(kind))+'"><div class="inline-actions"><span class="muted" role="status" data-choice-status></span><button type="button" class="button subtle" data-action="project-choices-more" data-kind="'+kind+'" hidden>'+esc(text('more'))+'</button><button type="button" class="button subtle" data-action="project-choices-retry" data-kind="'+kind+'" hidden>'+esc(text('retry'))+'</button></div></div>';},
  paint(host,kind){const node=host?.querySelector('[data-project-choices="'+kind+'"]');if(!node)return;const value=page(kind);node.querySelector('[data-choice-status]').textContent=value.error||text(value.loading?'loading':'count',{count:value.items.length,total:value.total});node.querySelector('[data-action=project-choices-more]').hidden=!value.loaded||value.items.length>=value.total;node.querySelector('[data-action=project-choices-more]').disabled=value.loading;node.querySelector('[data-action=project-choices-retry]').hidden=!value.error;},
  input(element){const kind=element.dataset.projectChoiceSearch;if(!['parents','templates','book-parents','record-parents'].includes(kind))return false;const value=page(kind);clearTimeout(value.timer);value.request++;value.query=element.value;value.items=[];value.loaded=true;value.total=0;value.revision=null;value.loading=true;value.error='';changed(kind);value.timer=setTimeout(()=>void load(kind),200);return true;},
  async action(node){if(!['project-choices-more','project-choices-retry'].includes(node.dataset.action))return false;const kind=node.dataset.kind;if(['parents','templates','book-parents','record-parents'].includes(kind)&&!page(kind).loading)await load(kind,{more:node.dataset.action==='project-choices-more'});return true;}
 };
}
