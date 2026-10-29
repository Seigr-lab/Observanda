import {publishingJobText,publishingMessage} from './publishing-presentation.js';
import {publicationErrorView} from './publication-error-view.js';
import {publicationText} from './publication-review.js';

export function verificationStatus(job){
 if(!job)return null;
 if(['queued','running'].includes(job.state))return job.progress.total?publicationText('liveProgress',{done:job.progress.done,total:job.progress.total}):publicationText('liveChecking');
 if(job.state==='cancelled')return publicationText('liveStopped');
 return ['failed','relocated'].includes(job.state)?publishingJobText(job):job.state==='completed'?publishingMessage(job.result?.message):null;
}
export function verificationActions(job,esc,verification){
 if(!job)return '';
 const active=['queued','running'].includes(job.state),stopped=['failed','cancelled'].includes(job.state);
 if(!active&&!stopped)return '';
 return `<button class="button" data-action="publish-live-${active?'cancel':'retry'}" data-id="${esc(job.id)}"${job.cancelRequested&&active?' disabled':''}>${esc(publicationText(active?'liveCheckStop':'liveCheckResume'))}</button>`+(job.state==='failed'&&verification?.failed?publicationErrorView({code:'PUBLISH_NOT_LIVE',message:job.message,details:[verification.issue]},esc):'');
}
