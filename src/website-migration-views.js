import {parseFragment,serializeOuter} from 'parse5';
import {readingJourney} from './web/book-journeys.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
export const attr=(node,key)=>node.attrs?.find(item=>item.name===key)?.value;
export const put=(node,key,value)=>{node.attrs=node.attrs.filter(item=>item.name!==key);node.attrs.push({name:key,value});};
export const descendants=function*(node){yield node;for(const child of node.childNodes??[])yield* descendants(child);};
export const words=node=>(node?.value??'')+(node?.childNodes??[]).map(words).join('');
const text=(node,key)=>attr(node,'data-observanda-'+key)??'';
const compact=value=>{const flat=value.replace(/\s+/g,' ').trim();return flat.length>240?flat.slice(0,237).replace(/\s+\S*$/,'')+'…':flat;};
function properties(html){
 const nodes=[...descendants(parseFragment(html))],part=key=>nodes.find(node=>attr(node,'data-observanda-part')===key),metadata=part('metadata');
 const dates=[...descendants(metadata??{})].filter(n=>n.tagName==='time').map(n=>attr(n,'datetime')??'');
 return {start:dates[0]??'',end:dates.at(-1)??'',title:words(part('title')),body:compact(words(part('body'))),tags:(part('tags')?.childNodes??[]).filter(n=>n.tagName==='li').map(words),type:words(metadata?.childNodes?.find(node=>node.tagName==='span')),meta:metadata?serializeOuter(metadata).replace(/ data-observanda-part="metadata"/,''):'',sections:nodes.filter(n=>attr(n,'data-observanda-part')?.startsWith('section:')).map(n=>({id:attr(n,'id'),title:words(n.childNodes?.find(c=>c.tagName==='h2'))})),media:new Map(nodes.filter(n=>attr(n,'data-observanda-part')?.startsWith('media:')).map(n=>[attr(n,'data-observanda-part').slice(6),[...descendants(n)].find(item=>item.tagName==='img')]).filter(([,image])=>image))};
}
const markers=node=>node.attrs.filter(attr=>attr.name.startsWith('data-observanda-')).map(({name,value})=>' '+name+'="'+esc(value)+'"').join('');
function renderView(node,fragment,visible){
 const view=text(node,'view'),tag=node.tagName,head='<'+tag+markers(node),finish='</'+tag+'>',meta=properties(fragment),href=text(node,'href'),id=text(node,'record');
 if(!visible)return head+'>'+ (view==='document-title'?esc(text(node,'suffix').replace(/^ \| /,'')):'')+finish;
 if(view==='title'||view==='document-title')return head+(tag==='a'?' href="'+esc(href)+'"':'')+'>'+esc(meta.title+text(node,'suffix'))+finish;
 if(view==='section-label'){const section=meta.sections.find(section=>section.id===text(node,'anchor'));return head+(section&&tag==='a'?' href="'+esc(href)+'"':'')+'>'+esc(section?.title??'')+finish;}
 if(view==='tag-options')return head+'>'+meta.tags.map(tag=>'<option value="'+esc(tag)+'"></option>').join('')+finish;
 if(view==='type-option')return head+' label=""><option value="'+esc(meta.type)+'">'+esc(meta.type)+'</option>'+finish;
 if(view==='contents')return head+' class="page-contents" aria-label="On this page">'+meta.sections.map(part=>'<a href="#'+esc(part.id)+'">'+esc(part.title)+'</a>').join('')+finish;
 if(view==='card'){
  const cover=meta.media.get(text(node,'cover')),feed=text(node,'feed')==='1'?' data-feed-item data-feed-id="'+esc(id)+'" data-feed-search="'+esc(meta.title)+'" data-feed-tags="'+esc(JSON.stringify(meta.tags))+'" data-feed-type="'+esc(meta.type)+'"':'';
  return head+' class="publication-card" data-record-id="'+esc(id)+'"'+feed+'>'+(cover?serializeOuter(cover):'')+meta.meta+'<h2><a href="'+esc(href)+'">'+esc(meta.title)+'</a></h2>'+(meta.body?'<p class="prose">'+esc(meta.body)+'</p>':'')+finish;
 }
 if(view==='browse')return head+' data-public-record="'+esc(id)+'" data-tags="'+esc(JSON.stringify(meta.tags))+'" data-type="'+esc(meta.type)+'" data-start="'+esc(meta.start)+'" data-end="'+esc(meta.end)+'" data-journey="'+esc(readingJourney({type:meta.type,status:''}))+'"><a href="'+esc(href)+'">'+esc(meta.title)+'</a>'+meta.meta+(meta.tags.length?'<p>'+meta.tags.map(esc).join(' · ')+'</p>':'')+finish;
 throw new TypeError('Unrecognized saved website source placement');
}
// These small rendered views depend on an approved fragment, never a catalogue.
// Preserve the authored version while its permitted visible data is unchanged.
export function updateMigrationView(node,{original,previousHtml,html,visible,revision}){
 const before=renderView(node,previousHtml,Boolean(previousHtml)),next=renderView(node,html,visible);
 return (before===next?original:next).replace(/(data-observanda-source-revision\s*=\s*)"[^"]*"/,'$1"'+revision+'"');
}