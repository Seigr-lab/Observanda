import {parseResearchReference} from './research-reference.js';
import {safeWebsiteLink} from './website-links.js';
import {researchId} from './research-reference.js';
import {BOOK_BLOCKS,validBookBlock,bookBlockText,renderBookBlock} from './book-blocks.js';
import {validFont,fontStack} from './font-catalogue.js';
// Portable structured text. No raw HTML, scripts or arbitrary attributes are stored.
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const own=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));
export function safeRichLink(href){
 if(typeof href!=='string'||!href||href.length>2000||/[\s\\\u0000-\u001f]/.test(href))return false;
 if(parseResearchReference(href))return true;
 if(safeWebsiteLink(href))return true;
 try{const u=new URL(href);return ['https:','http:','mailto:','tel:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
}
export function validRichText(doc,{extended=true,maxCharacters=60000}={}){
 let count=0,characters=0;
 const ids=new Set(),inline=n=>['text','hard_break'].includes(n?.type),block=n=>['paragraph','heading','blockquote','bullet_list','ordered_list','code_block','horizontal_rule',...BOOK_BLOCKS].includes(n?.type);
 function mark(m){if(!own(m,['type','attrs']))return false;if(['strong','em','underline','strike','code'].includes(m.type))return !m.attrs||!Object.keys(m.attrs).length;
  if(extended&&['subscript','superscript'].includes(m.type))return !m.attrs||!Object.keys(m.attrs).length;
  if(extended&&m.type==='font_family')return own(m.attrs,['font'])&&validFont(m.attrs.font);
  if(extended&&['text_color','highlight'].includes(m.type))return own(m.attrs,['color'])&&/^#[0-9a-f]{6}$/.test(m.attrs.color);
  if(m.type==='text_size')return own(m.attrs,['size'])&&Number.isInteger(m.attrs.size)&&m.attrs.size>=8&&m.attrs.size<=96;
  return m.type==='link'&&own(m.attrs,['href','title','target','nofollow'])&&safeRichLink(m.attrs.href)&&typeof m.attrs.title==='string'&&m.attrs.title.length<=200&&['_self','_blank'].includes(m.attrs.target)&&typeof m.attrs.nofollow==='boolean';}
 function node(n,depth){
  if(++count>12000||depth>24||!own(n,['type','attrs','content','text','marks']))return false;
  if(n.attrs?.id){if(!researchId(n.attrs.id)||ids.has(n.attrs.id))return false;ids.add(n.attrs.id);}
  if(BOOK_BLOCKS.includes(n.type)){characters+=bookBlockText(n).length;return !n.text&&characters<=maxCharacters&&validBookBlock(n);}
  if(n.marks&&(!inline(n)||!Array.isArray(n.marks)||!n.marks.every(mark)||new Set(n.marks.map(m=>m.type)).size!==n.marks.length))return false;
  if(n.type==='text'){characters+=n.text?.length??0;return typeof n.text==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(n.text)&&n.text.length>0&&characters<=maxCharacters&&!n.content&&!n.attrs;}
  if(n.text!==undefined)return false;
  const content=n.content??[];if(!Array.isArray(content)||!content.every(c=>node(c,depth+1)))return false;
  const attrs=n.attrs??{};
  if(n.type==='doc')return !n.attrs&&content.length>0&&content.every(block);
  if(['paragraph','heading'].includes(n.type))return own(attrs,n.type==='heading'?['level','align','id']:['align'])&&(attrs.id===undefined||attrs.id===null||researchId(attrs.id))&&(attrs.align===undefined||[...(extended?['inherit']:[]),'start','center','end','justify'].includes(attrs.align))&&(n.type!=='heading'||[2,3,4].includes(attrs.level))&&content.every(inline);
  if(n.type==='blockquote')return !Object.keys(attrs).length&&content.length>0&&content.every(block);
  if(['bullet_list','ordered_list'].includes(n.type))return own(attrs,n.type==='ordered_list'?['order']:[])&&(n.type!=='ordered_list'||Number.isInteger(attrs.order)&&attrs.order>0&&attrs.order<10000)&&content.length>0&&content.every(c=>c.type==='list_item');
  if(n.type==='list_item')return !Object.keys(attrs).length&&content[0]?.type==='paragraph'&&content.every(block);
  if(n.type==='code_block')return own(attrs,['language'])&&(attrs.language===undefined||typeof attrs.language==='string'&&attrs.language.length<=120&&!/[\u0000-\u001f]/.test(attrs.language))&&content.every(c=>c.type==='text'&&!c.marks?.length);
  return ['horizontal_rule','hard_break'].includes(n.type)&&!Object.keys(attrs).length&&!content.length;
 }
 try{return doc?.type==='doc'&&node(doc,0);}catch{return false;}
}
export function richTextPlain(doc){if(BOOK_BLOCKS.includes(doc.type))return bookBlockText(doc);return (doc.content??[]).map(n=>n.type==='text'?n.text:n.type==='hard_break'?'\n':richTextPlain(n)).join(doc.type==='paragraph'||doc.type==='heading'?'':'\n');}
export function plainRichText(text=''){return {type:'doc',content:text.split(/\n\n+/).map(p=>({type:'paragraph',content:p?p.split('\n').flatMap((line,i)=>[...(i?[{type:'hard_break'}]:[]),...(line?[{type:'text',text:line}]:[])]):[]}))};}
export function renderRichText(doc,{resolveLink=href=>href,figure,message,block}={}){
 function render(n){if(BOOK_BLOCKS.includes(n.type))return block?.(n)??renderBookBlock(n,{esc,figure,message});let content=n.type==='text'?esc(n.text):(n.content??[]).map(render).join('');
  if(n.type==='text'||n.type==='hard_break'){if(n.type==='hard_break')content='<br>';for(const m of n.marks??[]){if(m.type==='link'){const href=resolveLink(m.attrs.href);if(href)content='<a href="'+esc(href)+'" target="'+m.attrs.target+'"'+(m.attrs.title?' title="'+esc(m.attrs.title)+'"':'')+' rel="'+[...(m.attrs.target==='_blank'?['noopener','noreferrer']:[]),...(m.attrs.nofollow?['nofollow']:[])].join(' ')+'">'+content+'</a>';}else if(['text_color','highlight'].includes(m.type)){content='<span class="rt-'+(m.type==='text_color'?'color':'highlight')+'-'+m.attrs.color.slice(1)+'">'+content+'</span>';}else if(m.type==='font_family'){content='<span class="rt-font-'+m.attrs.font+'">'+content+'</span>';}else if(m.type==='text_size'){content='<span class="rt-size-'+m.attrs.size+'">'+content+'</span>';}else {const tag={strong:'strong',em:'em',underline:'u',strike:'s',code:'code',subscript:'sub',superscript:'sup'}[m.type];content='<'+tag+'>'+content+'</'+tag+'>';}}return content;}
  const tags={paragraph:'p',heading:'h'+n.attrs?.level,blockquote:'blockquote',bullet_list:'ul',ordered_list:'ol',list_item:'li'};
  if(n.type==='doc')return content;if(n.type==='hard_break')return '<br>';if(n.type==='horizontal_rule')return '<hr>';if(n.type==='code_block')return '<pre'+(n.attrs?.language?' data-language="'+esc(n.attrs.language)+'"':'')+'><code>'+content+'</code></pre>';
  const tag=tags[n.type],attrs=(n.attrs?.align?' class="rt-align-'+n.attrs.align+'"':'')+(n.type==='heading'&&n.attrs?.id?' id="record-section-'+n.attrs.id+'" tabindex="-1"':'')+(n.type==='ordered_list'&&n.attrs?.order!==1?' start="'+n.attrs.order+'"':'');return '<'+tag+attrs+'>'+content+'</'+tag+'>';
 }return render(doc);
}

export function richTextStyles(docs){
 const rules=new Map(),fonts=new Set();
 function visit(node){for(const m of node.marks??[]){if(m.type==='font_family'){fonts.add(m.attrs.font);rules.set('font-'+m.attrs.font,'font-family:'+fontStack(m.attrs.font));}if(['text_color','highlight'].includes(m.type))rules.set((m.type==='text_color'?'color':'highlight')+'-'+m.attrs.color.slice(1),(m.type==='text_color'?'color':'background-color')+':'+m.attrs.color);}for(const child of node.content??[])visit(child);}
 for(const doc of docs)if(doc)visit(doc);
 return {fonts:[...fonts],css:[...rules].map(([name,rule])=>'.rt-'+name+'{'+rule+'}').join('\n')};
}
