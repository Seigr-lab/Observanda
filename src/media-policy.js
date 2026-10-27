import path from 'node:path';
import {Workspace,assertRegular,digest,serialize} from './storage.js';
import {AppError} from './errors.js';
export const defaultMediaPolicy=()=>({maxUploadBytes:1024*1024*1024,maxPreparedBytes:2*1024*1024*1024,maxDurationSeconds:6*60*60,maxImagePixels:64*1000*1000,maxAudioChannels:64,maxSampleRate:384000,processingTimeoutSeconds:30*60,reserveBytes:1024*1024*1024});
export function validateMediaPolicy(value){const keys=Object.keys(defaultMediaPolicy());if(!value||Object.keys(value).length!==keys.length||!keys.every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))throw new AppError('INVALID');return value;}
// Zero in an older policy or an empty settings field selects the finite
// default. Larger work requires an explicit positive limit, never infinity.
export function effectiveMediaPolicy(value){validateMediaPolicy(value);return Object.fromEntries(Object.entries(defaultMediaPolicy()).map(([key,fallback])=>[key,value[key]||fallback]));}
export class MediaPolicy {
 constructor(root,vault){this.workspace=root instanceof Workspace?root:new Workspace(root,vault);this.file=path.join(this.workspace.root,'.observanda','media-policy.json');}
 async read(){const stat=await assertRegular(this.file,{missing:true});if(!stat)return {policy:defaultMediaPolicy(),etag:'new'};if(stat.size>4096)throw new AppError('INVALID');const raw=await this.workspace.readFile(this.file,'utf8');return {policy:effectiveMediaPolicy(JSON.parse(raw)),etag:digest(raw)};}
 async save(policy,etag){validateMediaPolicy(policy);return this.workspace.withLock(async()=>{if((await this.read()).etag!==etag)throw new AppError('CONFLICT');await this.workspace.writeFile(this.file,serialize(policy));return this.read();});}
}
