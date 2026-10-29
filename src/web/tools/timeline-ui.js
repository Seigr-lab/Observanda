import {timelineSourcesUI} from './timeline-sources-ui.js';
import {moduleEditor} from '../modules/workbench.js';
import {timelineDefaults,timelineQuery,validTimelineQuery} from './timeline-model.js';
import {validateTimelinePage} from './timeline-page.js';
import {timelinePageHTML} from './timeline.js';
import {STATUSES} from '../record-types.js';
import {t} from '../i18n/index.js';
const tr=(key,values)=>t('timeline',key,values),limit=50;

export async function createTimelineUI(services){
 const {state,api,esc,access=operation=>operation()}=services;
 const aggregate=()=>!!state.workspaceOutline&&!state.projectOwner?.labBookId,sourceChoices=timelineSourcesUI(services);
 let initialSource=null,context,stamp=null,page=null,loading=false,error='',attempt=null,controller=null,timer=null,resume=null;
 const root=()=>document.querySelector('[data-timeline-results]');
 const active=()=>state.page==='module'&&state.moduleId==='timeline'&&!state.access?.locked&&!state.storageUnavailable&&!!context?.current&&!!root();
 const key=()=>JSON.stringify([state.storage?.contextId,state.book?.id,context?.current?.id,context?.current?timelineQuery(context.current.data):null]);
 function abort(){controller?.abort();controller=null;clearTimeout(timer);timer=null;}
 function stop(){sourceChoices.close();if(page)resume={key:stamp,cursor:page.cursor,snapshotId:page.snapshotId};abort();stamp=null;page=null;loading=false;error='';}
 function paint(){
  const node=root();if(!node||!active())return;node.setAttribute('aria-busy',String(loading));
  const button=(label,action,disabled=false)=>'<button type="button" class="button" data-action="module-command" data-command="timeline-'+action+'" '+(disabled?'disabled':'')+'>'+esc(tr(label))+'</button>';
  node.innerHTML=(error?'<div role="alert"><p>'+esc(error)+'</p>'+button('retry','retry',loading)+'</div>':'')+
   (loading?'<p role="status">'+esc(tr('loading'))+'</p>':'')+
   (page?timelinePageHTML(page,context.current.data,esc):'')+
   '<div class="module-actions">'+button('previous','previous',loading||!page?.previousCursor)+button('next','next',loading||!page?.nextCursor)+button('refresh','refresh',loading)+'</div>';
  const branches=node.querySelector('[data-branch-color]');if(branches)branches.style.setProperty('--branch-color',context.current.data.color);
 }
 async function load(cursor=null,{focus=false,unlock=false}={}){
  abort();if(!active())return;stamp=key();attempt=cursor;
  const query=timelineQuery(context.current.data);
  if(!validTimelineQuery(query)){page=null;loading=false;error=tr('invalidFilters');paint();return;}
  const request=controller=new AbortController(),current=stamp,snapshotId=cursor?(page?.snapshotId??resume?.snapshotId??null):null;loading=true;error='';paint();
  const valid=()=>!request.signal.aborted&&active()&&key()===current;
  try{
   const run=()=>{request.signal.throwIfAborted();return api(aggregate()?'/api/projects/'+(state.projectOwner?.projectId?state.projectOwner.projectId+'/':'')+'timeline-collection/query':'/api/workspace/read/timeline',{workspaceId:state.book.id,query,cursor,limit},{adopt:false,signal:request.signal});};
   const result=await (unlock?access(run):run());
   if(!valid())return;
   try{validateTimelinePage(result,{workspaceId:state.book.id,query,limit,snapshotId,collection:aggregate()});}catch{throw Error(tr('invalidResponse'));}
   page=result;resume={key:current,cursor:result.cursor,snapshotId:result.snapshotId};
  }catch(e){if(!valid())return;error=e.message??tr('failed');}
  finally{if(valid()){loading=false;controller=null;paint();if(focus)(root().querySelector('[data-timeline-status]')??root().querySelector('[data-command="timeline-retry"]'))?.focus();}}
 }
 function bind(){
  editor.bind();if(aggregate()&&context?.current)sourceChoices.bind(context.current);if(!active()){stop();return;}
  if(stamp!==key()){page=null;void load(resume?.key===key()?resume.cursor:null);}else paint();
 }
 function changed(){
  if(stamp===key()){paint();return;}
  abort();stamp=key();page=null;resume=null;loading=true;error='';paint();timer=setTimeout(()=>void load(),180);
 }
 const result=()=>'<section class="tool-results" data-timeline-results aria-label="'+esc(tr('label'))+'"></section>';
 function sources(value,key,items){
  const choices=[...items,...value[key].filter(id=>!items.some(item=>item.id===id)).map(id=>({id,title:tr('unavailable',{id})}))];
  return '<fieldset><legend>'+esc(tr(key))+'</legend>'+choices.map(item=>'<label class="checkbox"><input type="checkbox" data-timeline-source="'+key+'" value="'+item.id+'" '+(value[key].includes(item.id)?'checked':'')+'>'+esc(item.title)+'</label>').join('')+'</fieldset>';
 }
 const editor=await moduleEditor(services,{id:'timeline',label:tr('label'),paged:true,types:[{id:'timeline-view',label:tr('plural'),singular:tr('singular'),empty:tr('empty')}],
  showTabs:()=>false,openSection:d=>d.expectedRevision!==null?'timeline':'details',savedSection:()=> 'timeline',sections:()=>[['timeline',tr('label')]],
  blank:()=>({name:'',links:[],engine:1,...timelineDefaults()}),card:(e,c)=>'<h2>'+c.esc(e.data.name)+'</h2>',
  section(section,c){context=c;return '<div class="dedicated-tool"><p>'+esc(tr('ordering'))+'</p>'+result()+'</div>';},
  form(d,c){
   context=c;if(d.expectedRevision===null&&initialSource!==d.id){initialSource=d.id;c.openDisclosure('timeline-sources');}const value=d.data;
   return '<div class="dedicated-tool">'+c.input('name',tr('name'))+'<p>'+esc(tr('ordering'))+'</p><details '+c.disclosure('timeline-sources')+'><summary>'+esc(tr('sources'))+'</summary><p>'+esc(tr('sourceHint'))+'</p><div class="tool-fields">'+(aggregate()?sourceChoices.field('projects')+sourceChoices.field('books'):sources(value,'projects',state.book.projects)+sources(value,'books',state.book.notebooks))+'</div>'+
    c.check('descendants',tr('descendants'))+'<div class="tool-fields">'+c.select('groupBy',tr('branches'),[['book',tr('books')],['project',tr('projects')]])+
    c.select('density',tr('density'),[['comfortable',tr('comfortable')],['compact',tr('compact')]])+c.input('color',tr('color'),'color')+c.input('from',tr('from'),'date')+c.input('to',tr('to'),'date')+c.input('query',tr('query'),'search','maxlength="200"')+
    c.select('status',tr('status'),[['',tr('allStatuses')],...STATUSES.map(s=>[s,tr(s==='failed'?'failedStatus':s)]),...(!STATUSES.includes(value.status)&&value.status?[[value.status,value.status]]:[])])+'</div>'+c.check('descending',tr('descending'))+'</details>'+result()+c.referenceFields(value.links)+'</div>';
  },
  input(el,c){context=c;if(el.dataset.timelineSource){const k=el.dataset.timelineSource;c.current.data[k]=el.checked?[...c.current.data[k],el.value]:c.current.data[k].filter(id=>id!==el.value);}changed();return !!el.dataset.timelineSource;},
  async action(name,button){if(await sourceChoices.action(name,button))return;if(name==='timeline-next'&&page?.nextCursor)await load(page.nextCursor,{focus:true});else if(name==='timeline-previous'&&page?.previousCursor)await load(page.previousCursor,{focus:true});else if(name==='timeline-refresh')await load(null,{focus:true});else if(name==='timeline-retry')await load(attempt,{focus:true,unlock:true});}
 });
 // The shared Refresh action reloads saved view settings; also refresh its records.
 async function action(name,button){await editor.action(name,button);if(name==='refresh')await load();}
 return {...editor,action,bind,input:el=>sourceChoices.input(el)||editor.input(el),deactivate(){stop();editor.deactivate();},dispose(){stop();resume=null;editor.dispose();}};
}
