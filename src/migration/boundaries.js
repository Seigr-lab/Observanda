// Different selector languages do not establish disjoint source regions.
export function overlappingSelections(first,second){
 const a=first.selector,b=second.selector;if(a.kind==='whole'||b.kind==='whole'||a.kind!==b.kind)return true;
 if(a.kind==='bytes')return a.offset<b.offset+b.length&&b.offset<a.offset+a.length;
 if(a.kind==='json-pointer')return a.value===b.value||a.value.startsWith(b.value+'/')||b.value.startsWith(a.value+'/');
 const x=first.verification?.range,y=second.verification?.range;
 return a.value===b.value||!x||!y||x.start<y.end&&y.start<x.end;
}
