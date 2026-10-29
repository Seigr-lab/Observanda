import {isConfigurationReference} from './configuration-reference.js';
import {configurationDocumentClient} from './configuration-document-client.js';
import {labBookProfileLabel} from './project-type-presentation.js';
import {researchContext} from './project-context.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('configurationEditor',key,args);
export function configurationProfileLabels({state,api,esc}){
 const entries=new Map();let context=null;
 const key=book=>JSON.stringify([researchContext(state),state.book?.id,book.id,book.configuration?.root]);
 function check(){const next=JSON.stringify([researchContext(state),state.book?.id]);if(context===next)return;context=next;observer?.disconnect();for(const entry of entries.values())entry.client?.stop();entries.clear();}
 const labels=entry=>entry?.rows?[...entry.rows.map(row=>labBookProfileLabel(row.value.id)),...(entry.total>entry.rows.length?[text('moreProfiles',{count:entry.total-entry.rows.length})]:[])]:[text(entry?.error?'profilesFailed':'profilesLoading')];
 function types(book){check();if(!isConfigurationReference(book.configuration))return (book.configuration?.profiles??[]).filter(profile=>profile.enabled).map(profile=>labBookProfileLabel(profile.id));return labels(entries.get(key(book)));}
 function paint(book){
  for(const node of document.querySelectorAll('[data-configuration-profiles="'+book.id+'"]')){
   const entry=entries.get(key(book));node.innerHTML=types(book).map(label=>'<span>'+esc(label)+'</span>').join('')+(entry?.error?'<button type="button" class="button subtle" data-action="configuration-profile-retry" data-id="'+book.id+'">'+esc(text('retry'))+'</button>':'');
  }
 }
 async function load(book){
  check();const stamp=key(book),previous=entries.get(stamp);if(previous?.pending||previous?.rows)return;
  while(entries.size>=64){const oldest=[...entries].find(([,entry])=>!entry.pending);if(!oldest)return;oldest[1].client?.stop();entries.delete(oldest[0]);}
  const entry={pending:true,rows:null,error:null,client:configurationDocumentClient({state,api})};entries.set(stamp,entry);
  try{
   await entry.client.open({workspaceId:state.book.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'},{saved:true});
   const result=await entry.client.window('profiles',{enabled:true,offset:0,limit:8});
   if(entries.get(stamp)!==entry)return;entry.rows=result.rows;entry.total=result.total;
  }catch(reason){if(entries.get(stamp)===entry&&reason.name!=='AbortError')entry.error=reason;}
  finally{entry.pending=false;entry.client.stop();if(entries.get(stamp)===entry)paint(book);}
 }
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(records=>{for(const record of records)if(record.isIntersecting){observer.unobserve(record.target);const book=state.book?.notebooks.find(book=>book.id===record.target.dataset.configurationProfiles);if(book&&isConfigurationReference(book.configuration))void load(book);}},{rootMargin:'100px'}):null;
 function bind(){check();for(const node of document.querySelectorAll('[data-configuration-profiles]')){if(node.dataset.configurationProfilesObserved)continue;node.dataset.configurationProfilesObserved='true';const book=state.book?.notebooks.find(book=>book.id===node.dataset.configurationProfiles);if(!book||!isConfigurationReference(book.configuration))continue;if(observer)observer.observe(node);else void load(book);}}
 async function action(control){if(control.dataset.action!=='configuration-profile-retry')return false;const book=state.book?.notebooks.find(book=>book.id===control.dataset.id);if(book){entries.delete(key(book));await load(book);}return true;}
 return {types,bind,action};
}
