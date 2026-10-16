// Complete labels share one wrapping policy in plots and annotation keys.
// A long identifier can wrap inside a word, but none of its characters vanish.
const segmenter=new Intl.Segmenter('en',{granularity:'grapheme'});
const glyphs=text=>Array.from(segmenter.segment(String(text)),s=>s.segment);
// Conservative advances across the supported system, serif and mono stacks.
// Wide glyphs and joined emoji must not be measured as ordinary Latin letters.
const advance=glyph=>/\p{Extended_Pictographic}/u.test(glyph)?2:/[^\u0000-\u024f]/u.test(glyph)?1.25:/[MW@%&#]/.test(glyph)?1.1:/[A-Z]/.test(glyph)?.85:.64;
export const measureFigureText=(text,size)=>glyphs(text).reduce((sum,glyph)=>sum+advance(glyph)*size,0);
export function wrapFigureText(text,width,size){
 const lines=[];let line='';width=Math.max(size*2,width);
 for(const word of String(text).split(/\s+/)){
  if(line&&measureFigureText(line+' '+word,size)<=width){line+=' '+word;continue;}
  if(line){lines.push(line);line='';}
  let used=0;
  for(const glyph of glyphs(word)){
   const next=advance(glyph)*size;
   if(line&&used+next>width){lines.push(line);line='';used=0;}
   line+=glyph;used+=next;
  }
 }
 if(line)lines.push(line);return lines;
}

export function figureLegendLayout(series,{width,size,position}){
 const longest=series.reduce((max,s)=>Math.max(max,measureFigureText(s.name,size)+26),100);
 const columns=position==='right'?1:Math.max(1,Math.floor(width/Math.min(width,longest))),cellWidth=width/columns;
 let height=0;const items=[];
 for(let start=0;start<series.length;start+=columns){
  let rowHeight=0;
  for(let col=0;col<columns&&start+col<series.length;col++){
   const lines=wrapFigureText(series[start+col].name,cellWidth-26,size);
   items.push({index:start+col,x:col*cellWidth,y:height,lines});rowHeight=Math.max(rowHeight,Math.max(1,lines.length)*size*1.25+12);
  }
  height+=rowHeight;
 }
 return {height,items};
}
