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
 const page={
  add(value){
   total++;
   if(offset&&order(value,after)<=0){
    skipped++;
    if(offset>limit){insert(preceding,boundary(value),order);if(preceding.length>limit+1)preceding.shift();}
   }else if(records.length<limit||order(value,records.at(-1))<0){insert(records,value,order);if(records.length>limit)records.pop();}
  },
  // A pinned ordered index supplies exact rank/count facts plus only the
  // neighbouring windows. Other owners may still use the ordinary scan path.
  addIndexed({total:count,skipped:before,records:following,preceding:prior=[]}){
   if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(before)||before<0||before>count||
    following.length!==Math.min(limit,count-before)||prior.length!==(offset>limit?Math.min(limit+1,before):0)||
    !offset&&before!==0||following.some(value=>offset&&order(value,after)<=0)||prior.some(value=>order(value,after)>0))throw new AppError('CATALOGUE_DAMAGED');
   for(const value of following)page.add(value);for(const value of prior)page.add(value);
   total+=count-following.length-prior.length;skipped+=before-prior.length;
  },
  finish(){
   if(skipped!==offset||offset>0&&!records.length)throw new AppError('RECORD_QUERY_CURSOR');
   return {records,total,after:records.length?boundary(records.at(-1)):null,previousAfter:offset>limit?preceding[0]:null};
  }
 };return page;
}
