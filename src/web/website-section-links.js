import {treeOrder} from './composition-tree.js';
import {REGION_SLOTS,resolveRegion} from './website-regions.js';
import {sectionAnchor} from './record-workflow.js';
import {inventoryWindow} from './website-inventory.js';
import {t} from './i18n/index.js';

export function* websiteSectionLinks(book,target){
 const layout=book.website.layouts.find(value=>value.target===target),authored=target==='home'?book.website.home.sections:book.pages.find(page=>'page:'+page.id===target)?.sections??[];
 const lists=[{sections:layout?.sections??[],prefix:''},...(layout?.placement==='replace'?[]:[{sections:authored,prefix:''}]),...REGION_SLOTS.flatMap(slot=>{const region=resolveRegion(book.website,target,slot);return region?[{sections:region.sections,prefix:slot+'-'}]:[];})];
 if(target.startsWith('project:')&&layout?.placement!=='replace'){
  if(book.notebooks.some(notebook=>'project:'+notebook.projectId===target))yield {id:'page-notebooks',title:t('book','labBooks')};
  yield {id:'page-records',title:t('websitePages','entries')};
 }
 for(const{sections,prefix}of lists){const hidden=new Set();for(const{element}of treeOrder(sections)){
  if(!element.show||hidden.has(element.parentId)){hidden.add(element.id);continue;}
  yield {id:prefix+'section-'+element.id,title:element.title||element.label||''};
 }}
}
export function websiteSectionWindow(book,target,{record=false,offset=0}={}){
 const source=record?(book.entries.find(entry=>'entry:'+entry.id===target)?.sections??[]).map(section=>({id:sectionAnchor(section),title:section.title})):websiteSectionLinks(book,target);
 return inventoryWindow(source,{offset,limit:25,label:section=>section.title});
}
