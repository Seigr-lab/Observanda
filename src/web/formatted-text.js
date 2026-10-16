// An intentionally bounded text format. Raw HTML is always text, never executable markup.
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(source) {
  const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g;
  let result='',last=0;
  for(const match of source.matchAll(pattern)) {
    result+=escape(source.slice(last,match.index));const token=match[0];
    if(token.startsWith('`'))result+='<code>'+escape(token.slice(1,-1))+'</code>';
    else if(token.startsWith('**'))result+='<strong>'+escape(token.slice(2,-2))+'</strong>';
    else if(token.startsWith('*'))result+='<em>'+escape(token.slice(1,-1))+'</em>';
    else {const parts=/^\[([^\]]+)\]\((.+)\)$/.exec(token);let valid=false;try{const u=new URL(parts[2]);valid=u.protocol==='https:'&&!u.username&&!u.password;}catch{}result+=valid?'<a href="'+escape(parts[2])+'">'+escape(parts[1])+'</a>':escape(token);}
    last=match.index+token.length;
  }
  return result+escape(source.slice(last));
}
export function formattedText(source,format='plain') {
  if(format!=='markdown')return escape(source);
  const lines=String(source).replace(/\r\n/g,'\n').split('\n');let html='',paragraph=[],list=null,code=null;
  const flush=()=>{if(paragraph.length){html+='<p>'+paragraph.map(inline).join('<br>')+'</p>';paragraph=[];}if(list){html+='</'+list+'>';list=null;}};
  for(const line of lines) {
    if(line.startsWith('```')){flush();if(code!==null){html+='<pre><code>'+escape(code.join('\n'))+'</code></pre>';code=null;}else code=[];continue;}
    if(code!==null){code.push(line);continue;}
    if(!line.trim()){flush();continue;}
    const heading=/^(#{1,3}) (.+)$/.exec(line),item=/^([-*]|\d+\.) (.+)$/.exec(line),quote=/^> (.*)$/.exec(line);
    if(heading){flush();const level=Math.min(4,heading[1].length+1);html+='<h'+level+'>'+inline(heading[2])+'</h'+level+'>';}
    else if(item){const kind=/\d/.test(item[1])?'ol':'ul';if(list!==kind){flush();html+='<'+kind+'>';list=kind;}html+='<li>'+inline(item[2])+'</li>';}
    else if(quote){flush();html+='<blockquote>'+inline(quote[1])+'</blockquote>';}
    else {if(list)flush();paragraph.push(line);}
  }
  flush();if(code!==null)html+='<pre><code>'+escape(code.join('\n'))+'</code></pre>';return html;
}
