import {AppError} from './errors.js';
// Count nested members arithmetically and retain only visible positions. A
// backward page is selected from its end, so large items keep exact boundaries.
export function rankedRangePage({offset,after,limit,order,backward=false}){
 const items=[];let total=0,skipped=0;
 const compare=(a,b)=>(order(a,b)||a.index-b.index)*(backward?-1:1);
 const insert=value=>{let low=0,high=items.length;while(low<high){const middle=(low+high)>>1;if(compare(items[middle],value)<0)low=middle+1;else high=middle;}if(low<limit){items.splice(low,0,value);if(items.length>limit)items.pop();}};
 return {
  window({items:values,total:count,before}){if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(total+count)||!Number.isSafeInteger(before)||before<0||before>count||values.length>limit)throw new AppError('LIMIT');total+=count;skipped+=before;for(const value of values)insert({...value,index:0});},
  add(value,count){
   if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(total+count))throw new AppError('LIMIT');
   total+=count;if(!count)return;let before=0;
   if(offset){const relation=order(value,after);before=relation<0?count:relation===0?Math.min(count,after.index+(backward?0:1)):0;skipped+=before;}
   const start=backward?before-1:before,end=backward?Math.max(-1,start-limit):Math.min(count,start+limit),step=backward?-1:1;
   for(let index=start;backward?index>end:index<end;index+=step){const candidate={...value,index};if(items.length===limit&&compare(candidate,items.at(-1))>=0)break;insert(candidate);}
  },
  finish(){if(skipped!==offset||offset>0&&!items.length)throw new AppError('RECORD_QUERY_CURSOR');return {items,total};}
 };
}
