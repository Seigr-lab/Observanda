import {cloneElements} from './composition-tree.js';
// Page presentation belongs to the website, never to the underlying research record.
export const hasHomepage = book => book.website.home.enabled !== false;
export const layoutTargets = book => [
  ...(hasHomepage(book)?[{target:'home', title:'Home', path:'index.html'}]:[]),
  ...book.pages.map(p=>({target:'page:'+p.id,title:p.title,path:'pages/'+p.id+'.html'})),
  ...book.projects.map(p=>({target:'project:'+p.id,title:p.title,path:'projects/'+p.id+'.html'})),
  ...book.notebooks.map(n=>({target:'notebook:'+n.id,title:n.title,path:'notebooks/'+n.id+'.html'})),
  ...book.entries.map(e=>({target:'entry:'+e.id,title:e.title,path:'entries/'+e.id+'.html'}))
];
export const defaultPageLayout = target => ({target,showHeading:true,heading:'',description:'',placement:'before',sections:[]});
export function usedAssetIds(sections) {
  return sections.flatMap(s => s.kind==='gallery'?s.assetIds:['hero','asset','download'].includes(s.kind)&&s.assetId?[s.assetId]:[]);
}
// Starters contain structure, with empty authored text. Applying never publishes a record.
export const PAGE_STARTERS = [
  {id:'journal',name:'Research journal',description:'An introduction followed by a chronological record list.',sections:[
    {kind:'hero',title:'',body:'',format:'markdown',assetId:null,href:'home',label:'',style:{width:'full',surface:'none',align:'start',space:'roomy'}},
    {kind:'records',title:'Recent work',layout:'editorial'}]},
  {id:'portfolio',name:'Visual collection',description:'A lead image, an image gallery and selected projects.',sections:[
    {kind:'hero',title:'',body:'',format:'markdown',assetId:null,href:'home',label:'',style:{width:'full',surface:'tint',align:'start',space:'roomy'}},
    {kind:'gallery',title:'',assetIds:[],columns:3},
    {kind:'projects',title:'Projects',layout:'grid'}]},
  {id:'article',name:'Article or recipe',description:'Two text columns, an illustration and related reading.',sections:[
    {kind:'text',title:'',body:'',format:'markdown',style:{width:'two-thirds',surface:'none',align:'start',space:'normal'}},
    {kind:'callout',title:'',body:'',format:'markdown',style:{width:'third',surface:'tint',align:'start',space:'normal'}},
    {kind:'gallery',title:'',assetIds:[],columns:2},
    {kind:'records',title:'Related records',layout:'grid'}]}
];
// Designed compositions remain ordinary editable elements.
const block=(id,kind,values={})=>({id,kind,title:'',show:true,...values});
const baseStyle={width:'full',surface:'none',align:'start',space:'normal'};
PAGE_STARTERS.unshift(
 {id:'field-journal',name:'Field journal',description:'A quiet editorial page with a split introduction and a focused reading column.',sections:[
  block('opening','container',{layout:'row',columns:2,gap:40,style:{...baseStyle,padding:40,background:'#f3eee5',color:'#263b32',radius:8}}),
  block('intro','container',{parentId:'opening',layout:'column',columns:1,gap:20}),
  block('eyebrow','text',{parentId:'intro',body:'FIELD NOTES / AN OPEN PRACTICE',style:{...baseStyle,fontSize:14}}),
  block('title','heading',{parentId:'intro',title:'Pay attention. There is more to discover.',level:1}),
  block('intro-copy','text',{parentId:'intro',body:'A place for questions, observations, and the work that follows. Share the process as well as the outcome.'}),
  block('cover','asset',{parentId:'opening',assetId:null,style:{...baseStyle,width:'half'}}),
  block('reading','container',{layout:'row',columns:2,gap:40,style:{...baseStyle,padding:24}}),
  block('reading-title','heading',{parentId:'reading',title:'Small questions. Careful work.',level:2,style:{...baseStyle,width:'third'}}),
  block('reading-copy','text',{parentId:'reading',body:'Start with something you noticed. Describe what you tried, what changed, and what you would like to understand next. This page is yours to reshape: add photographs, recordings, methods, or a collection of your published work.',style:{...baseStyle,width:'two-thirds'}})
 ]},
 {id:'visual-story',name:'Visual story',description:'A generous title, a wide image, and an accompanying note.',sections:[
  block('lead','container',{layout:'column',columns:1,gap:16,style:{...baseStyle,padding:36,background:'#202d45',color:'#f5f0e7',radius:8}}),
  block('label','text',{parentId:'lead',body:'OBSERVATION / MATERIAL / PROCESS',style:{...baseStyle,fontSize:14}}),
  block('title','heading',{parentId:'lead',title:'A different way of seeing.',level:1}),
  block('copy','text',{parentId:'lead',body:'An evolving collection of images, ideas, and experiments.'}),
  block('image','asset',{assetId:null}),
  block('note','container',{layout:'row',columns:2,gap:32}),
  block('note-title','heading',{parentId:'note',title:'Behind the work',level:2,style:{...baseStyle,width:'third'}}),
  block('note-copy','text',{parentId:'note',body:'Every finished piece has a history. Use this space to share the question, the choices, and the details that make your work worth a closer look.',style:{...baseStyle,width:'two-thirds'}})
 ]},
 {id:'working-notes',name:'Working notes',description:'A readable article with a contrasting notes column.',sections:[
  block('title','heading',{title:'An idea, put into practice.',level:1}),
  block('intro','text',{body:'Describe the question that started this work, and why it matters to you.'}),
  block('columns','container',{layout:'row',columns:2,gap:40}),
  block('article','container',{parentId:'columns',layout:'column',columns:1,gap:20,style:{...baseStyle,width:'two-thirds'}}),
  block('method','heading',{parentId:'article',title:'What I tried',level:2}),
  block('method-copy','text',{parentId:'article',body:'Record the process in your own words. Include enough detail for someone else, or your future self, to follow it.'}),
  block('outcome','heading',{parentId:'article',title:'What happened',level:2}),
  block('outcome-copy','text',{parentId:'article',body:'Share observations, comparisons, and open questions. Add images or measurements wherever they help tell the story.'}),
  block('notes','callout',{parentId:'columns',title:'Keep in mind',body:'Materials, references, variations, or the next thing to try.',style:{...baseStyle,width:'third',padding:24,background:'#eef3e9',color:'#2b432b',radius:8}})
 ]}
);
export function instantiateLayout(sections,makeId) {
  return cloneElements(sections,makeId).map(s=>({...s,show:s.show??true}));
}
