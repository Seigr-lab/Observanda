import {t} from './i18n/index.js';
const tr=key=>t('publishingData',key);
// Dashboard cards for the websites made in the website editor: each website
// with its page counts, and every page with the website it belongs to.
// Choosing an item opens that website in the editor.
export function registerPublishingData(registry){
 const loadKey=c=>JSON.stringify([c.book.id,c.etag]);
 const load=async({api,signal})=>{const result=await api('/api/website-files/list',{limit:100},{owner:null,adopt:false,signal});if(!Array.isArray(result?.items))throw Error(tr('invalid'));return result.items;};
 registry.register({id:'website',metadataOnly:true,label:tr('website'),group:tr('group'),purpose:tr('purposeWebsite'),icon:'website',
  fields:[{key:'pages',label:tr('pageCount')},{key:'drafts',label:tr('draftCount')}],defaultFields:['pages','drafts'],loadKey,load,
  items:(c,sites)=>(sites??[]).map(site=>({key:site.id,title:site.name,data:{pages:site.pages.length,drafts:site.pages.filter(page=>page.draft).length},action:{name:'site-open',id:site.id}}))});
 registry.register({id:'pages',metadataOnly:true,label:tr('pages'),group:tr('group'),purpose:tr('purposePages'),icon:'website',
  fields:[{key:'site',label:tr('site')},{key:'path',label:tr('path')}],defaultFields:['site','path'],loadKey,load,
  items:(c,sites)=>(sites??[]).flatMap(site=>site.pages.map(page=>({key:site.id+'/'+page.path,title:page.title||page.path,data:{site:site.name,path:page.path},action:{name:'site-open',id:site.id}})))});
}
