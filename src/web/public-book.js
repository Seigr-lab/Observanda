// Progressive enhancement of an already public, independently readable index.
// No workspace endpoint, source record, third-party script or HTML insertion.
export function enhancePublicBook(document,location,history,sessionStorage,window,matchesPublicRecord,enhancePublicIndex){
const form=document.querySelector('[data-book-browse]'),list=document.querySelector('[data-book-records]'),params=new URLSearchParams(location.search),root=new URL(document.querySelector('[data-book-index]')?.getAttribute('href')??'browse.html',location.href),key='observanda-public-browse:'+root.pathname;
if(form?.hasAttribute('data-book-static')){enhancePublicIndex(document,location,history,sessionStorage,window,matchesPublicRecord);return;}
const allowed=['q','tag','journey','type','from','to'];
const safeQuery=value=>{const p=new URLSearchParams(value),out=new URLSearchParams();for(const k of allowed)if(p.get(k))out.set(k,p.get(k).slice(0,512));return out.toString();};
function remember(value){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}
function previousState(){try{const v=JSON.parse(sessionStorage.getItem(key));return v&&Array.isArray(v.ids)&&v.ids.length<100000&&v.ids.every(id=>/^[a-f0-9-]{36}$/.test(id))&&v.titles&&typeof v.titles==='object'?v:null;}catch{return null;}}
if(form&&list&&form.hasAttribute('data-book-paged')){
 const values=()=>Object.fromEntries(allowed.map(k=>[k,form.elements[k]?.value.trim()??'']));
 const apply=event=>{event.preventDefault();if(!form.reportValidity())return;const selected=values(),invalid=selected.from&&selected.to&&selected.from>selected.to;form.querySelector('[data-filter-error]').hidden=!invalid;if(invalid)return;const query=new URLSearchParams();for(const [k,v] of Object.entries(selected))if(v)query.set(k,v);location.href=root.pathname+(query.size?'?'+query:'');};
 const reset=event=>{event.preventDefault();location.href=root.pathname;};
 form.addEventListener('submit',apply);form.addEventListener('reset',reset);
 // Sandboxed previews disallow native form submission. The trusted host can
 // handle their explicit controls without enabling scripts or form actions.
 form.addEventListener('click',event=>{const button=event.target.closest('button');if(button?.type==='submit')apply(event);else if(button?.type==='reset')reset(event);});
 form.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('input'))apply(event);});
 const query=safeQuery(location.search),returnQuery=new URLSearchParams(query);if(params.get('cursor'))returnQuery.set('cursor',params.get('cursor'));
 for(const a of list.querySelectorAll('a')){const url=new URL(a.href);url.searchParams.set('browse',returnQuery.toString());a.href=url.href;}
 remember({query:returnQuery.toString(),ids:[...list.querySelectorAll('[data-public-record]')].map(row=>row.dataset.publicRecord),titles:Object.fromEntries([...list.querySelectorAll('[data-public-record]')].map(row=>[row.dataset.publicRecord,row.querySelector('a').textContent]))});
}else if(form&&list){
 form.hidden=false;for(const k of allowed)if(form.elements[k])form.elements[k].value=params.get(k)??'';
 const all=[...list.querySelectorAll('[data-public-record]')];
 function filter(push){
  const values=Object.fromEntries(allowed.map(k=>[k,form.elements[k]?.value.trim()??''])),invalid=values.from&&values.to&&values.from>values.to;
  form.querySelector('[data-filter-error]').hidden=!invalid;
  const ids=[];for(const row of all){const d=row.dataset,matches=matchesPublicRecord({...d,text:row.textContent,tags:JSON.parse(d.tags)},values);row.hidden=!matches;if(matches)ids.push(d.publicRecord);}
  const p=new URLSearchParams();for(const [k,v] of Object.entries(values))if(v)p.set(k,v);const query=p.toString();
  if(push)history.replaceState(null,'',location.pathname+(query?'?'+query:''));
  for(const a of list.querySelectorAll('a')){const u=new URL(a.href);if(query)u.searchParams.set('browse',query);else u.searchParams.delete('browse');a.href=u.href;}
  document.querySelector('[data-book-count]').textContent=String(ids.length);document.querySelector('[data-book-empty]').hidden=ids.length>0;remember({query,ids,titles:Object.fromEntries(all.map(row=>[row.dataset.publicRecord,row.querySelector('a').textContent]))});
 }
 form.addEventListener('input',()=>filter(true));form.addEventListener('change',()=>filter(true));form.addEventListener('submit',e=>{e.preventDefault();filter(true);});form.addEventListener('reset',()=>setTimeout(()=>filter(true),0));window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);for(const k of allowed)form.elements[k].value=p.get(k)??'';filter(false);});filter(false);
}else{
 const browseParams=new URLSearchParams(params.get('browse')??''),returnParams=new URLSearchParams(safeQuery(params.get('browse')??''));if(browseParams.get('cursor')?.length<=4096)returnParams.set('cursor',browseParams.get('cursor'));
 const start=Number(browseParams.get('start'));if(browseParams.has('start')&&Number.isSafeInteger(start)&&start>=0)returnParams.set('start',String(start));
 const query=returnParams.toString(),saved=previousState(),target=document.body.dataset.page,id=target?.startsWith('entry:')?target.slice(6):location.pathname.split('/').pop().replace(/\.html$/,'');
 for(const a of document.querySelectorAll('[data-book-back]')){a.href=new URL('browse.html'+(query?'?'+query:''),root).href;}
 if(query&&saved?.query===query){const i=saved.ids.indexOf(id);for(const [name,at] of [['previous',i-1],['next',i+1]]){const a=document.querySelector('[data-book-'+name+']');if(a){const target=i>=0?saved.ids[at]:null;a.hidden=!target;if(target){a.href=new URL('entries/'+target+'.html?browse='+encodeURIComponent(query),root).href;a.querySelector('[data-book-name]').textContent=String(saved.titles[target]??'');}}}}
 if(query)for(const a of document.querySelectorAll('a[href]')){const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname.startsWith(new URL('entries/',root).pathname)&&/\.html$/.test(u.pathname)){u.searchParams.set('browse',query);a.href=u.href;}}
}
}
