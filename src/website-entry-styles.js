import {createHash} from 'node:crypto';
import path from 'node:path';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants} from './website-migration-views.js';
import {displayId,displayMode} from './website-entry-display.js';
import {menuCSS,hasEditorMenu} from './website-menu-styles.js';

// A standalone publication page has a record-specific footer alignment.
// The retained article has no such footer. Keep every rule when a template
// actually contains that class, or when the sheet is not in the generated form.
export function retainedArticleCSS(css,recordId,html){
 if(!recordId||html.includes('site-footer')||!css.includes('@scope ([data-observanda-source])'))return css;
 const rule=/\n\[data-page="entry:([0-9a-f-]{36})"\] \.site-footer\{--footer-text-align:(?:start|center|end|left|right|justify)\}\n\}$/u.exec(css);
 return rule&&rule[1]===recordId?css.slice(0,rule.index)+'\n}':css;
}

// Zero-specificity defaults leave the site's typography, theme and authored
// selectors in control. The same file is used by the editor and static pages.
export const entryCSS=`:where(.website-entry-card,.website-entry-section){box-sizing:border-box;max-inline-size:100%;overflow-wrap:anywhere;margin-block:var(--card-gap,1rem);color:inherit}
:where(.website-entry-card){padding:var(--card-padding,1.25rem);border:1px solid var(--page-border,currentColor);border-inline-start:.3rem solid var(--accent,currentColor);border-radius:var(--corner-radius,.45rem);background:var(--page-surface,transparent)}
:where(.website-entry-card>h2,.website-entry-card>h3){margin-block:0 .5em;line-height:1.25}
:where(.website-entry-card>p){margin-block:.5em 0}
:where(.website-entry-section){padding-block:.35rem}
:where(.website-entry-section>h2){margin-block:0 .55em}
:where(.website-entry-section img,.website-entry-section video){max-inline-size:100%;height:auto}
@media print{:where(.website-entry-card){break-inside:avoid}}
`+menuCSS;
export const entryStyleHash=createHash('sha256').update(entryCSS).digest('hex');
export const entryStyleName='website-display-'+entryStyleHash.slice(0,20)+'.css';
const marker='data-website-entry-stylesheet';
export const usesEntryStyle=page=>Boolean(page?.placements.some(row=>row.display));
export function styledPageHTML(html,page){
 if(!html.includes(displayId)&&!html.includes(marker)&&!html.includes('data-website-menu'))return {html,used:false,menu:false};
 const nodes=[...descendants(parse(html,{sourceCodeLocationInfo:true}))];
 const menu=hasEditorMenu(nodes),used=menu||nodes.some(n=>n.tagName==='section'&&attr(n,displayId)!==undefined&&['card','section'].includes(attr(n,displayMode)));
 const links=nodes.filter(n=>n.tagName==='link'&&attr(n,marker)!==undefined);
 const href=path.posix.relative(path.posix.dirname(page),entryStyleName);
 if(used&&links.length===1&&links[0].parentNode?.tagName==='head'&&attr(links[0],'href')===href&&attr(links[0],'rel')==='stylesheet'&&links[0].attrs.length===3)return {html,used,menu};
 const head=nodes.find(n=>n.tagName==='head'),at=head?.sourceCodeLocation?.startTag?.endOffset??nodes.find(n=>n.tagName==='html')?.sourceCodeLocation?.startTag?.endOffset??nodes.find(n=>n.nodeName==='#documentType')?.sourceCodeLocation?.endOffset??0;
 const changes=links.map(n=>({start:n.sourceCodeLocation.startOffset,end:n.sourceCodeLocation.endOffset,text:''}));
 if(used)changes.push({start:at,end:at,text:'<link rel="stylesheet" href="'+href+'" '+marker+'="">'});
 for(const {start,end,text} of changes.sort((a,b)=>b.start-a.start))html=html.slice(0,start)+text+html.slice(end);
 return {html,used,menu};
}
export async function syncEntryStyles(store,manifest,signal){
 const files=new Map(manifest.files.map(f=>[f.name,f]));
 const pages=manifest.pages.filter(p=>usesEntryStyle(p)||files.get(p.path)?.editorMenu),managed=manifest.files.filter(f=>f.entryDisplaySheet);
 if(!pages.length&&!managed.length)return manifest;
 const draft=pages.every(p=>p.draft);
 const collision=files.get(entryStyleName);
 if(pages.length&&collision&&!collision.entryDisplaySheet)throw new AppError('CONFLICT');
 for(const sheet of managed)files.delete(sheet.name);
 if(pages.length){
  const sheet=collision?.sha256===entryStyleHash&&Boolean(collision.draft)===draft?collision:await store.siteFile(manifest.id,entryStyleName,entryCSS,{draft,signal});
  files.set(entryStyleName,{...sheet,entryDisplaySheet:true});
 }
 for(const page of pages){
  const file=files.get(page.path);if(file?.entryStyle===entryStyleHash)continue;
  if(!file)throw new AppError('FORMAT');
  files.set(page.path,await store.siteFile(manifest.id,page.path,await store.readText(file,{signal}),{draft:page.draft,signal}));
 }
 return {...manifest,files:[...files.values()]};
}
