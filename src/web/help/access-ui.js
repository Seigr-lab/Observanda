import {language,t} from '../i18n/index.js';
import {languageUI} from '../i18n/language-ui.js';
import {refreshMessages} from '../i18n/dom.js';
import {helpUI} from './ui.js';
import {resolveHelpRoute} from './model.js';

// A separate modal lifetime keeps setup steps and access credentials in their
// original controls. Help neither snapshots those forms nor opens a workspace.
export function accessHelpUI({api,esc}){
 const state={page:null,helpTopic:null,helpSection:null};
 const reader=helpUI({state,esc,render});
 const languages=languageUI({api,esc,render,root:()=>dialog,coverageId:'access-language-coverage'});
 let dialog=null,fromRoute=false;

 function render(){
  if(!dialog?.open)return;
  dialog.lang=language();dialog.setAttribute('aria-label',t('help','title'));
  dialog.innerHTML=`<header class="help-access-header"><strong>Observanda</strong><button type="button" class="button" data-action="help-access-close">${esc(t('help','returnToForm'))}</button></header><div class="help-access-body">${languages.view()}${reader.view()}</div>`;
  reader.bind();
 }
 function close(){
  if(!dialog)return;
  state.page=null;reader.bind();
  const previous=dialog;dialog=null;previous.close();previous.remove();
  if(fromRoute&&resolveHelpRoute(location.hash))history.replaceState(history.state,'',location.pathname+location.search);
  fromRoute=false;
  refreshMessages();
  for(const button of document.querySelectorAll('[data-action="access-help"]')){button.textContent=t('help','title');button.lang=language();}
 }
 function open({helpTopic='storage',helpSection='unlock'}={},route=false){
  if(dialog)return;
  state.page='help';state.helpTopic=helpTopic;state.helpSection=helpSection;fromRoute=route;
  dialog=document.createElement('dialog');dialog.className='help-access';
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{
   event.stopPropagation();const button=event.target.closest('[data-action]');if(!button)return;
   event.preventDefault();if(button.dataset.action==='help-access-close')close();else reader.action(button);
  });
  dialog.addEventListener('input',event=>{event.stopPropagation();if(!languages.input(event.target))reader.input(event.target);});
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s')event.preventDefault();});
  document.body.append(dialog);dialog.showModal();reader.action({dataset:{action:'help-open',topic:helpTopic,section:helpSection}});dialog.querySelector('[data-action="help-access-close"]').focus();
 }
 return {
  action(button){if(button.dataset.action!=='access-help')return false;open({helpTopic:button.dataset.section==='setup'?'getting-started':'storage',helpSection:button.dataset.section});return true;},
  fromRoute(){const route=resolveHelpRoute(location.hash);if(route)open(route,true);},
  close
 };
}
