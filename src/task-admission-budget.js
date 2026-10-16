import {AppError} from './errors.js';

// The ordinary endpoint pool has twelve primary slots. Graph gates reserve at
// most four of them across all admitted task graphs in this process, leaving
// headroom for source reads, the result writer and other feature operations.
export const TASK_DEPENDENCY_DATABASE_LIMIT=4;
const active=new Map();
export function reserveTaskAdmissionBudget(databases){
 const requirements=new Map(),physical=new Set();
 for(const database of databases){
  if(typeof database?.physical!=='string'||typeof database.endpoint!=='string')throw new AppError('INVALID');
  if(physical.has(database.physical))continue;physical.add(database.physical);
  requirements.set(database.endpoint,(requirements.get(database.endpoint)??0)+1);
 }
 for(const [endpoint,count] of requirements){
  if(count>TASK_DEPENDENCY_DATABASE_LIMIT)throw new AppError('TASK_DEPENDENCY_DATABASE_LIMIT');
  if((active.get(endpoint)??0)+count>TASK_DEPENDENCY_DATABASE_LIMIT)throw new AppError('DATABASE_BUSY');
 }
 // No await occurs between checking and reserving the entire endpoint set.
 for(const [endpoint,count] of requirements)active.set(endpoint,(active.get(endpoint)??0)+count);
 let released=false;return ()=>{
  if(released)return;released=true;
  for(const [endpoint,count] of requirements){const remaining=active.get(endpoint)-count;if(remaining)active.set(endpoint,remaining);else active.delete(endpoint);}
 };
}
