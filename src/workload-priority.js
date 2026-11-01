import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
const priority=new AsyncLocalStorage();
export const workloadPriority=()=>priority.getStore()??'foreground';
export const validWorkloadPriority=value=>value==='foreground'||value==='background';
export function withWorkloadPriority(value,operation){if(!validWorkloadPriority(value)||typeof operation!=='function')throw new AppError('INVALID');return priority.run(value,operation);}
// Eligible background work gets a turn after at most four foreground grants.
// An ineligible large request cannot occupy a reserved foreground slot.
export function nextWorkIndex(queue,eligible,foregroundGrants){
 let foreground=-1,background=-1;
 for(let index=0;index<queue.length;index++){const entry=queue[index];if(!eligible(entry))continue;if(entry.priority==='background'){if(background<0)background=index;}else if(foreground<0)foreground=index;}
 return background>=0&&(foreground<0||foregroundGrants>=4)?background:foreground;
}
