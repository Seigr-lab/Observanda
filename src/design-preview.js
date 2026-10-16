import {websiteDefaults} from './web/website-model.js';
import {upgradeRecord} from './web/record-model.js';
import { readFile } from 'node:fs/promises';
import {posix} from 'node:path';
import { createNotebook, validateNotebook } from './model.js';
import { buildPublication } from './publication.js';
import { assertPublicFiles } from './privacy.js';
import { digest, serialize } from './storage.js';
import {recordRevision} from './research.js';
import {defaultEditionRecord} from './web/publication-selection.js';
import {publicationText} from './web/publication-messages.js';

// All assets and measurements here are synthetic design specimens. The bundled
// image/logo are drawn grids/circles; audio is a quiet tone; video fades the grid.
// This module never reads or writes user records or fetches remote media.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const assets = new Map(await Promise.all([['image','png'],['logo','png'],['audio','wav'],['video','mp4']].map(async ([name,ext],i)=>[id(100+i),{kind:name==='logo'?'image':name,extension:ext,bytes:await readFile(new URL(`./preview-assets/${name}.${ext}`,import.meta.url))}])));
export const EXAMPLE_GALLERY = `pages/${id(60)}.html`;

export function designExampleBook(appearance) {
  const book=createNotebook('Example research collective','An example collective: science, fieldwork and creative investigation.');
  book.website.home=websiteDefaults().home;
  book.id=id(1);book.createdAt=book.updatedAt='2026-01-01T00:00:00.000Z';book.appearance=structuredClone(appearance);
  book.projects=[{id:id(2),title:'Field observations',description:'Example project cards demonstrate titles, introductory text, spacing and surfaces.',share:true,logoId:null},{id:id(3),title:'Materials & sound',description:'A second example project shows how independent research has a place in the same workspace.',share:true,logoId:null}];
  book.notebooks=[{id:id(4),projectId:id(2),title:'Field journal'},{id:id(5),projectId:id(3),title:'Studio notebook'}];
  const entry={author:'Example researcher',occurredOn:'2026-01-01',createdAt:book.createdAt,updatedAt:book.updatedAt,share:true,chart:null,status:'draft',sections:[],attachments:[]};
  book.entries=[{...entry,id:id(10),notebookId:id(4),type:'experiment',title:'An example experiment',body:'This is fictional sample content for exploring the design. It is never added to your records.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Compare a longer paragraph with short notes, metadata, captions and tabular values.',tags:['example','fieldwork','method'],status:'completed',
    sections:[{id:id(20),title:'Method and materials',body:'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.\n\nUse this section to judge heading hierarchy, line length and paragraph spacing.'},{id:id(21),title:'Observations and interpretation',body:'A brief observation.\n\nA second paragraph gives the reading layout enough content to evaluate. All values and media on this page are illustrative.'}],
    chart:{title:'Illustrative measurement series',kind:'line',xLabel:'Example sample',yLabel:'Illustrative value (a.u.)',points:[{label:'A',value:2},{label:'B',value:7},{label:'C',value:5},{label:'D',value:10}]},
    attachments:[{id:id(100),kind:'image',caption:'Example image and caption. A synthetic grid, not experimental evidence.',alt:'A circle over a rectangular grid.',transcript:'',share:true},{id:id(102),kind:'audio',caption:'Example audio player. A quiet one-second tone; nothing plays automatically.',alt:'Synthetic audio example',transcript:'A short, steady tone fades in and out. No speech.',share:true},{id:id(103),kind:'video',caption:'Example video player. A two-second synthetic grid fades in and out.',alt:'Synthetic video example',transcript:'A stationary circle and grid gradually appear and disappear.',share:true}]},
    {...entry,id:id(11),notebookId:id(4),type:'observation',title:'A short field observation',body:'Short records sit alongside longer experiments. This card demonstrates an observation title and a compact summary.',tags:['example','observation']},
    {...entry,id:id(12),notebookId:id(5),type:'note',title:'An open page for an idea',body:'Not every question starts with a protocol. This example note shows free-form content within a second project.',tags:['example','idea'],chart:{title:'Illustrative comparison',kind:'bar',xLabel:'Example condition',yLabel:'Illustrative value (a.u.)',points:[{label:'One',value:3},{label:'Two',value:8},{label:'Three',value:5}]}}
  ];
  book.website={...book.website,logoId:id(101),logoAlt:'Example collective logo',footer:'Design examples only. Your real publication contains only the content you select.',navigation:[{target:'home',label:'Home',show:true},{target:'project:'+id(2),label:'Fieldwork',show:true},{target:'project:'+id(3),label:'Studio',show:true},{target:'page:'+id(61),label:'About',show:true},{target:'page:'+id(60),label:'Component gallery',show:true}]};
  book.pages=[{id:id(60),title:'Component gallery',body:'Design gallery',share:true},{id:id(61),title:'About this example lab book',body:'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nA custom page can introduce the people, ideas and methods behind a collection of projects.',share:true}];
  book.entries=book.entries.map(upgradeRecord);
  return validateNotebook(book);
}

export function buildDesignExamples(appearance, {blockedValues=[],fontFiles=new Map()}={}) {
  const book=designExampleBook(appearance),edition={version:1,records:book.entries.map(record=>{const choice=defaultEditionRecord(record,recordRevision(record));choice.figures.forEach(f=>f.data=true);return choice;})};
  const candidate=buildPublication(book,{blockedValues,fontFiles,mediaFiles:assets,edition});
  const main = html => /<main id="content" class="page-content">([\s\S]*?)<\/main>/.exec(html)[1];
  const relocate=(html,from)=>html.replace(/(href|src)="([^"]+)"/g,(match,attribute,url)=>{
    if(/^(?:#|[a-z][a-z0-9+.-]*:|\/)/i.test(url))return match;
    const [,file,suffix]=/^([^?#]*)(.*)$/.exec(url);return `${attribute}="${posix.relative('pages',posix.join(from,file))}${suffix}"`;
  });
  const home=relocate(main(candidate.files.get('index.html')),'');
  const record=relocate(main(candidate.files.get(`entries/${id(10)}.html`)),'entries').replace('<details><summary>'+publicationText('viewData'),'<details open><summary>'+publicationText('viewData'));
  const comparison=main(candidate.files.get(`entries/${id(12)}.html`)).match(/<figure\b[^>]*>[\s\S]*?<\/figure>/)[0];
  const recordHeader=candidate.files.get(`entries/${id(10)}.html`).match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
  const gallery=`<div class="specimen-index"><a href="#specimen-cards">Projects &amp; cards</a><a href="#specimen-type">Header, typography &amp; records</a><a href="#specimen-figures">Comparison figure</a></div><section id="specimen-cards">${home}</section><section id="specimen-type">${recordHeader}${record}</section><section id="specimen-figures" class="record-page"><h2>Comparison figure</h2>${comparison}</section>`;
  candidate.files.set(EXAMPLE_GALLERY,candidate.files.get(EXAMPLE_GALLERY).replace(/<header class="site-header">[\s\S]*?<\/header>/,'').replace(/<main id="content" class="page-content">[\s\S]*?<\/main>/,`<main id="content" class="page-content">${gallery}</main>`));
  for(const [name,html] of candidate.files)if(name.endsWith('.html'))candidate.files.set(name,html.replace(/(<body[^>]*>)/,'$1<div class="specimen-banner">Design examples / fictional content / never saved to your lab book or included in exports</div>'));
  candidate.files.set('styles.css',candidate.files.get('styles.css')+'\n.specimen-banner{padding:10px 20px;text-align:center;background:var(--page-surface);color:var(--page-muted);border-bottom:1px solid var(--page-border);font-size:12px}.specimen-index{display:flex;flex-wrap:wrap;gap:12px 24px;margin-bottom:20px;font-size:14px}.specimen-note{color:var(--page-muted);font-size:14px;margin-bottom:28px}#specimen-cards>section{margin:24px 0}#specimen-type>.site-header{margin-bottom:24px}.page-content:has(>.specimen-index){padding-top:24px}#specimen-type,#specimen-figures{margin-top:40px}');
  // Seal the complete specimen using the normal manifest/integrity contract. The
  // server registers it ONLY in the design cache, never as a releasable candidate.
  const manifest=JSON.parse(candidate.files.get('publication.json'));
  candidate.files.delete('publication.json');
  const files=[...candidate.files].map(([name,content])=>({path:name,bytes:Buffer.byteLength(content),sha256:digest(content)}));
  candidate.id=digest(JSON.stringify({generator:manifest.generator,files}));
  candidate.files.set('publication.json',serialize({...manifest,releaseId:candidate.id,files}));
  assertPublicFiles(candidate.files,blockedValues);
  return {candidate,defaultPage:EXAMPLE_GALLERY};
}
