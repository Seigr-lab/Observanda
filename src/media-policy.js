import path from 'node:path';
import {Workspace,assertRegular,digest,serialize} from './storage.js';
import {AppError} from './errors.js';
export const defaultMediaPolicy=()=>({maxUploadBytes:0,maxPreparedBytes:0,maxDurationSeconds:0,maxImagePixels:0,maxAudioChannels:0,maxSampleRate:0,processingTimeoutSeconds:0,reserveBytes:0});
export function validateMediaPolicy(value){const keys=Object.keys(defaultMediaPolicy());if(!value||Object.keys(value).length!==keys.length||!keys.every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))throw new AppError('INVALID');return value;}
export class MediaPolicy {
 constructor(root,vault){this.workspace=root instanceof Workspace?root:new Workspace(root,vault);this.file=path.join(this.workspace.root,'.observanda','media-policy.json');}
 async read(){const stat=await assertRegular(this.file,{missing:true});if(!stat)return {policy:defaultMediaPolicy(),etag:'new'};if(stat.size>4096)throw new AppError('INVALID');const raw=await this.workspace.readFile(this.file,'utf8');return {policy:validateMediaPolicy(JSON.parse(raw)),etag:digest(raw)};}
 async save(policy,etag){validateMediaPolicy(policy);return this.workspace.withLock(async()=>{if((await this.read()).etag!==etag)throw new AppError('CONFLICT');await this.workspace.writeFile(this.file,serialize(policy));return this.read();});}
}
