import {randomUUID} from 'node:crypto';

// Inserts and removals affect the local page and its neighbour links. Keep
// other page addresses and membership intact when a record changes its sort.
export function initialGroups(members,limit,previous=[]){
 const groups=[];
 for(let start=0;start<members.length||!groups.length;start+=limit){
  const key=groups.length?previous[groups.length]?.key??randomUUID():'host';
  groups.push({key,ids:members.slice(start,start+limit).map(row=>row.id)});
 }
 return groups;
}
export function changeGroups(feed,sourceId,member,compare){
 const members=feed.members.filter(row=>row.id!==sourceId);
 const groups=feed.groups.map(group=>({key:group.key,ids:group.ids.filter(id=>id!==sourceId)}));
 if(member){
  let low=0,high=members.length;
  while(low<high){const mid=Math.floor((low+high)/2);if(compare(members[mid],member)<=0)low=mid+1;else high=mid;}
  members.splice(low,0,member);
  if(feed.members[low]?.id===sourceId)return {members,groups:feed.groups.map(({key,ids})=>({key,ids:[...ids]}))};
  let offset=low,at=0;while(at<groups.length-1&&offset>=groups[at].ids.length){offset-=groups[at].ids.length;at++;}
  const group=groups[at];group.ids.splice(offset,0,sourceId);
  if(group.ids.length>feed.pageSize){
   const split=offset===group.ids.length-1?feed.pageSize:Math.ceil(group.ids.length/2);
   groups.splice(at+1,0,{key:randomUUID(),ids:group.ids.splice(split)});
  }
 }
 for(let i=groups.length-1;i>0;i--)if(!groups[i].ids.length)groups.splice(i,1);
 if(!groups[0].ids.length&&groups.length>1)groups[0].ids=groups.splice(1,1)[0].ids;
 return {members,groups};
}
