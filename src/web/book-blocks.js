import {researchId} from './research-reference.js';
import {bookText} from './book-messages.js';
import {renderEquation} from './vendor/equations.js';
import {validSketch,sketchTextContent} from './sketch-model.js';
import {renderSketch} from './sketch-renderer.js';
import {figureReadingView} from './figure-reading-view.js';
export const BOOK_BLOCKS=['book_table','book_equation','book_citation','book_figure','book_sketch','book_preserved'];
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const keys=(v,names)=>v&&Object.keys(v).sort().join()===names.sort().join();
export const externalCitationURL=url=>{if(typeof url!=='string')return false;if(!url)return true;try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&url.length<=2000;}catch{return false;}};
export function validBookBlock(n){
 const a=n.attrs;if(!BOOK_BLOCKS.includes(n.type)||n.content?.length||n.marks?.length||!a||a.version!==1||!researchId(a.id))return false;
 if(n.type==='book_table')return keys(a,['version','id','title','headers','rows'])&&text(a.title,300,true)&&Array.isArray(a.headers)&&a.headers.length>0&&a.headers.length<=20&&a.headers.every(h=>text(h,500,true))&&Array.isArray(a.rows)&&a.rows.length>0&&a.rows.length<=500&&a.rows.every(r=>Array.isArray(r)&&r.length===a.headers.length&&r.every(v=>text(v,10000)));
 if(n.type==='book_equation')return keys(a,['version','id','source','label'])&&text(a.source,4000,true)&&text(a.label,1000,true);
 if(n.type==='book_citation')return keys(a,['version','id','title','authors','issued','locator','url'])&&text(a.title,1000,true)&&text(a.authors,2000)&&text(a.issued,200)&&text(a.locator,1000)&&externalCitationURL(a.url);
 if(n.type==='book_figure')return keys(a,['version','id','figureId','alternative'])&&researchId(a.figureId)&&text(a.alternative,20000,true);
 if(n.type==='book_sketch')return validSketch(a);
 return keys(a,['version','id','format','source','reason'])&&text(a.format,200,true)&&text(a.source,60000,true)&&text(a.reason,2000,true);
}
export const bookBlockText=n=>n.type==='book_sketch'?sketchTextContent(n.attrs):Object.entries(n.attrs??{}).filter(([k])=>!['id','figureId','version'].includes(k)).map(([,v])=>Array.isArray(v)?v.flat().join('\n'):v).join('\n');
export function renderBookBlock(n,{esc,figure=()=>'',message=bookText}={}){
 const a=n.attrs,id='record-'+({book_table:'table',book_equation:'equation',book_citation:'citation',book_preserved:'block',book_sketch:'block',book_figure:'placement'}[n.type])+'-'+a.id;
 if(n.type==='book_sketch')return `<figure class="book-sketch" id="${id}" tabindex="-1">${figureReadingView(renderSketch(a),a.title)}<figcaption>${esc(a.title)}</figcaption><p class="book-diagram-reading">${esc(a.description)}</p>${a.items.some(i=>i.kind==='text')?`<details><summary>${esc(message('sketchAnnotations'))}</summary><ul class="book-diagram-reading">${a.items.filter(i=>i.kind==='text').map(i=>'<li>'+esc(i.text)+'</li>').join('')}</ul></details>`:''}</figure>`;
 if(n.type==='book_table')return `<section class="book-table" id="${id}" tabindex="-1"><div class="book-table-scroll" tabindex="0" role="region" aria-label="${esc(a.title)}"><table><caption>${esc(a.title)}</caption><thead><tr>${a.headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')}</tr></thead><tbody>${a.rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')}</tbody></table></div><details class="book-table-linear"><summary>${esc(message('tableReading'))}</summary><ol>${a.rows.map(r=>'<li><dl>'+r.map((v,i)=>'<div><dt>'+esc(a.headers[i])+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl></li>').join('')}</ol></details></section>`;
 if(n.type==='book_equation'){let math;try{math=renderEquation(a.source);}catch{math='<p role="status">'+esc(message('equationUnsupported'))+'</p>';}return `<figure class="book-equation" id="${id}" tabindex="-1"><div role="math" aria-label="${esc(a.label)}">${math}</div><figcaption>${esc(a.label)}</figcaption><details><summary>${esc(message('equationSource'))}</summary><pre><code>${esc(a.source)}</code></pre></details></figure>`;}
 if(n.type==='book_citation')return `<blockquote class="book-citation" id="${id}" tabindex="-1">${a.authors?esc(a.authors)+'. ':''}<cite>${a.url?'<a href="'+esc(a.url)+'" rel="noopener noreferrer">'+esc(a.title)+'</a>':esc(a.title)}</cite>${a.issued?' · '+esc(a.issued):''}${a.locator?' · '+esc(a.locator):''}</blockquote>`;
 if(n.type==='book_figure')return `<div class="book-figure-placement" id="${id}">${figure(a.figureId)||'<p>'+esc(message('figureMissing'))+'</p>'}<ol class="book-diagram-reading">${a.alternative.split('\n').filter(s=>s.trim()).map(s=>'<li>'+esc(s)+'</li>').join('')}</ol></div>`;
 return `<section class="book-preserved" id="${id}" tabindex="-1"><p>${esc(message('preservation'))} ${esc(a.format)}</p><p>${esc(a.reason)}</p><pre><code>${esc(a.source)}</code></pre></section>`;
}
