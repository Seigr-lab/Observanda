import {websiteSourceTools} from './website-source-tools.js';
import {fieldSourceText} from './website-source-text.js';
// The code field stays mounted while the canvas refreshes. Only validated
// HTML/CSS can replace the last rendered document; an unfinished edit stays
// in the code field and remains available to correct, undo or discard.
export function websiteSourcePane({t,escape,state,validate,locate,select,change,repaint,onAccess}){
 let active=false,kind='html',last=null,timer=null,pending=null,checking=null,runId=0;
 const field=()=>document.querySelector('[data-source-input]');
 const access=e=>{if(['AUTH','ACCESS_LOCKED','PUBLICATION_PERMISSIONS_CHANGED','WEBSITE_CHANGED','CONFLICT'].includes(e.code)){onAccess(e);return true;}return false;};
 const tools=websiteSourceTools({t,escape,state,accepted,ready:check,locate,select,change,access});
 const status=()=>document.querySelector('[data-source-status]');
 function feedback(message){const n=status();if(n)n.textContent=message;}
 function mark(inert){const frame=document.getElementById('website-files-canvas');if(frame)frame.inert=inert;}
 function stop(){
  clearTimeout(timer);timer=null;checking?.controller.abort();checking=null;pending=null;runId++;
 }
 function reset(){stop();tools.stop();last=null;active=false;}
 function open(language){stop();tools.stop();active=true;if(['html','css'].includes(language))kind=language;last={html:state().html,css:state().css};}
 function accepted(){return active&&last?last:state();}
 function view(standalone){
  if(standalone)kind=standalone;
  const select='<select data-source-language aria-label="'+escape(t('sourceLanguage'))+'">'+['html','css'].map(key=>'<option value="'+key+'" '+(key===kind?'selected':'')+'>'+escape(t(key))+'</option>').join('')+'</select>';
  const attr=standalone?'data-website-file-code':'data-split-code';
  return '<section class="website-source-pane" '+(standalone?'data-source-only':'')+' aria-label="'+escape(t('splitSource'))+'"><header>'+(standalone?'<strong>'+escape(t(kind))+'</strong>':select)+tools.controls()+'</header><div class="website-source-edit"><pre aria-hidden="true" data-source-highlight></pre><textarea data-source-input="'+kind+'" '+attr+'="'+kind+'" aria-label="'+escape(t(kind))+'" spellcheck="false" wrap="off" autocapitalize="off">'+escape(state()[kind])+'</textarea></div>'+tools.note()+'<p role="status" data-source-status>'+escape(t(pending?'sourceChecking':'sourceLive'))+'</p><details><summary>'+escape(t('sourceFidelity'))+'</summary>'+escape(t('sourceFidelityHelp'))+'</details></section>';
 }
 function sync(){
  if(!active||pending)return;
  const value=state();last={html:value.html,css:value.css};const input=field();
  if(input){const next=fieldSourceText(value[kind]);if(input.value!==next){input.value=next;tools.paint();}}
 }
 function language(value){if(!['html','css'].includes(value))return;kind=value;const input=field();if(input){input.dataset.splitCode=kind;input.dataset.sourceInput=kind;input.setAttribute('aria-label',t(kind));input.value=state()[kind];tools.bind();input.focus();}}
 function queue(){
  stop();const value=state();pending={html:value.html,css:value.css,site:value.site,path:value.path};
  tools.issue(null);mark(true);feedback(t('sourceChecking'));timer=setTimeout(()=>void check(),450);
 }
 async function check(){
  clearTimeout(timer);timer=null;
  if(!pending)return true;if(checking)return checking.work;
  const edit=pending,seq=runId,controller=new AbortController();
  const work=(async()=>{
   try{
    const result=await validate(edit,controller.signal);if(seq!==runId||!active||state().site!==edit.site)return false;
    if(result?.revision!==edit.site.revision)throw Error(t('failed'));
    if(result.diagnostic){tools.issue(result.diagnostic);feedback(t('sourceCorrect'));return false;}
    const onlyCSS=last?.html===edit.html;last=edit;pending=null;tools.issue(null);mark(false);repaint(onlyCSS);tools.cssTargets();feedback(t('sourceLive'));return true;
   }catch(reason){
    if(seq!==runId||controller.signal.aborted)return false;
    if(!access(reason))feedback(t('sourceCorrect')+' '+(reason.message??''));return false;
   }finally{if(seq===runId)checking=null;}
  })();
  checking={work,controller};return work;
 }
 return {get active(){return active;},get kind(){return kind;},get pending(){return !!pending;},reset,open,accepted,view,sync,language,queue,check,bind:tools.bind,fromCanvas:tools.fromCanvas};
}
