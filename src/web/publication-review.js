import {t} from './i18n/index.js';
export const publicationText=(key,values)=>t('publication',key,values);

export const destinationConflictCount=plan=>plan?.counts?.conflicts??plan?.conflicts?.length??0;
export function destinationPlanRows(plan,key,{esc,action='publish-plan-page'}){
 const window=plan.windows?.[key],total=plan.counts?.[key]??plan[key].length;
 return `<ul>${plan[key].map(name=>`<li>${esc(name)}</li>`).join('')}</ul>${window&&total>32?`<div class="actions"><button class="button" data-action="${esc(action)}" data-kind="${key}" data-offset="${Math.max(0,window.offset-32)}" ${window.offset===0?'disabled':''}>${esc(publicationText('previousRepositoryFiles'))}</button><span>${esc(publicationText('repositoryFilesPosition',{start:window.offset+1,end:window.offset+plan[key].length,total}))}</span><button class="button" data-action="${esc(action)}" data-kind="${key}" data-offset="${window.next??0}" ${window.next===null?'disabled':''}>${esc(publicationText('nextRepositoryFiles'))}</button></div>`:''}`;
}

