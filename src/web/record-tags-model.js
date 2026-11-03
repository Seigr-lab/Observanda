// A tag remains a short authored label. Record growth is not limited by a tag count.
export const validRecordTag=value=>typeof value==='string'&&value.length<=40&&!!value.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);

// A quoted field preserves commas, surrounding whitespace and literal quotes.
// Unquoted labels accept the usual comma-separated quick-entry syntax.
export function parseRecordTagList(text){
 const tags=[];let field='',quoted=false,complete=false;
 function append(){const value=complete?field:field.trim();if(value.trim())tags.push(value);field='';complete=false;}
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){
   if(ch!=='"')field+=ch;
   else if(text[i+1]==='"'){field+='"';i++;}
   else{quoted=false;complete=true;}
  }else if(ch===',')append();
  else if(ch==='"'&&!complete&&!field.trim()){field='';quoted=true;}
  else if(!complete||ch.trim())field+=ch;
 }
 append();return tags;
}
export const formatRecordTagList=tags=>(tags??[]).map(tag=>/[,"\r\n]/.test(tag)||tag.trim()!==tag?'"'+tag.replaceAll('"','""')+'"':tag).join(', ');
