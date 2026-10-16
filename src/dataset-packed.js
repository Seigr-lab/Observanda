// Return the logical record/field within the selected physical array. The
// caller retains the original token path as provenance, not this logical path.
export function packedPosition(definition,token){
 const n=definition.pattern.length,p=definition.packed;
 if(token.path.length<=n||!token.arrays.includes(n)||!definition.pattern.every((v,i)=>v==='*'?token.arrays.includes(i):v===token.path[i]))return null;
 const index=Number(token.path[n])-p.offset;
 if(index<0||index>=p.width*p.count)return null;
 return {record:Math.floor(index/p.width),slot:index%p.width,relative:[String(index%p.width),...token.path.slice(n+1)]};
}
