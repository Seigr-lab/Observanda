import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {parse,parseFragment} from 'parse5';
import {AppError} from './errors.js';
import {newStyleBook,styleScopes,editsForAttribute} from './website-style-resources.js';
import {sectionNode} from './website-scoped-themes.js';
import {componentOperation} from './website-component-storage.js';
import {tokenGroups,tokenClass,tokenID,validToken} from './web/website-token-model.js';
import {customFontId} from './web/font-catalogue.js';
import {prepareStyleFont,validStyleFont} from './website-style-fonts.js';
import {hasPrivateText} from './privacy-text.js';

const fail=code=>{throw new AppError(code);};
const classes=node=>(node.attrs?.find(a=>a.name==='class')?.value??'').split(/\s+/).filter(Boolean);
const assigned=(node,byClass)=>node?classes(node).filter(c=>c.startsWith('ow-token-')&&byClass.has(c.slice(9))).map(c=>byClass.get(c.slice(9)).id):[];
const folded=text=>text.trim().normalize('NFC').toLowerCase();
function selectOwner(html,isComponent,blockPath){
 if(isComponent)return parseFragment(html,{sourceCodeLocationInfo:true}).childNodes.find(n=>n.tagName);
 return sectionNode(parse(html,{sourceCodeLocationInfo:true}),blockPath);
}
function assignedHTML(html,node,group,id,tokens){
 const selected=classes(node).filter(c=>!c.startsWith('ow-token-')||tokens.get(c.slice(9))?.group!==group);
 if(id)selected.push(tokenClass(id));const edits=[];
 editsForAttribute(html,node,'class',selected.length?selected.join(' '):null,edits);
 if(!edits.length)return html;
 const e=edits[0];return html.slice(0,e.from)+e.value+html.slice(e.to);
}
export async function websiteStyleBook(store,id,options){
 const {expectedRevision,path:address='index.html',action='list',tokenId,scope,group,blockPath,component,signal}=options;
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!['list','create','update','remove','assign','import-font','font-rights'].includes(action))fail('INVALID');
 let upload;
 if(action==='import-font'){
  await store.checkRevision(id,expectedRevision);
  upload=await prepareStyleFont(options);
 }
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision),page=manifest.pages.find(p=>p.path===address&&!p.archived);
  if(!page)fail('NOT_FOUND');
  const book=structuredClone(manifest.styleBook??newStyleBook()),tokens=new Map(book.tokens.map(t=>[t.id,t])),byClass=new Map(book.tokens.map(t=>[t.classId,t])),file=manifest.files.find(f=>f.name===address);
  if(action==='list'){
   const {offset=0,query='',lookups=[]}=options;
   if(!Number.isSafeInteger(offset)||offset<0||typeof query!=='string'||query.length>160||!Array.isArray(lookups)||lookups.length>32||lookups.some(id=>!tokenID(id)))fail('INVALID');
   const term=folded(query),matches=book.tokens.filter(t=>(!group||t.group===group)&&folded(t.name).includes(term));
   const uses=new Map();for(const f of manifest.files)for(const uid of f.tokenUsage??[])uses.set(uid,(uses.get(uid)??0)+1);
   const scopes=styleScopes(book,address),items=matches.slice(offset,offset+40).map(t=>({...t,pages:uses.get(t.classId)??0}));
   if(blockPath!=null){
    try{scopes.element=assigned(selectOwner(await store.readText(file,{signal}),false,blockPath),byClass);}
    catch(e){if(e.code!=='INVALID')throw e;}
   }
   const componentId=page.instances?.find(i=>i.id===options.instance)?.component;
   const main=componentId&&manifest.components?.find(c=>c.id===componentId);
   if(main)scopes.component=assigned(selectOwner(main.html,true),byClass);
   const direct={...scopes,folder:book.folders[path.posix.dirname(address)+'/']??[]};
   const relevant=new Set([...lookups,...Object.values(scopes).flat()]);
   const names={};
   for(const id of relevant){const item=tokens.get(id)??byClass.get(id);if(item)names[id]={name:item.name,group:item.group};}
   const font=options.fontId&&book.fonts.find(f=>f.id===options.fontId);
   if(options.fontId&&!font)fail('FONT_MISSING');
   return {revision:manifest.revision,items,total:matches.length,next:offset+40<matches.length?offset+40:null,scopes,direct,names,...(font?{notice:font.notice}:{}),...(main?{component:{id:main.id,name:main.name,editable:!page.draft||!!main.draft}}:{}),fonts:book.fonts.map(({id,label,embed,rights})=>({id,label,embed,rights}))};
  }
  let next={...manifest,styleBook:book},token=tokens.get(tokenId);
  if(action==='import-font'){
   const {font,bytes}=upload,name='fonts/'+font.faces[0].file;
   const existing=manifest.files.find(f=>f.name===name);
   if(existing&&(!existing.tokenFont||existing.sha256!==font.id.slice(7)))fail('CONFLICT');
   book.fonts=book.fonts.filter(f=>f.id!==font.id).concat(font);
   if(!existing)next.files=[...manifest.files,{...await store.siteFile(id,name,bytes,{draft:true,signal}),tokenFont:true}];
  }else if(action==='font-rights'){
   const font=book.fonts.find(f=>f.id===options.fontId);
   if(!font)fail('FONT_MISSING');
   const changed={...font,embed:options.embed,rights:options.rights,notice:options.notice??font.notice};
   if(!validStyleFont(changed)||hasPrivateText(changed.notice,options.blockedValues??[]))fail('INVALID');
   book.fonts=book.fonts.map(f=>f===font?changed:f);
  }else if(action==='create'||action==='update'){
   if(action==='create'&&tokenId!==undefined||action==='update'&&!token)fail('INVALID');
   const id=token?.id??randomUUID();
   const edited={id,classId:token?.classId??id,group:token?.group??group,name:typeof options.name==='string'?options.name.trim():null,rules:options.rules};
   if(!validToken(edited)||book.tokens.some(t=>t.id!==edited.id&&folded(t.name)===folded(edited.name)))fail('INVALID');
   for(const state of Object.values(edited.rules))if(customFontId(state['font-family'])&&!book.fonts.some(f=>f.id===state['font-family']))fail('FONT_MISSING');
   book.tokens=token?book.tokens.map(t=>t.id===token.id?edited:t):[...book.tokens,edited];token=edited;
  }else if(action==='remove'){
   if(!token)fail('NOT_FOUND');
   book.tokens=book.tokens.filter(t=>t.id!==token.id);book.site=book.site.filter(uid=>uid!==token.id);
   // A stored page design stops assigning the removed style to the pages it makes.
   if(manifest.pageDesigns)next.pageDesigns=manifest.pageDesigns.map(d=>d.template?.styleTokens.includes(token.id)?{...d,template:{...d.template,styleTokens:d.template.styleTokens.filter(uid=>uid!==token.id)}}:d);
   for(const table of [book.pages,book.folders])for(const [target,prior] of Object.entries(table)){
    const after=prior.filter(uid=>uid!==token.id);if(after.length)table[target]=after;else delete table[target];
   }
  }else{
   if(!Object.hasOwn(tokenGroups,group)||tokenId!==null&&!tokenID(tokenId)||tokenId!==null&&token?.group!==group)fail('INVALID');
   const folder=path.posix.dirname(address),assignment=prior=>[...prior.filter(uid=>tokens.get(uid)?.group!==group),...(tokenId?[tokenId]:[])];
   if(scope==='site')book.site=assignment(book.site);
   else if(scope==='page'||scope==='folder'){
    if(scope==='folder'&&folder==='.')fail('INVALID');
    const table=scope==='page'?book.pages:book.folders,key=scope==='page'?address:folder+'/';
    const active=assignment(table[key]??[]);if(active.length)table[key]=active;else delete table[key];
   }else if(scope==='element'||scope==='component'){
    const main=scope==='component'&&manifest.components?.find(c=>c.id===component);
    if(scope==='component'&&!main)fail('NOT_FOUND');
    const html=main?main.html:await store.readText(file,{signal}),node=selectOwner(html,!!main,blockPath);
    if(!node)fail('NOT_FOUND');
    const updated=assignedHTML(html,node,group,token?.classId??null,byClass);
    if(main)return componentOperation(store,'update',id,{expectedRevision,path:address,component:main.id,name:main.name,html:updated,signal});
    if(updated!==html){const changed={...file,...await store.siteFile(id,address,updated,{draft:file.draft,signal})};next.files=manifest.files.map(f=>f===file?changed:f);}
   }else fail('INVALID');
  }
  await store.assertSources(next);const result=await store.present(await store.commit(next,{signal}),address,{signal});
  return {...result,...(token?{modifiedStyleId:token.id}:{}),...(upload?{importedFontId:upload.font.id}:{})};
 },{write:action!=='list',signal});
}
