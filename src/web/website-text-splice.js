// Replay only a uniquely located edit. An overlapping change to the same
// location is left to the site-wide editor that owns that material.
export function applyChange(base,edited,current,{verifyLexical=false}={}){
 if(base===edited)return current;
 if(base===current)return edited;
 let start=0,end=0;
 while(start<base.length&&start<edited.length&&base[start]===edited[start])start++;
 while(end<base.length-start&&end<edited.length-start&&base[base.length-end-1]===edited[edited.length-end-1])end++;
 const removed=base.slice(start,base.length-end),inserted=edited.slice(start,edited.length-end);
 const widths=[80,32,12,6,3],contexts=widths.map(w=>[w,w]);
 // Visual round-tripping verifies the complete resulting DOM. This also
 // admits a text edit ending immediately before a differently spelled tag.
 if(verifyLexical)for(const width of widths)contexts.push([width,0],[0,width]);
 for(const [before,after] of contexts){
  const left=base.slice(Math.max(0,start-before),start),right=base.slice(base.length-end,base.length-end+after);
  const needle=left+removed+right,original=start-left.length;
  if(!needle||base.indexOf(needle)!==original||base.indexOf(needle,original+1)>=0)continue;
  const at=current.indexOf(needle);if(at<0||current.indexOf(needle,at+1)>=0)continue;
  const position=at+left.length;
  return current.slice(0,position)+inserted+current.slice(position+removed.length);
 }
 return null;
}
