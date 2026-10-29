import {AppError} from '../errors.js';
export async function moduleBrowsePage(plans,{offset,limit,order,signal}){
 const total=plans.reduce((n,plan)=>n+plan.total,0),skipped=plans.reduce((n,plan)=>n+plan.offset,0);
 if(skipped!==offset||offset>0&&offset>=total)throw new AppError('MODULE_QUERY_CURSOR');
 const point=value=>value?{id:value.id,title:value.title,createdAt:value.createdAt}:null;
 async function window(count,backward=false){
  const lanes=plans.map(plan=>({iterator:plan.rows(backward)[Symbol.asyncIterator](),current:null})),result=[];
  try{
   for(const lane of lanes){signal?.throwIfAborted();lane.current=await lane.iterator.next();}
   while(result.length<count){
    signal?.throwIfAborted();let selected;
    for(const lane of lanes)if(!lane.current.done&&(!selected||order(lane.current.value,selected.current.value)*(backward?-1:1)<0))selected=lane;
    if(!selected)break;result.push(selected.current.value);if(result.length<count)selected.current=await selected.iterator.next();
   }
  }finally{await Promise.all(lanes.map(lane=>lane.iterator.return?.()));}
  return result;
 }
 const records=await window(limit),previous=offset>limit?await window(limit+1,true):[];
 if(records.length!==Math.min(limit,total-offset)||offset>limit&&previous.length!==limit+1)throw new AppError('CATALOGUE_DAMAGED');
 return {records,total,after:point(records.at(-1)),previousAfter:point(previous.at(-1))};
}
