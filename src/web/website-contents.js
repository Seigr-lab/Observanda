import {treeOrder} from './composition-tree.js';
import {sectionAnchor} from './record-workflow.js';
import {proseText} from './prose-model.js';

// Operates only on the admitted publication projection, never workspace records.
export function pageContents(context,target){
  const layout=context.website.layouts.find(l=>l.target===target);
  const authored=target==='home'?context.website.home.sections:context.pages.find(p=>'page:'+p.id===target)?.sections??[];
  const sectionLinks=sections=>treeOrder(sections).filter(({element:s})=>s.title.trim()&&!['container','contents','divider'].includes(s.kind)).map(({element:s,depth})=>({id:'section-'+s.id,title:s.title,depth}));
  let original=sectionLinks(authored);
  if(target.startsWith('entry:'))original=context.entries.find(e=>'entry:'+e.id===target)?.sections.filter(s=>s.title.trim()&&proseText(s.body).trim()).map(s=>({id:sectionAnchor(s),title:s.title,depth:0}))??[];
  if(target.startsWith('project:'))original=[...(context.notebooks.some(n=>'project:'+n.projectId===target)?[{id:'page-notebooks',title:'Lab books',depth:0}]:[]),{id:'page-records',title:'Entries',depth:0}];
  const extra=sectionLinks(layout?.sections??[]);
  const links=layout?.placement==='replace'?extra:layout?.placement==='after'?[...original,...extra]:[...extra,...original];
  return links.filter((link,index)=>links.findIndex(other=>other.id===link.id)===index);
}
