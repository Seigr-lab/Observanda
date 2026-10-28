import {publicationPageChoices,publicationReferenceChoices} from './publication-review-choices.js';
import {t} from './i18n/index.js';
import {analysisEditionReviewView} from './analysis-review-ui.js';
export const publicationText=(key,values)=>t('publication',key,values);

export const destinationConflictCount=plan=>plan?.counts?.conflicts??plan?.conflicts?.length??0;
export function destinationPlanRows(plan,key,{esc}){
 const window=plan.windows?.[key],total=plan.counts?.[key]??plan[key].length;
 return `<ul>${plan[key].map(name=>`<li>${esc(name)}</li>`).join('')}</ul>${window&&total>32?`<div class="actions"><button class="button" data-action="publish-plan-page" data-kind="${key}" data-offset="${Math.max(0,window.offset-32)}" ${window.offset===0?'disabled':''}>${esc(publicationText('previousRepositoryFiles'))}</button><span>${esc(publicationText('repositoryFilesPosition',{start:window.offset+1,end:window.offset+plan[key].length,total}))}</span><button class="button" data-action="publish-plan-page" data-kind="${key}" data-offset="${window.next??0}" ${window.next===null?'disabled':''}>${esc(publicationText('nextRepositoryFiles'))}</button></div>`:''}`;
}

// Review operates on a retained edition, never on the editable workspace.
export function publicationReviewView(p,{esc,field,option,icon}){
 const text=(key,values)=>esc(publicationText(key,values)),c=p.summary,plan=p.destinationPlan;
 const destination=p.destination?(p.destination.kind==='github'?`${p.destination.github.owner}/${p.destination.github.repository} / ${p.destination.github.branch}${p.destination.github.directory?' / '+p.destination.github.directory:''}`:`${p.destination.ssh.host} / ${p.destination.ssh.directory}/current`):null;
 const repositoryReview=plan?`<section id="destination-review" class="panel"><h2>${text('repositoryReview')}</h2><p>${text(plan.replacement?'replacementChanges':'repositoryChanges',{destination})}</p>
  ${plan.replacement?`<p>${text('replacementPreservation')}</p><p>${plan.replacement.archiveBranch?text('replacementArchive',{branch:plan.replacement.archiveBranch,commit:plan.head}):text('replacementHistory')}</p>`:''}
  ${['added','replaced','removed','unchanged','preserved','conflicts'].map(key=>`<details><summary>${text(key==='preserved'&&plan.replacement?'replacementPreserved':key,{count:plan.counts?.[key]??plan[key].length})}</summary><div data-plan-rows="${key}">${destinationPlanRows(plan,key,{esc})}</div></details>`).join('')}
  ${p.destination.github.pages!==false?`<p>${text('pagesSource',{branch:p.destination.github.branch})}</p>`:''}
  ${destinationConflictCount(plan)?`<p role="alert">${text(plan.replacement?'replacementConflict':'conflictGuidance')}</p><button class="button" data-action="integrations">${text('configure')}</button>`:plan.requiresReview?`<label class="checkbox"><input type="checkbox" id="destination-confirm"><span>${text(plan.replacement?'replacementConfirm':'destinationConfirm')}</span></label>`:''}<button class="button subtle" data-action="publish-refresh-plan">${text('refreshRepository')}</button>
  <details><summary>${text('replacementOptions')}</summary><p>${text('replacementGuidance')}</p><label for="replacement-archive-branch">${text('replacementArchiveLabel')}</label><input id="replacement-archive-branch" maxlength="100" value="${esc(plan.replacement?.archiveBranch??'')}" placeholder="before-observanda"><p>${text('replacementArchiveGuidance')}</p><div class="actions"><button class="button" data-action="publish-replacement-plan">${text('replacementReview')}</button>${plan.replacement?`<button class="button" data-action="publish-owned-plan">${text('ownedReview')}</button>`:''}</div></details></section>`:'';
 const operation=p.destinationOperation,planning=operation&&operation.state!=='completed';
 const planStatus=planning?`<section class="panel"><h2>${text('repositoryReview')}</h2><p id="destination-operation-status" role="status">${esc(operation.message??operation.progress.stage)}</p><p>${text('repositoryReviewBackground')}</p><button class="button" ${operation.id?'':'disabled'} data-action="${['queued','running'].includes(operation.state)?'publish-plan-cancel':'publish-plan-retry'}">${text(['queued','running'].includes(operation.state)?'repositoryReviewStop':'repositoryReviewResume')}</button></section>`:'';
 const back=p.returnTo==='website'?'website':'publishing';
 return `<button class="button subtle back-button" data-action="${back}">${icon('arrow')}${text(back==='website'?'backEditor':'backPublishing')}</button><div class="page-heading"><h1>${text('reviewTitle')}</h1></div>
  <section class="review-summary"><div class="review-counts">${['projects','notebooks','records','pages','media'].map(key=>`<span>${text(key,{count:c[key]})}</span>`).join('')}</div>
  <p>${text('reviewGuidance')}</p>${p.stale?`<p role="status">${text('stale')}</p><button class="button" data-action="publish-rollback-review">${text('rollbackReview')}</button>`:''}${p.rollback?`<section class="panel"><h2>${text('rollbackTitle')}</h2><p>${text('rollbackGuidance')}</p><label class="checkbox"><input id="rollback-confirm" type="checkbox"><span>${text('rollbackConfirm')}</span></label></section>`:''}
  ${p.researchReview?.changedInputs?`<p class="material-review" role="status">${text('changedInputs',{count:p.researchReview.changedInputs})}</p>`:''}
  ${p.researchReview?.editedFigures?`<p class="material-review" role="status">${text('editedFigures',{count:p.researchReview.editedFigures})}</p>`:''}
  ${p.researchReview?.references?.count?`<section class="material-review"><p>${text('unresolvedReferences',{count:p.researchReview.references.count})}</p><div id="publication-reference-choices">${publicationReferenceChoices(p,{esc})}</div></section>`:''}
  ${analysisEditionReviewView(p,{esc,field})}
  <div class="field"><label for="preview-page">${text('previewPage')}</label><div id="publication-page-choices">${publicationPageChoices(p,{esc,option})}</div></div>
  ${planStatus}${repositoryReview}<label class="checkbox"><input type="checkbox" id="review-confirm"><span>${text('confirm')}</span></label><div class="review-actions">
  <button class="button primary" data-action="export" ${p.stale?'disabled':''}>${icon('export')}${text('download')}</button>
  ${!p.rollback?`<button class="button" data-action="local-export-open" ${p.stale?'disabled':''}>${text('localExport')}</button>`:''}
  ${p.destination?.kind==='github'&&!plan&&!planning?`<button class="button" data-action="publish-refresh-plan">${text('repositoryReview')}</button>`:''}
  ${p.destination?`<button class="button primary" data-action="publish-release" ${p.stale||planning||destinationConflictCount(plan)?'disabled':''}>${text(p.destination.kind==='github'?(p.destination.github.pages===false?'publishGithub':'publishPages'):'publishSsh')}</button>`:`<button class="button" data-action="integrations">${text('configure')}</button>`}
  <a id="full-public-preview" class="button" href="${esc(p.url)}" target="_blank" rel="noopener">${text('openPreview')}</a></div></section>
  <iframe class="preview-frame" title="${text('previewFrame')}" src="${esc(p.url)}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"></iframe><p class="source-note">${destination?text('destination',{destination}):text('noDestination')}</p>`;
}
