import {AsyncLocalStorage} from 'node:async_hooks';
import {projectDomainLock} from './project-domain-lock.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';

// Only this process-owned scope can acknowledge a held graph gate. A request
// cannot bypass admission by supplying an option or a saved owner address.
const admitted=new AsyncLocalStorage();
export function taskAdmissionDatabase(db){
 if(!researchId(db?.id))throw new AppError('INVALID');
 const connection=db.client?.connectionParameters;
 if(!connection||!connection.host||!connection.database)throw new AppError('DATABASE_CONFIG');
 const host=['localhost','127.0.0.1','::1'].includes(connection.host)?'loopback':connection.host.toLowerCase();
 // Pool capacity conservatively combines loopback profiles, but physical
 // coalescing must distinguish independent IPv4 and IPv6 database listeners.
 const socket=db.client.connection?.stream,address=(socket?.remoteAddress??connection.host).toLowerCase(),port=Number(socket?.remotePort??connection.port);
 return {endpoint:JSON.stringify([host,Number(connection.port)]),physical:JSON.stringify([address,port,connection.database]),catalogueId:db.id};
}
function taskAdmissionIdentity(db,namespaceId){
 if(!researchId(namespaceId))throw new AppError('INVALID');
 const {physical,catalogueId}=taskAdmissionDatabase(db);return JSON.stringify([physical,catalogueId,namespaceId]);
}
export async function acquireTaskAdmission(db,namespaceId){
 const identity=taskAdmissionIdentity(db,namespaceId);
 if(admitted.getStore()?.has(identity))return identity;
 await projectDomainLock(db,'Observanda/task-admission/'+db.id+'/'+namespaceId);
 return identity;
}
export async function withTaskAdmission(db,namespaceId,operation){
 if(typeof operation!=='function')throw new AppError('INVALID');
 const identity=await acquireTaskAdmission(db,namespaceId);
 return admitted.run(new Set([...(admitted.getStore()??[]),identity]),operation);
}
