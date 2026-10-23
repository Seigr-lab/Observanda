// Shared bounded text traversal for retained figure exports. Preview snippets
// are never substituted for the complete retained label.
export const escapeFigureText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const retainedFigureText=value=>value?.format==='figure-text'&&value.version===1;
export const composeFigureText=parts=>({format:'figure-composed-text',parts});
export async function* figureTextChunks(reader,value,selection){
 if(value?.format==='figure-composed-text'){for(const part of value.parts)yield* figureTextChunks(reader,part.value,part.selection);return;}
 if(typeof value==='string'){if(/[\uD800-\uDFFF]/u.test(value))throw new Error('Invalid retained figure text encoding');yield value;return;}
 if(value==null){return;}
 if(!retainedFigureText(value)||typeof reader.textChunks!=='function')throw new Error('Invalid retained figure text');
 let characters=0,pending='';
 for await(const chunk of reader.textChunks(selection)){
  if(typeof chunk!=='string')throw new Error('Invalid retained figure text chunk');
  characters+=chunk.length;let text=pending+chunk;pending='';if(text&&/[\uD800-\uDBFF]/.test(text.at(-1))){pending=text.at(-1);text=text.slice(0,-1);}if(/[\uD800-\uDFFF]/u.test(text))throw new Error('Invalid retained figure text encoding');if(text)yield text;
 }
 if(pending)throw new Error('Invalid retained figure text encoding');
 if(characters!==value.characters)throw new Error('Incomplete retained figure text');
}
// Each emitted line is bounded by the requested layout width. Counting Unicode
// scalars avoids splitting surrogate pairs even across metadata text pages.
export async function* figureTextLines(reader,value,selection,width,size){
 if(!Number.isFinite(width)||!Number.isFinite(size)||size<=0)throw new Error('Invalid figure text layout');
 width=Math.max(size*2,width);let line='',used=0,pending='',breakAt=0,breakWidth=0;
 const advance=glyph=>/\p{Extended_Pictographic}/u.test(glyph)?2:/[^\u0000-\u024f]/u.test(glyph)?1.25:/[MW@%&#]/.test(glyph)?1.1:/[A-Z]/.test(glyph)?.85:.64;
 for await(const chunk of figureTextChunks(reader,value,selection)){
  const text=pending+chunk;pending='';let end=text.length;
  if(end&&/[\uD800-\uDBFF]/.test(text[end-1])){pending=text[end-1];end--;}
  for(const glyph of text.slice(0,end)){
   if(glyph==='\r')continue;
   if(glyph==='\n'){yield line;line='';used=0;breakAt=0;breakWidth=0;continue;}
   const next=advance(glyph)*size;
   if(line&&used+next>width){
    if(breakAt){yield line.slice(0,breakAt);line=line.slice(breakAt);used-=breakWidth;}
    else{yield line;line='';used=0;}
    breakAt=0;breakWidth=0;
    if(line&&used+next>width){yield line;line='';used=0;}
   }
   line+=glyph;used+=next;if(glyph===' '||glyph==='\t'){breakAt=line.length;breakWidth=used;}
  }
 }
 if(pending)throw new Error('Invalid retained figure text encoding');
 if(line)yield line;
}
export async function figureTextHeight(reader,value,selection,width,size){
 let lines=0;for await(const line of figureTextLines(reader,value,selection,width,size))lines++;
 return Math.max(1,lines)*size*1.3;
}
export async function* figureSVGText(reader,value,selection,x,y,{width=220,size=12,anchor='start',fill,cls='',weight='normal',rotation=0}={}){
 yield '<text class="'+escapeFigureText(cls)+'" x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" font-size="'+size+'" font-weight="'+weight+'"'+(fill?' fill="'+escapeFigureText(fill)+'"':'')+(rotation?' transform="rotate('+rotation+' '+x+' '+y+')"':'')+'><title>';
 for await(const chunk of figureTextChunks(reader,value,selection))yield escapeFigureText(chunk);
 yield '</title>';let first=true;
 for await(const line of figureTextLines(reader,value,selection,width,size)){yield '<tspan x="'+x+'" dy="'+(first?0:size*1.3)+'">'+escapeFigureText(line)+'</tspan>';first=false;}
 yield '</text>';
}
