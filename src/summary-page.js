import {AppError} from './errors.js';

const point=value=>({id:value.id,title:value.title,occurredOn:value.occurredOn});
function insert(items,value,order){
 let low=0,high=items.length;
 while(low<high){const middle=(low+high)>>1;if(order(items[middle],value)<0)low=middle+1;else high=middle;}
 items.splice(low,0,value);
}

// One sorted page and the preceding boundary, independent of corpus size.
// Callers own scope, filtering and projection; cursor offsets cannot skip data.
export function summaryPage({offset,after,limit,order,point:boundary=point}){
 const records=[],preceding=[];let total=0,skipped=0;
 return {
  add(value){
   total++;
   if(offset&&order(value,after)<=0){
    skipped++;
    if(offset>limit){insert(preceding,boundary(value),order);if(preceding.length>limit+1)preceding.shift();}
   }else if(records.length<limit||order(value,records.at(-1))<0){insert(records,value,order);if(records.length>limit)records.pop();}
  },
  finish(){
   if(skipped!==offset||offset>0&&!records.length)throw new AppError('RECORD_QUERY_CURSOR');
   return {records,total,after:records.length?boundary(records.at(-1)):null,previousAfter:offset>limit?preceding[0]:null};
  }
 };
}
