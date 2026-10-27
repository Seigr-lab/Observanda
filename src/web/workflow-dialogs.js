import {deferredDialog} from './deferred-dialog.js';
import {researchContext} from './project-context.js';
import {websiteContext} from './website-context.js';
import {t} from './i18n/index.js';

const context=state=>JSON.stringify([researchContext(state),websiteContext(state),state.storage?.contextId,state.book?.id,state.page,state.selected,state.access?.locked,location.hash]);
const deferred=(options,load)=>deferredDialog({load,context:()=>context(options.state),changed:()=>Error(t('reviews','workspaceChanged'))});

export function reviewsUI(options) {
 const ui=deferred(options,()=>import('./reviews-ui.js').then(m=>()=>m.reviewsUI(options)));
 return {
  button:()=>'<button type="button" class="button" data-action="review-witnesses">'+options.esc(t('reviews','witnesses'))+'</button>',
  action:node=>node.dataset.action?.startsWith('review-')?ui.invoke('action',node):Promise.resolve(false),
  input:node=>ui.current()?.input(node)??false,
  submit:form=>ui.invoke('submit',form),
  moduleUI:()=>ui.invoke('moduleUI'),
  release:()=>ui.current()?.release(),
  isBusy:()=>ui.loading()||Boolean(ui.current()?.isBusy())
 };
}

export function publicationJobsUI(options) {
 const ui=deferred(options,()=>import('./publication-jobs-ui.js').then(m=>()=>m.publicationJobsUI(options)));
 return {
  start:(...args)=>ui.invoke('start',...args),
  read:(...args)=>ui.invoke('read',...args),
  action:node=>node.dataset.action?.startsWith('publication-jobs-')?ui.invoke('action',node):Promise.resolve(false)
 };
}

export function publicationSelectionUI(options) {
 const ui=deferred(options,()=>import('./publication-selection-ui.js').then(m=>()=>m.publicationSelectionUI(options)));
 return {
  open:(...args)=>ui.invoke('open',...args),
  input:node=>ui.current()?.input(node)??false,
  action:node=>node.dataset.action?.startsWith('edition-')?ui.invoke('action',node):Promise.resolve(false)
 };
}
