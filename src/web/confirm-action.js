// Confirmation before an irreversible or destructive action, in the app's own dialog and language.
// The question is the dialog's accessible name, the buttons name the action, and Cancel has initial focus.
import {t} from './i18n/index.js';

const ACTIONS=new Set(['remove','delete','discard','replace','save','restore','detach','release']);

export function confirmAction(question,{action}){
 if(!ACTIONS.has(action))throw new TypeError('Unknown confirmation action');
 if(typeof question!=='string'||!question.trim())throw new TypeError('A confirmation needs a question');
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog'),heading=document.createElement('h2'),actions=document.createElement('div');
  const id='confirm-action-'+crypto.randomUUID();
  dialog.className='confirm-action';dialog.setAttribute('aria-labelledby',id);
  heading.id=id;heading.textContent=question;actions.className='dialog-actions';
  // Plain buttons close the dialog themselves: the application handles every form submission.
  const button=(label,value,className)=>{const element=document.createElement('button');element.type='button';element.className=className;element.textContent=label;element.addEventListener('click',()=>dialog.close(value));return element;};
  const cancel=button(t('confirmations','cancel'),'cancel','button'),accept=button(t('confirmations',action),'accept','button danger');
  actions.append(cancel,accept);dialog.append(heading,actions);
  dialog.addEventListener('close',()=>{
   const accepted=dialog.returnValue==='accept';dialog.remove();
   if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();
   resolve(accepted);
  },{once:true});
  document.body.append(dialog);dialog.showModal();cancel.focus();
 });
}
