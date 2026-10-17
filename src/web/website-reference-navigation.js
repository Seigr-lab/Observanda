// Canvas reference navigation changes only the reading window. It never edits
// the website draft or switches the selected page or editing panel.
export class WebsiteReferenceNavigation{
 constructor(){this.key=null;this.cursor=null;this.shown=null;this.focus=null;}
 prepare(context,target,source){
  const draft=source.draft,key=JSON.stringify([context,target,source.websitePin,source.websiteDraft,draft?.baseEtag,draft?.changes,draft?.removed]);
  if(key!==this.key){this.key=key;this.cursor=null;this.shown=null;this.focus=null;}
  return {key,cursor:this.cursor};
 }
 accept(request){if(request.key===this.key&&request.cursor===this.cursor)this.shown=request.cursor;}
 reject(request){if(request.key===this.key&&request.cursor===this.cursor){this.cursor=this.shown;this.focus=null;}}
 click(event,baseURL,refresh){
  const link=event.target.closest('#record-references .book-page-navigation a');if(!link)return false;
  const url=new URL(link.getAttribute('href'),baseURL),base=new URL(baseURL),cursor=url.searchParams.get('references');
  if(url.origin!==base.origin||url.pathname!==base.pathname||!cursor)return false;
  event.preventDefault();event.stopPropagation();this.cursor=cursor;this.focus=link.rel;refresh();return true;
 }
 restoreFocus(doc){
  if(!this.focus)return;const navigation=doc.querySelector('#record-references .book-page-navigation'),link=navigation?.querySelector('[rel="'+this.focus+'"]')??navigation?.querySelector('a');
  this.focus=null;link?.focus({preventScroll:true});navigation?.scrollIntoView({block:'nearest'});
 }
}
