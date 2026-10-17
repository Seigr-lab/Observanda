import {hasHomepage} from './website-layouts.js';
// Structural discovery retains one window of labels. Authored page bodies are
// requested only when a page or its section links become the selected value.
export async function websiteDocumentPages(documents,book,{kind='site',search='',offset=0,limit=25,signal}={}){
 const needle=search.trim().toLocaleLowerCase(),items=[];let prefix=0;
 const add=value=>{if(!value.title.toLocaleLowerCase().includes(needle))return;if(prefix>=offset&&items.length<limit)items.push(value);prefix++;};
 if(['site','all','structure'].includes(kind)&&hasHomepage(book))add({target:'home',title:'Home',path:'index.html'});
 for(const [itemKind,name] of [['project','projects'],['notebook','notebooks']])if(kind===itemKind||['all','structure'].includes(kind))for(const item of book[name])add({target:itemKind+':'+item.id,title:item.title,path:name+'/'+item.id+'.html'});
 let total=prefix;
 if(['site','page','all','structure'].includes(kind)){
  const page=await documents.window('pages',{offset:Math.max(0,offset-prefix),limit:Math.max(1,limit-items.length),search,signal});total+=page.total;
  if(items.length<limit)items.push(...page.items.map(({value})=>({target:'page:'+value.id,title:value.title,path:'pages/'+value.id+'.html',share:value.share})).slice(0,limit-items.length));
 }
 return {items,total,offset,previousCursor:offset?Math.max(0,offset-limit):null,nextCursor:offset+items.length<total?offset+limit:null};
}