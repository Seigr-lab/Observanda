import {parse} from 'parse5';
import {AppError} from './errors.js';
import {FileContent,contentSize,contentStream} from './file-content.js';
import {websitePageIdentity} from './website-page-paths.js';
import {activeTranslations,emptyDiscovery,pageLanguage} from './website-discovery-settings.js';

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[char]);
const pageLimit=16*1024*1024;
// Pages are streamed rather than buffered through the shared media admission,
// so preparing declarations never competes with image or download buffers.
async function pageText(content,signal){
 const size=contentSize(content);if(size>pageLimit)throw new AppError('LIMIT');if(!size)return '';
 const parts=[],stream=content instanceof FileContent?content.stream(0,size-1,{signal}):contentStream(content);
 for await(const bytes of stream){signal?.throwIfAborted();parts.push(bytes);}
 return Buffer.concat(parts).toString('utf8');
}

// The directory form is the public address of an index page.
export function publicPageURL(baseUrl,path){
 const segments=path.split('/').map(encodeURIComponent),last=segments.at(-1);
 if(last==='index.html')segments[segments.length-1]='';
 return new URL(segments.join('/'),baseUrl).href;
}
// Head insertion keeps every authored byte; only a generated block is added
// immediately before the end of the head element.
function headInsertion(html){
 const document=parse(html,{sourceCodeLocationInfo:true}),root=document.childNodes.find(node=>node.tagName==='html');
 const head=root?.childNodes.find(node=>node.tagName==='head');
 const location=head?.sourceCodeLocation;
 if(location?.endTag)return location.endTag.startOffset;
 const last=head?.childNodes.at(-1)?.sourceCodeLocation??location?.startTag;
 if(last)return last.endOffset;
 const body=root?.childNodes.find(node=>node.tagName==='body')?.sourceCodeLocation?.startTag;
 return body?body.startOffset:0;
}
function declared(html){
 const document=parse(html),found={canonical:false,robots:false,properties:new Set(),names:new Set(),title:'',description:''};
 const head=document.childNodes.find(node=>node.tagName==='html')?.childNodes.find(node=>node.tagName==='head');
 for(const node of head?.childNodes??[]){
  const attr=name=>node.attrs?.find(row=>row.name===name)?.value;
  if(node.tagName==='link'&&attr('rel')?.toLowerCase().split(/\s+/).includes('canonical'))found.canonical=true;
  if(node.tagName==='meta'){
   const name=attr('name')?.toLowerCase(),property=attr('property')?.toLowerCase();
   if(name==='robots')found.robots=true;
   if(name==='description')found.description=attr('content')??'';
   if(name)found.names.add(name);if(property)found.properties.add(property);
  }
  if(node.tagName==='title')found.title=node.childNodes.map(child=>child.value??'').join('').trim();
 }
 return found;
}
const ogLocale=language=>/^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(language)?language.split('-').map((part,i)=>i?part.toUpperCase():part.toLowerCase()).join('_'):null;

// Writes canonical, language alternative, social preview and indexing
// declarations into each public page, and adds a sitemap and robots file when
// the site is configured for them. Draft and archived pages are never named.
export async function applyDiscovery(manifest,files,{site,signal}={}){
 const settings={...emptyDiscovery(),...(manifest.discovery??{})};
 if(!manifest.discovery)return [];
 const base=settings.baseUrl,publicPages=manifest.pages.filter(page=>!page.draft&&!page.archived&&files.has(page.path));
 const identity=page=>websitePageIdentity(manifest.id,page),byId=new Map(publicPages.map(page=>[identity(page),page]));
 const languages=new Map(),texts=new Map();
 for(const page of publicPages){
  signal?.throwIfAborted();
  const text=await pageText(files.get(page.path),signal);
  texts.set(page.path,text);languages.set(page.path,pageLanguage(text));
 }
 const groups=new Map();
 for(const group of activeTranslations(manifest)){
  const members=group.pages.map(id=>byId.get(id)).filter(page=>page&&languages.get(page.path));
  if(members.length<2)continue;
  for(const page of members)groups.set(page.path,{members,source:byId.get(group.source)??null});
 }
 const image=base&&settings.socialImage&&files.has(settings.socialImage)?publicPageURL(base,settings.socialImage):null;
 for(const page of publicPages){
  const html=texts.get(page.path),found=declared(html),lines=[];
  const url=base?publicPageURL(base,page.path):null,language=languages.get(page.path),group=groups.get(page.path);
  if(url&&!found.canonical)lines.push('<link rel="canonical" href="'+escape(url)+'">');
  if(url&&group){
   const seen=new Set();
   for(const member of group.members){
    const lang=languages.get(member.path);if(seen.has(lang.toLowerCase()))continue;seen.add(lang.toLowerCase());
    lines.push('<link rel="alternate" hreflang="'+escape(lang)+'" href="'+escape(publicPageURL(base,member.path))+'">');
   }
   if(group.source)lines.push('<link rel="alternate" hreflang="x-default" href="'+escape(publicPageURL(base,group.source.path))+'">');
  }
  if(!settings.indexing&&!found.robots)lines.push('<meta name="robots" content="noindex">');
  const title=found.title||page.title||site?.name||'';
  const meta=(property,content)=>{if(content&&!found.properties.has(property))lines.push('<meta property="'+property+'" content="'+escape(content)+'">');};
  meta('og:type','website');meta('og:title',title);meta('og:description',found.description);meta('og:url',url);meta('og:locale',ogLocale(language));
  meta('og:image',image);if(image)meta('og:image:alt',settings.socialImageAlt);
  if(!found.names.has('twitter:card'))lines.push('<meta name="twitter:card" content="'+(image?'summary_large_image':'summary')+'">');
  if(!lines.length)continue;
  const at=headInsertion(html),block=lines.join('\n')+'\n';
  files.set(page.path,Buffer.from(html.slice(0,at)+block+html.slice(at)));
 }
 const generated=[];
 if(base&&settings.sitemap&&settings.indexing&&!files.has('sitemap.xml')){
  const rows=publicPages.map(page=>{
   const group=groups.get(page.path),alternates=group?group.members.map(member=>'<xhtml:link rel="alternate" hreflang="'+xml(languages.get(member.path))+'" href="'+xml(publicPageURL(base,member.path))+'"/>').join(''):'';
   return '<url><loc>'+xml(publicPageURL(base,page.path))+'</loc>'+alternates+'</url>';
  });
  files.set('sitemap.xml',Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'+rows.join('\n')+'\n</urlset>\n'));
  generated.push('sitemap.xml');
 }
 // Crawlers read robots.txt only at the root of a host. A site published in
 // a subdirectory relies on the per-page robots declaration instead.
 if(base&&new URL(base).pathname==='/'&&!files.has('robots.txt')){
  const lines=['User-agent: *',settings.indexing?'Allow: /':'Disallow: /'];
  if(settings.sitemap&&settings.indexing)lines.push('','Sitemap: '+new URL('sitemap.xml',base).href);
  files.set('robots.txt',Buffer.from(lines.join('\n')+'\n'));generated.push('robots.txt');
 }
 return generated;
}
// The names a configured site adds to its published files, for reviews that
// list names without preparing pages.
export function discoveryNames(manifest,existing){
 const settings=manifest.discovery;if(!settings?.baseUrl)return [];
 const names=[];
 if(settings.sitemap&&settings.indexing)names.push('sitemap.xml');
 if(new URL(settings.baseUrl).pathname==='/')names.push('robots.txt');
 return names.filter(name=>!existing.has(name));
}
