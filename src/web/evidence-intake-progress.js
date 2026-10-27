import './i18n/catalogues/evidenceIntake.js';
import {t,language} from './i18n/index.js';
const text=(key,parameters)=>t('evidenceIntake',key,parameters);
// Backend stage names identify protocol events; only resource messages reach
// the intake panel. Verification measures bytes, attachment measures files.
export function evidenceIntakeProgress(job){
 if(job.message)return job.message;
 if(job.cancelRequested&&['queued','running'].includes(job.state))return text('jobStopping');
 const state={queued:'jobQueued',cancelled:'jobCancelled',failed:'jobFailed',relocated:'jobRelocated'}[job.state];
 if(state)return text(state);
 const progress=job.progress,number=value=>value.toLocaleString(language()),counts={done:number(progress.done),total:number(progress.total)};
 if(progress.stage==='queued')return text('jobQueued');
 if(progress.stage==='preparing')return text('jobPreparing');
 if(progress.stage==='Verified files')return text('jobVerifiedFiles',counts);
 if(progress.stage==='Attaching verified files')return text('jobAttachingFiles',counts);
 const verifying=/^Verifying file ([1-9][0-9]*) of ([1-9][0-9]*)$/.exec(progress.stage);
 if(verifying&&verifying.slice(1).every(value=>Number.isSafeInteger(Number(value))))return text('jobVerifyingFile',{...counts,number:number(Number(verifying[1])),count:number(Number(verifying[2]))});
 return text('jobProgress',counts);
}
