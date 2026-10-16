import {websiteContext} from './website-context.js';
import {publicationText} from './publication-review.js';
import {researchTargetPicker} from './research-target-picker.js';
import {validPublicationLinks} from './publication-links-model.js';

export function publicationLinksUI({state,api,esc,field,showDialog}){
 const text=(k,v)=>esc(publicationText(k,v));let session=null;
 const active=()=>session&&session.context===websiteContext(state)&&session.route===location.hash&&document.querySelector('#dialog[open] #publication-links');
 const picker=researchTargetPicker({state,api,esc,field,showDialog,active,excludeId:()=>null});
 const button=(key,op,extra='')=>`<button type="button" class="button" data-action="publication-links-${op}" ${extra}>${text(key)}</button>`;
 const anchor=()=>({id:crypto.randomUUID(),fragment:'',label:'',target:null});
 function remember(){for(const box of document.querySelectorAll('[data-legacy-page]')){const page=session.config.pages.find(p=>p.id===box.dataset.legacyPage);page.path=box.querySelector('[data-legacy-path]').value.trim();page.title=box.querySelector('[data-legacy-title]').value.trim();for(const row of box.querySelectorAll('[data-legacy-anchor]')){const a=page.anchors.find(a=>a.id===row.dataset.legacyAnchor);a.fragment=row.querySelector('[data-legacy-fragment]').value;a.label=row.querySelector('[data-legacy-label]').value.trim();}}}
 function draw(){
  picker.stop();const view=document.getElementById('publication-links');
  view.innerHTML=`<p>${text('legacyGuidance')}</p>${session.config.pages.map(p=>`<fieldset data-legacy-page="${p.id}"><legend>${esc(p.title||publicationText('legacyPage'))}</legend>${field(text('legacyPath'),`<input data-legacy-path maxlength="500" value="${esc(p.path)}" placeholder="chapters/experiment.html">`)}${field(text('legacyTitle'),`<input data-legacy-title maxlength="300" value="${esc(p.title)}">`)}${p.anchors.map(a=>`<section class="panel" data-legacy-anchor="${a.id}">${field(text('legacyFragment'),`<input data-legacy-fragment maxlength="300" value="${esc(a.fragment)}">`)}${field(text('legacyLabel'),`<input data-legacy-label maxlength="300" value="${esc(a.label)}">`)}<p>${a.target?text(a.target.revision?'legacyExactTarget':'legacyCurrentTarget',{label:session.labels.get(a.id)??a.label,revision:a.target.revision?.slice(0,12)??''}):text('legacyUnmapped')}</p><div class="inline-actions">${button('legacyChoose','choose',`data-page="${p.id}" data-anchor="${a.id}"`)}${button('legacyRemoveMapping','remove-anchor',`data-page="${p.id}" data-anchor="${a.id}"`)}</div><div data-legacy-picker="${a.id}"></div></section>`).join('')}<div class="inline-actions">${button('legacyAddMapping','add-anchor',`data-page="${p.id}"`)}${button('legacyRemovePage','remove-page',`data-page="${p.id}"`)}</div></fieldset>`).join('')}${button('legacyAddPage','add-page')}`;
 }
 async function open(){const context=websiteContext(state),route=location.hash,result=await api('/api/publication-links/read',{}, {adopt:false});if(context!==websiteContext(state)||route!==location.hash)return;session={...result,context,route,labels:new Map()};showDialog(`<h2 id="dialog-title">${text('legacyLinks')}</h2><div id="publication-links"></div><div class="dialog-actions">${button('legacyDiscard','close')}${button('legacySave','save')}</div>`);draw();}
 async function action(el){
  if(!el.dataset.action?.startsWith('publication-links-'))return false;
  const op=el.dataset.action.slice('publication-links-'.length);if(op==='open'){await open();return true;}if(!active())return true;
  remember();const page=session.config.pages.find(p=>p.id===el.dataset.page);
  if(op==='close'){picker.stop();document.getElementById('dialog').close();session=null;return true;}
  if(op==='save'){if(!validPublicationLinks(session.config))throw Error(publicationText('legacyInvalid'));el.disabled=true;try{await api('/api/publication-links/save',{config:session.config,etag:session.etag,workspaceId:state.book.id},{adopt:false});if(active()){picker.stop();document.getElementById('dialog').close();session=null;}}finally{el.disabled=false;}return true;}
  if(op==='add-page')session.config.pages.push({id:crypto.randomUUID(),path:'',title:'',anchors:[anchor()]});
  if(op==='remove-page')session.config.pages=session.config.pages.filter(p=>p!==page);
  if(op==='add-anchor')page.anchors.push(anchor());
  if(op==='remove-anchor')page.anchors=page.anchors.filter(a=>a.id!==el.dataset.anchor);
  if(op==='choose'){
   const row=page.anchors.find(a=>a.id===el.dataset.anchor),host=document.querySelector('[data-legacy-picker="'+row.id+'"]'),owner=session;
   picker.open({root:host,recordsOnly:true,title:publicationText('legacyChoose'),controls:field(text('legacyVersion'),`<select data-legacy-version><option value="current">${text('legacyCurrent')}</option><option value="exact">${text('legacyExact')}</option></select>`),onCancel:()=>{host.innerHTML='';},onChoose:async(item,{stillCurrent})=>{
    if(!stillCurrent()||session!==owner)return;
    row.target={workspaceId:state.book.id,kind:'record',id:item.id,...(host.querySelector('[data-legacy-version]').value==='exact'?{revision:item.revision}:{})};session.labels.set(row.id,item.title);if(!row.label)row.label=item.title;draw();
   }});return true;
  }
  draw();return true;
 }
 return {action};
}
