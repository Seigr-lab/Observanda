// Canvas media belongs to the authenticated workspace. Its immutable identity
// must outlive eviction of a transient rendered feed window.
export function canvasResourceURL(value,baseURL,context){
 const url=new URL(value,baseURL),base=new URL(baseURL),media=/^\/(?:preview|api\/projects\/([a-f0-9-]{36})(?:\/lab-books\/([a-f0-9-]{36}))?\/publication-preview)\/[a-f0-9]{64}\/(?:media|downloads)\/([a-f0-9-]{36})\.(png|wav|mp4|bin)$/.exec(url.pathname);
 if(context&&url.origin===base.origin&&media)return new URL((media[1]?'/api/projects/'+media[1]+(media[2]?'/lab-books/'+media[2]:'')+'/media/':'/api/media/')+media[3]+'?context='+encodeURIComponent(context),base).href;
 return url.href;
}
export function canvasResourceLinks(doc,baseURL,context){
 for(const node of doc.querySelectorAll('[href],[src]'))for(const name of ['href','src']){const value=node.getAttribute(name);if(value&&!value.startsWith('#'))node.setAttribute(name,canvasResourceURL(value,baseURL,context));}
}
