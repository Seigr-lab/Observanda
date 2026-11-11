import path from 'node:path';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {escapeWebsiteText as esc} from './website-file-html.js';
import {attr,descendants} from './website-migration-views.js';
import {REGION_SLOTS,regionElement} from './website-region-model.js';
import {renderComponentInstance} from './website-file-component.js';

// Region wrappers are body children the site owns. Each holds exactly one
// component instance. A region that collapses on phones is an open disclosure:
// it reads complete without scripts, and public-regions.js closes it on phones.
export const REGION_STYLESHEET='website-regions.css';
export const REGION_SCRIPT='public-regions.js';
export const regionMarker='data-website-region';
const conflict=()=>{throw new AppError('CONFLICT');};
const elements=node=>(node?.childNodes??[]).filter(child=>child.tagName);
const bodyOf=document=>[...descendants(document)].find(node=>node.tagName==='body');
const headOf=document=>[...descendants(document)].find(node=>node.tagName==='head');
const resolves=(page,value,name)=>value!==undefined&&path.posix.normalize(path.posix.join(path.posix.dirname(page),value))===name;
const managedHere=(node,page)=>node.tagName==='link'&&attr(node,'rel')==='stylesheet'&&resolves(page,attr(node,'href'),REGION_STYLESHEET)||
 node.tagName==='script'&&resolves(page,attr(node,'src'),REGION_SCRIPT);

export function regionDocument(html){return parse(html,{sourceCodeLocationInfo:true});}

// Every element that claims to be a region, wherever it is in the document.
export function regionWrappers(document){
 return [...descendants(document)].filter(node=>node.tagName&&attr(node,regionMarker)!==undefined);
}

export function regionWrapper(slot,settings,instanceHTML){
 const tag=regionElement(slot),inner=settings.mobile==='collapsed'?'<details data-website-region-toggle="" open=""><summary>'+esc(settings.mobileTitle)+'</summary>'+instanceHTML+'</details>':instanceHTML;
 return '<'+tag+' '+regionMarker+'="'+slot+'">'+inner+'</'+tag+'>';
}

function placement(document,slot){
 const body=bodyOf(document),children=elements(body),main=children.find(node=>node.tagName==='main');
 const start=body.sourceCodeLocation.startTag.endOffset,end=body.sourceCodeLocation.endTag?.startOffset;
 if(!Number.isInteger(end))conflict();
 if(slot==='header')return start;
 if(slot==='footer')return end;
 if(slot==='sidebar')return main?main.sourceCodeLocation.startOffset:start;
 return main?main.sourceCodeLocation.endOffset:end;
}

// Replace the page's regions with the resolved ones. Instances keep their id
// (and author values) while the same component fills the same slot.
export function writePageRegions(html,page,resolved,context,makeId){
 let document=regionDocument(html);
 const previous=new Map((page.instances??[]).filter(row=>row.region).map(row=>[row.region,row]));
 const changes=[];
 for(const wrapper of regionWrappers(document)){
  if(wrapper.parentNode?.tagName!=='body')conflict();
  const loc=wrapper.sourceCodeLocation;changes.push({start:loc.startOffset,end:loc.endOffset});
 }
 for(const change of changes.sort((a,b)=>b.start-a.start))html=html.slice(0,change.start)+html.slice(change.end);
 const kept=(page.instances??[]).filter(row=>!row.region),rows=[];
 document=regionDocument(html);
 const inserts=[];
 for(const {slot,component,settings} of resolved){
  const main=context.components.get(component);if(!main)throw new AppError('NOT_FOUND');
  const prior=previous.get(slot),row=prior?.component===component?prior:{id:makeId(),component,region:slot};
  const markup=regionWrapper(slot,settings,renderComponentInstance(main,row,page,context));
  inserts.push({at:placement(document,slot),order:REGION_SLOTS.indexOf(slot),value:markup});rows.push(row);
 }
 // Insert from the end so earlier offsets stay valid; at a shared offset the
 // later slot goes first, which leaves slots in their reading order.
 for(const item of inserts.sort((a,b)=>b.at-a.at||b.order-a.order))html=html.slice(0,item.at)+item.value+html.slice(item.at);
 html=linkRegionFiles(html,page.path,rows.length>0);
 return {html,instances:[...kept,...rows]};
}

// Pages with regions link the managed stylesheet and phone script once, last in their head.
export function linkRegionFiles(html,page,wanted){
 const head=headOf(regionDocument(html)),present=elements(head).filter(node=>managedHere(node,page));
 const tags=wanted?['<link rel="stylesheet" href="'+esc(path.posix.relative(path.posix.dirname(page),REGION_STYLESHEET))+'">','<script defer src="'+esc(path.posix.relative(path.posix.dirname(page),REGION_SCRIPT))+'"></script>']:[];
 if(present.length===tags.length&&present.every((node,index)=>html.slice(node.sourceCodeLocation.startOffset,node.sourceCodeLocation.endOffset)===tags[index]))return html;
 for(const node of present.sort((a,b)=>b.sourceCodeLocation.startOffset-a.sourceCodeLocation.startOffset)){const loc=node.sourceCodeLocation;html=html.slice(0,loc.startOffset)+html.slice(loc.endOffset);}
 if(!wanted)return html;
 const at=headOf(regionDocument(html))?.sourceCodeLocation?.endTag?.startOffset;if(!Number.isInteger(at))conflict();
 return html.slice(0,at)+tags.join('')+html.slice(at);
}

// Site-wide presentation for each slot, written to one managed stylesheet.
export function regionStylesheet(slots){
 const sidebars=['sidebar','secondary-sidebar'].filter(slot=>slots[slot]);
 const columns={left:[1,2],right:[4,5]},css=[];
 const layout='body:has(> [data-website-region="sidebar"], > [data-website-region="secondary-sidebar"])';
 css.push(layout+' { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto; grid-auto-flow: dense; align-items: start; }');
 css.push(layout+' > * { grid-column: 1 / -1; }');
 css.push(layout+' > main { grid-column: 3; min-inline-size: 0; }');
 css.push('[data-website-region-toggle] > summary { cursor: pointer; font-weight: 600; }');
 for(const slot of REGION_SLOTS){
  const settings=slots[slot]?.settings;if(!settings)continue;
  const selector='body > [data-website-region="'+slot+'"]',rules=['box-sizing: border-box'];
  if(settings.background)rules.push('background: '+settings.background);
  if(settings.color)rules.push('color: '+settings.color);
  if(settings.padding)rules.push('padding: '+settings.padding+'px');
  if(settings.sticky)rules.push('position: sticky','inset-block-start: 0','z-index: 1');
  if(sidebars.includes(slot)){
   const sameSide=sidebars.filter(other=>slots[other].settings.side===settings.side),index=sameSide.indexOf(slot);
   rules.push('grid-column: '+columns[settings.side][index],'inline-size: '+settings.width+'px');
   if(settings.sticky)rules.push('max-block-size: 100vh','overflow: auto');
  }
  css.push(selector+' { '+rules.join('; ')+'; }');
 }
 css.push('@media (max-width: 48rem) { '+layout+' { display: block; } body > [data-website-region] { inline-size: auto; max-block-size: none; position: static; } }');
 css.push('@media (min-width: 48.01rem) { [data-website-region-toggle] > summary { display: none; } }');
 return css.join('\n')+'\n';
}
