import {language,t,prepareNamespaces} from '../i18n/index.js';
import {repositoryLink} from '../about-ui.js';
import {guideLoader,searchGuide,helpRoute,guideWithMessages,guideMessageNamespaces} from './model.js';
export function helpUI({state,esc,render}){
 const load=guideLoader(),message=(key,parameters)=>esc(t('help',key,parameters));
 let guide=null,locale=null,loading=false,failed=false,controller=null,query='',focusTarget=null;
 const link=(title,topic,section)=>`<a href="${helpRoute(topic,section)}" data-action="help-open" data-topic="${topic??''}" data-section="${section??''}">${esc(title)}</a>`;
 async function ensure(){
  const next=language();if(next===locale&&(guide||loading||failed))return;
  controller?.abort();const request=controller=new AbortController();locale=next;loading=true;failed=false;guide=null;
  try{const result=await load(next,{signal:request.signal});await prepareNamespaces(guideMessageNamespaces(result));if(controller===request)guide=guideWithMessages(result,t);}
  catch(error){if(controller===request&&error.name!=='AbortError')failed=true;}
  finally{if(controller===request){loading=false;if(state.page==='help')render();}}
 }
 function results(){
  const matches=searchGuide(guide,query);
  return `<p role="status">${message('results',{count:matches.length})}</p>${matches.length?`<ol class="help-results">${matches.map(m=>`<li><h3>${link(m.title+' — '+m.heading,m.topicId,m.sectionId)}</h3><p>${esc(m.snippet)}</p></li>`).join('')}</ol>`:`<p>${message('empty')}</p>`}`;
 }
 function article(topic){
  return `<article class="help-article" lang="${topic.language??language()}"><h2 id="help-${topic.id}" tabindex="-1">${esc(topic.title)}</h2>${topic.sections.map(section=>`<section lang="${section.language??language()}"><h3 id="help-${topic.id}-${section.id}" tabindex="-1">${esc(section.title)}</h3>${section.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}<p class="help-permalink">${link(t('help','link'),topic.id,section.id)}</p></section>`).join('')}</article>`;
 }
 function body(){
  const first=['getting-started','records','writing','evidence','publishing','organizations'];const topics=[...guide.topics].sort((a,b)=>(first.includes(a.id)?first.indexOf(a.id):first.length)-(first.includes(b.id)?first.indexOf(b.id):first.length));
  if(query.trim())return results();
  if(!state.helpTopic)return `<h2>${message('contents')}</h2><ul class="help-topics">${topics.map(topic=>`<li>${link(topic.title,topic.id)}</li>`).join('')}</ul><p class="muted">${message('coverage')}</p>`;
  if(state.helpTopic==='all')return guide.topics.map(article).join('');
  const topic=guide.topics.find(topic=>topic.id===state.helpTopic);
  return topic&&(!state.helpSection||topic.sections.some(section=>section.id===state.helpSection))?article(topic):`<p role="status">${message('missing')}</p>`;
 }
 function view(){
  return `<section class="help-view" lang="${language()}"><h2>${message('title')}</h2><p>${message('intro')}</p><p>${repositoryLink(esc)}</p>${loading||locale!==language()?`<p role="status">${message('loading')}</p>`:failed?`<p role="alert">${message('failed')}</p><button class="button" data-action="help-retry">${message('retry')}</button>`:guide?`<div class="help-tools"><label class="field">${message('search')}<input type="search" data-help-search maxlength="200" value="${esc(query)}"></label><button class="button" data-action="help-clear">${message('clear')}</button></div><nav class="help-navigation" aria-label="${message('contents')}">${link(t('help','contents'))}${link(t('help','all'),'all')}</nav><div id="help-reading">${body()}</div>`:''}</section>`;
 }
 function stop(){controller?.abort();controller=null;loading=false;locale=null;}
 function bind(){
  if(state.page!=='help'){stop();return;}
  void ensure();
  const target=focusTarget??(state.helpSection?'help-'+state.helpTopic+'-'+state.helpSection:null);
  if(target&&guide){const node=document.getElementById(target);if(node){node.focus({preventScroll:true});node.scrollIntoView({block:'start'});}focusTarget=null;}
 }
 function action(button){
  const name=button.dataset.action;
  if(name==='help'){query='';state.page='help';state.helpTopic=null;state.helpSection=null;render();return true;}
  if(name==='help-open'){query='';state.page='help';state.helpTopic=button.dataset.topic||null;state.helpSection=button.dataset.section||null;focusTarget=state.helpTopic?'help-'+state.helpTopic+(state.helpSection?'-'+state.helpSection:''):null;render();return true;}
  if(name==='help-clear'){query='';state.helpSection=null;render();document.querySelector('[data-help-search]')?.focus();return true;}
  if(name==='help-retry'){failed=false;locale=null;render();return true;}
  return false;
 }
 return {view,bind,stop,action,input(el){
  if(!el.matches('[data-help-search]'))return false;
  query=el.value;state.helpSection=null;document.getElementById('help-reading').innerHTML=body();return true;
 }};
}
