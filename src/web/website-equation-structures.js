// Locate editable ranges in the author's own TeX. KaTeX remains the parser
// and typesetter. Unrecognized notation stays editable in the expression field.
function group(s,start){
 if(s[start]!=='{')return null;
 let depth=1;
 for(let p=start+1;p<s.length;p++){
  if(s[p]==='\\'){p++;continue;}
  if(s[p]==='{')depth++;
  if(s[p]==='}'&&!--depth)return {value:s.slice(start+1,p),end:p+1};
 }
 return null;
}
function argument(s,p){
 if(s[p]==='{')return group(s,p);
 const match=/^(?:\\[a-zA-Z]+|[a-zA-Z0-9])/u.exec(s.slice(p));
 return match?{value:match[0],end:p+match[0].length}:null;
}
function matrix(s,start){
 const prefix='\\begin{bmatrix}',suffix='\\end{bmatrix}',initial=start+prefix.length;
 const cells=[];let nested=0,width=0,columns=0,from=initial;
 for(let i=initial;i<s.length;i++){
  if(s.startsWith(suffix,i)&&!nested){
   cells.push(s.slice(from,i).trim());columns++;if(width&&columns!==width)return null;
   return {kind:'matrix',from:start,to:i+suffix.length,values:cells,columns};
  }
  if(s.startsWith('\\begin{',i)){nested++;continue;}
  if(s.startsWith('\\end{',i)){nested--;continue;}
  if(s[i]==='{')nested++;else if(s[i]==='}')nested--;
  if(nested||s[i]!=='&'&&!s.startsWith('\\\\',i))continue;
  cells.push(s.slice(from,i).trim());columns++;
  if(s[i]!=='&'){if(width&&width!==columns)return null;width=columns;columns=0;i++;}
  from=i+1;
 }
 return null;
}
export function equationStructures(s){
 const result=[];
 for(let p=0;p<s.length;p++){
  let item;
  if(s.startsWith('\\begin{bmatrix}',p))item=matrix(s,p);
  else{
   const command=/^\\(frac|sqrt|text)(?=\{)/.exec(s.slice(p));
   if(command){
    const a=group(s,p+command[0].length);
    if(!a)continue;
    if(command[1]==='frac'){
     const b=group(s,a.end);if(b)item={kind:'fraction',values:[a.value,b.value],to:b.end};
    }else if(command[1]==='sqrt')item={kind:'root',values:[a.value],to:a.end};
    else if(!a.value.includes('\\'))item={kind:'text',values:[a.value],to:a.end};
   }else{
    const a=argument(s,p);
    if(a&&['^','_'].includes(s[a.end])){
     const b=argument(s,a.end+1);
     if(b)item={kind:s[a.end]==='^'?'power':'subscript',values:[a.value,b.value],to:b.end};
    }
   }
  }
  if(item)result.push({from:p,...item});
  if(s[p]==='\\'){const word=/^\\[A-Za-z]+/.exec(s.slice(p));if(word)p+=word[0].length-1;}
 }
 return result;
}
