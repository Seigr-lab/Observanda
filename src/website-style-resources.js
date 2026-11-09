import path from 'node:path';
import {parse,serialize} from 'parse5';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {websiteFeedPages} from './website-dynamic-feeds.js';
import {escapeWebsiteText} from './website-file-html.js';
import {tokenID,validToken,tokenSheet} from './web/website-token-model.js';
import {websiteFileName} from './website-file-policy.js';
import {bundledStyleFile,fontDefinitions,syncFontFiles,validStyleFont} from './website-style-fonts.js';
import {customFontId} from './web/font-catalogue.js';

export const newStyleBook=()=>({tokens:[],site:[],folders:{},pages:{},fonts:[]});
const invalid=()=>{throw new AppError('FORMAT');};
export const styleResource=id=>'website-styles/'+id+'.css';
export function validateStyleResources(manifest){
 const book=manifest.styleBook;if(!book){if(manifest.files.some(file=>file.tokenSheet||file.tokenFont))invalid();return;}
 if(!Array.isArray(book.tokens)||!Array.isArray(book.site)||!Array.isArray(book.fonts)||!book.folders||!book.pages)invalid();
 const lookup=new Map(),classes=new Set();
 const fonts=new Set();
 for(const font of book.fonts){if(!validStyleFont(font)||fonts.has(font.id))invalid();fonts.add(font.id);}
 for(const token of book.tokens){if(!validToken(token)||lookup.has(token.id)||classes.has(token.classId))invalid();lookup.set(token.id,token.group);classes.add(token.classId);}
 for(const token of book.tokens)for(const state of Object.values(token.rules))if(customFontId(state['font-family'])&&!fonts.has(state['font-family']))invalid();
 for(const scope of [book.site,...Object.values(book.folders),...Object.values(book.pages)]){
  if(!Array.isArray(scope)||scope.some(id=>!lookup.has(id))||new Set(scope.map(id=>lookup.get(id))).size!==scope.length)invalid();
 }
 const pages=new Set(manifest.pages.map(p=>p.path));
 for(const target of Object.keys(book.pages))if(!pages.has(target))invalid();
 for(const folder of Object.keys(book.folders)){if(!folder.endsWith('/'))invalid();websiteFileName(folder+'index.html');}
 const sheets=new Set(book.tokens.map(t=>styleResource(t.classId))),faces=new Map(book.fonts.map(f=>['fonts/'+f.faces[0].file,f])),notices=new Map(book.fonts.map(f=>['licenses/'+f.id+'.txt',f]));
 for(const file of manifest.files){
  if(file.tokenSheet&&(file.tokenSheet!==true||!sheets.has(file.name)||file.sourceId||file.feedAsset||file.tokenFont))invalid();
  if(!file.tokenFont)continue;
  if(file.tokenFont!==true||file.sourceId||file.feedAsset)invalid();
  const font=faces.get(file.name),notice=notices.get(file.name);
  if(font){if(file.sha256!==font.id.slice(7)||!file.draft&&!font.embed)invalid();}
  else if(notice){if(!notice.embed||!notice.notice||file.sha256!==digest(notice.notice))invalid();}
  else if(!bundledStyleFile(file.name))invalid();
 }
}
export function styleScopes(book,address,groups=new Map(book.tokens.map(t=>[t.id,t.group]))){
 const inherited=new Map();
 const parts=address.split('/');let dir='';
 for(const part of parts.slice(0,-1)){
  dir+=part+'/';for(const id of book.folders[dir]??[])inherited.set(groups.get(id),id);
 }
 return {site:book.site,folder:[...inherited.values()],page:book.pages[address]??[]};
}
const attr=(node,key)=>node.attrs?.find(a=>a.name===key)?.value;
export const editsForAttribute=(html,node,name,value,edits)=>{
 if((attr(node,name)??null)===value)return;
 const loc=node.sourceCodeLocation;
 if(!loc?.startTag)throw new AppError('INVALID');
 const current=loc.attrs?.[name],from=current?.startOffset??loc.startTag.endOffset-(html[loc.startTag.endOffset-2]==='/'?2:1);
 edits.push({from,to:current?.endOffset??from,value:value===null?'':(current?'':' ')+name+'="'+escapeWebsiteText(value)+'"'});
};
function projected(html,file,scopes,valid){
 const doc=parse(html,{sourceCodeLocationInfo:true}),edits=[],used=new Set(Object.values(scopes).flat()),links=[],pending=[doc];
 let head;
 while(pending.length){
  const node=pending.pop();
  if(node.tagName==='head')head=node;
  if(node.tagName==='body'){
   if(used.size&&!node.sourceCodeLocation?.startTag)return projected(serialize(doc),file,scopes,valid);
   for(const [scope,ids] of Object.entries(scopes))editsForAttribute(html,node,'data-website-'+scope+'-styles',ids.length?ids.join(' '):null,edits);
  }
  if(node.tagName==='link'&&tokenID(attr(node,'data-website-token-sheet'))){links.push(node);continue;}
  const classes=attr(node,'class');
  if(classes?.includes('ow-token-')){
   // Removed tokens become inert. The authored class remains identical in a
   // reusable component master and its linked instances.
   for(const name of classes.split(/\s+/))if(name.startsWith('ow-token-')&&valid.has(name.slice(9)))used.add(name.slice(9));
  }
  if(node.content)pending.push(node.content);
  for(let i=(node.childNodes?.length??0)-1;i>=0;i--)if(node.childNodes[i].tagName)pending.push(node.childNodes[i]);
 }
 const ordered=[...used].sort(),url=id=>path.posix.relative(path.posix.dirname(file.name),styleResource(id));
 if(!head)throw new AppError('INVALID');
 const firstStyle=head.childNodes.find(n=>n.tagName==='style'||n.tagName==='link'&&attr(n,'rel')==='stylesheet'&&!attr(n,'data-website-token-sheet'));
 if(ordered.length!==links.length||links.some((el,i)=>attr(el,'rel')!=='stylesheet'||attr(el,'data-website-token-sheet')!==ordered[i]||attr(el,'href')!==url(ordered[i])||el.parentNode!==head||firstStyle&&el.sourceCodeLocation.startOffset>firstStyle.sourceCodeLocation.startOffset)){
  for(const el of links){const loc=el.sourceCodeLocation;edits.push({from:loc.startOffset,to:loc.endOffset,value:''});}
  if(ordered.length){
   const tags=ordered.map(id=>'<link rel="stylesheet" data-website-token-sheet="'+id+'" href="'+url(id)+'">').join('');
   if(head.sourceCodeLocation?.endTag){const at=firstStyle?.sourceCodeLocation.startOffset??head.sourceCodeLocation.endTag.startOffset;edits.push({from:at,to:at,value:tags});}
   else return projected(serialize(doc),file,scopes,valid);
  }
 }
 let at=0;const parts=[];for(const e of edits.sort((a,b)=>a.from-b.from)){parts.push(html.slice(at,e.from),e.value);at=e.to;}
 return {html:edits.length?parts.join('')+html.slice(at):html,used:ordered};
}
export async function syncStyleResources(store,manifest,signal){
 const book=manifest.styleBook;if(!book)return manifest;
 const groups=new Map(book.tokens.map(t=>[t.id,t.group])),byId=new Map(book.tokens.map(t=>[t.id,t.classId])),ids=new Set(byId.values()),host=new Map(websiteFeedPages(manifest).map(f=>[f.path,f.ownerPage]));
 const files=[],sheets=new Map(),publicity=new Map();
 for(const f of manifest.files){
  if(f.tokenSheet){sheets.set(f.name,f);continue;}
  if(!f.name.endsWith('.html')){files.push(f);continue;}
  const assigned=styleScopes(book,host.get(f.name)??f.name,groups),scopes={};
  for(const [scope,list] of Object.entries(assigned))scopes[scope]=list.map(id=>byId.get(id));
  const key=JSON.stringify(scopes);
  if(!Object.values(scopes).some(a=>a.length)&&!f.hasStyles&&!f.tokenSeal){files.push(f);continue;}
  let next=f;
  if(f.tokenSeal!==f.sha256||f.styleScopes!==key||f.tokenUsage?.some(id=>!ids.has(id))){
   const html=await store.readText(f,{signal}),result=projected(html,f,scopes,ids);
   next={...f,...(html===result.html?{}:await store.siteFile(manifest.id,f.name,result.html,{draft:f.draft,signal})),styleScopes:key,tokenUsage:result.used};
   next.tokenSeal=next.sha256;
  }
  for(const id of next.tokenUsage??[])publicity.set(id,publicity.get(id)===true||!f.draft);
  files.push(next);
 }
 const names=new Set(files.map(f=>f.name)),custom=new Map(book.fonts.map(font=>[font.id,font])),requiredFonts=new Map();
 for(const token of book.tokens){
  if(!publicity.has(token.classId))continue;
  const {css,files:faces}=fontDefinitions(token,custom);
  const name=styleResource(token.classId),draft=!publicity.get(token.classId),content=(css?css+'\n':'')+tokenSheet(token),old=sheets.get(name);
  for(const [path,value] of faces)requiredFonts.set(path,{value,publicUse:!draft||Boolean(requiredFonts.get(path)?.publicUse)});
  if(names.has(name))throw new AppError('CONFLICT');
  files.push(old?.sha256===digest(content)&&!!old.draft===draft?old:{...await store.siteFile(manifest.id,name,content,{draft,signal}),tokenSheet:true});
 }
 return {...manifest,files:await syncFontFiles(store,manifest.id,files,requiredFonts,custom,signal)};
}
