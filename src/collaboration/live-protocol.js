import {X509Certificate} from 'node:crypto';
import {exact,uuid} from '../modules/validation.js';
import {AppError} from '../errors.js';
import {verifyOrganizationCommand} from './identity.js';

export const LIVE_LIMIT=2*1024*1024;
export const liveValid=(condition,code='COLLABORATION_INVALID')=>{if(!condition)throw new AppError(code);};
export const liveEndpoint=value=>{
 try{const url=new URL(value);liveValid(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&url.hostname.length<=253);return url.origin;}catch{throw new AppError('COLLABORATION_INVALID');}
};
export function liveCard(signed,{allowExpired=false}={}){
 const value=verifyOrganizationCommand(signed);
 liveValid(exact(value,['kind','workspaceId','organizationId','grantId','endpoint','certificate','title'])&&value.kind==='observanda.live.v1'&&[value.workspaceId,value.organizationId,value.grantId].every(uuid)&&typeof value.title==='string'&&value.title.length<=300&&typeof value.certificate==='string'&&value.certificate.length<=16384);
 liveEndpoint(value.endpoint);
 try{const certificate=new X509Certificate(value.certificate);liveValid(certificate.checkHost('observanda.local')&&(allowExpired||Date.parse(certificate.validTo)>Date.now())&&Date.parse(certificate.validFrom)<=Date.now());}catch{throw new AppError('COLLABORATION_INVALID');}
 return value;
}
export async function liveJSON(source,limit=LIVE_LIMIT){
 const chunks=[];let size=0;
 for await(const chunk of source){size+=chunk.length;liveValid(size<=limit,'LIMIT');chunks.push(chunk);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));liveValid(value&&typeof value==='object'&&!Array.isArray(value));return value;}catch(error){if(error instanceof AppError)throw error;throw new AppError('COLLABORATION_INVALID');}
}
