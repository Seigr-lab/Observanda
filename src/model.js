import {validDownloadInfo} from './web/website-file.js';
import {calendarDate,validRecordDate,recordDateIssue} from './web/record-date.js';
import {workflowIssues} from './web/record-workflow.js';
import {validAttempt} from './web/attempt-model.js';
import {validResults} from './web/result-statements.js';
import {validHierarchy} from './web/workspace-structure.js';
import {validConfiguration,validTemplate} from './web/notebook-schema.js';
import {fieldValueErrors} from './web/custom-fields.js';
import {customFieldLabel} from './web/custom-field-presentation.js';
import {validProse,proseReferences} from './web/prose-model.js';
import {validFigure} from './web/figure-model.js';
import {figureTargets} from './web/figure-composition.js';
import {upgradeRecord,validContributors,validRelations} from './web/record-model.js';
import {validPresentation,presentationDefaults} from './web/media-presentation.js';
import {validTypography,validPalette} from './web/website-typography.js';
import {layoutTargets} from './web/website-layouts.js';
import {emptyHomepage,websiteDefaults,validWebsiteComposition,siteLayoutDefaults,validSiteLayout,validSections,validMenuParents} from './web/website-model.js';
import { validIdentity } from './web/workspace-identity.js';
import {validLabBookTemplate} from './web/project-templates.js';
import {validWebsites,websiteBook} from './web/website-sites-model.js';
import {validProjectTools} from './web/project-tools.js';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { startingAppearance, validAppearance } from './web/themes.js';
import {validFont} from './web/font-catalogue.js';

import { brandingTargets } from './web/branding.js';
import { RECORD_TYPES, STATUSES } from './web/record-types.js';
import {bookSelectors} from './web/book-selectors.js';
export const TYPES = RECORD_TYPES.map(type => type.id);
import {MAX_BYTES,MAX_WORKSPACE_RECORDS} from './web/workspace-limits.js';
import {admitResearchBytes} from './research-capacity.js';
import {researchBytes} from './web/research-capacity.js';
export {MAX_BYTES,MAX_WORKSPACE_RECORDS};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).every(key => expected.includes(key)) && expected.every(key => Object.hasOwn(value, key));
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const id = value => typeof value === 'string' && uuid.test(value);

function checkRecords(book,records,unique,check){
  for (const e of records) {
    if (!keys(e, ['id', 'notebookId', 'type', 'title', 'body', ...(book.formatVersion>=21&&Object.hasOwn(e??{},'results')?['results']:[]), ...(book.formatVersion>=21&&Object.hasOwn(e??{},'attempt')?['attempt']:[]), ...(book.formatVersion>=19&&Object.hasOwn(e??{},'outcome')?['outcome']:[]), ...(book.formatVersion>=15&&Object.hasOwn(e??{},'template')?['template']:[]), ...(book.formatVersion>=13?['contributors','relations']:['author']), 'tags', 'occurredOn', 'createdAt', 'updatedAt', 'share', ...(book.formatVersion>=14?['figures']:['chart']), ...(book.formatVersion >= 2 ? ['status', 'sections', 'attachments'] : [])])) { check(false, 'entry', e?.id); continue; }
    if(Object.hasOwn(e,'attempt'))check(validAttempt(e.attempt),'attempt',e.id);
    if(Object.hasOwn(e,'results'))check(validResults(e.results),'analysis results',e.id);
    check(unique(e) && book.notebooks.some(n => n?.id === e.notebookId), 'notebook', e.id);
    check(TYPES.includes(e.type), 'type', e.id);
    if(Object.hasOwn(e,'outcome'))check(text(e.outcome,500), 'outcome', e.id);
    if(book.formatVersion<19)check(!(Array.isArray(e.relations)?e.relations:[]).some(l=>l?.role), 'workflow format', e.id);
    if(Object.hasOwn(e??{},'template')&&!validTemplate(e.template)){
      if(e.template&&validTemplate({...e.template,values:{}},{draft:true})){
        for(const label of fieldValueErrors(e.template.fields,e.template.values,{label:customFieldLabel}))check(false,label,e.id);
      }else check(false,'record fields',e.id);
    }
    check(text(e.title, 180, true), 'title', e.id);
    check(book.formatVersion>=14?validProse(e.body):text(e.body, 60000), 'body', e.id);
    if(book.formatVersion>=21&&validProse(e.body)&&Array.isArray(e.sections)&&e.sections.every(s=>s&&validProse(s.body))&&Array.isArray(e.figures)&&e.figures.every(f=>f&&typeof f==='object')&&Array.isArray(e.attachments)&&e.attachments.every(a=>a&&typeof a==='object')){const selectors=bookSelectors(e).map(s=>s.kind+':'+s.id);check(new Set(selectors).size===selectors.length,'duplicate book content identity',e.id);}
    if(book.formatVersion>=13){check(validContributors(e.contributors), 'contributors', e.id);check(validRelations(e.relations), 'research links', e.id);}else check(text(e.author, 160), 'author', e.id);
    check(Array.isArray(e.tags) && (book.formatVersion>=21||e.tags.length<=12) && e.tags.every(t => text(t, 40, true)), 'tags', e.id);
    check(book.formatVersion>=20?validRecordDate(e.occurredOn):calendarDate(e.occurredOn), recordDateIssue(e.occurredOn)||'occurredOn', e.id);
    check(date(e.createdAt) && date(e.updatedAt), 'dates', e.id);
    check(typeof e.share === 'boolean', 'share', e.id);
    if (book.formatVersion >= 2) {
      check(STATUSES.includes(e.status), 'status', e.id);
      check(book.formatVersion>=17||(e.type!=='run'&&!['failed','incomplete'].includes(e.status)&&!(Array.isArray(e.relations)?e.relations:[]).some(r=>r?.target?.revision)&&![e.body,...(Array.isArray(e.sections)?e.sections:[]).map(s=>s?.body)].some(value=>validProse(value)&&proseReferences(value).some(ref=>ref.revision))), 'revision-aware record format',e.id);
      check(Array.isArray(e.sections) && (book.formatVersion>=21 || e.sections.length <= 30) && e.sections.every(s => keys(s, ['id', 'title', 'body']) && unique(s) && text(s.title, 160, true) && (book.formatVersion>=14?validProse(s.body):text(s.body, 60000))), 'sections', e.id);
      const attachmentIds = new Set();
      check(Array.isArray(e.attachments) && (book.formatVersion>=21 || e.attachments.length <= 30) && e.attachments.every(a => {
        if (!keys(a, ['id', 'kind', 'caption', 'alt', 'transcript', 'share']) || !id(a.id) || attachmentIds.has(a.id)) return false;
        attachmentIds.add(a.id);
        return ['image', 'video', 'audio'].includes(a.kind) && text(a.caption, 1500) && text(a.alt, 1500) && text(a.transcript, 60000) && typeof a.share === 'boolean';
      }), 'attachments', e.id);
    }
    if(book.formatVersion>=14)check(Array.isArray(e.figures)&&e.figures.every(f=>validFigure(f))&&new Set(figureTargets(e.figures).map(f=>f.id)).size===figureTargets(e.figures).length, 'figures', e.id);
    else if (e.chart !== null) {
      const c = e.chart;
      check(keys(c, ['title', 'kind', 'xLabel', 'yLabel', 'points']) && text(c.title, 160, true) && ['line', 'bar'].includes(c.kind) && text(c.xLabel, 80) && text(c.yLabel, 80) && Array.isArray(c.points) && c.points.length >= 2 && c.points.length <= 80 && c.points.every(p => keys(p, ['label', 'value']) && text(p.label, 60, true) && typeof p.value === 'number' && Number.isFinite(p.value) && Math.abs(p.value) <= 1e12), 'chart', e.id);
    }
  }

}

// The catalogue supplies authenticated metadata and summaries of the other
// records. Reuse the same record checks without loading their prose or evidence.
// Review packets have detached records; references do not imply that their targets
// were shared. Validate the same record content contract without resolving links.
export function validateDetachedRecords(records){
 const issues=[],seen=new Set(),check=(valid,field)=>{if(!valid)issues.push({field});};
 const book={formatVersion:21,notebooks:[...new Set(records.map(r=>r.notebookId))].map(id=>({id}))};
 checkRecords(book,records,r=>{const ok=id(r.id)&&!seen.has(r.id);seen.add(r.id);return ok;},check);
 if(issues.length)throw new AppError('INVALID',issues.slice(0,30));
}
export function validateRecordChanges(book,records,summaries,{capacity=true}={}){
 for(const record of records)if(capacity)admitResearchBytes('record',researchBytes(record),{recordId:record.id});
 const changed=new Set(records.map(r=>r.id)),seen=new Set([book.id,...book.projects.map(v=>v.id),...book.notebooks.map(v=>v.id),...(book.pages??[]).map(v=>v.id),...(book.themes??[]).map(v=>v.id)]);
 for(const row of summaries)if(!changed.has(row.id)){seen.add(row.id);for(const section of row.sections)seen.add(section);}
 const issues=[],check=(valid,field,recordId)=>{if(!valid)issues.push({field,...(id(recordId)?{recordId}:{})});};
 const unique=record=>{const valid=id(record.id)&&!seen.has(record.id);seen.add(record.id);return valid;};
 checkRecords(book,records,unique,check);
 const unchanged=summaries.filter(r=>!changed.has(r.id)).map(r=>({id:r.id,type:r.type,relations:r.runOf.map(target=>({role:'run-of',target}))}));
 const localReference=target=>target.workspaceId===book.id||summaries.some(row=>row.id===target.id&&row.referenceNamespaces?.includes(target.workspaceId));
 issues.push(...workflowIssues({...book,entries:[...unchanged,...records]},{localReference}));
 if(issues.length)throw new AppError('INVALID',issues.slice(0,30));
}

export function validateNotebook(book) {return validateBook(book);}

// Only the catalogue supplies these authenticated identities. Public document
// validation remains complete and never accepts an omitted record collection.
export function validateCatalogueMetadata(book,{reservedIds=[],entryTargets=[],websiteContexts}={}){
 if(book?.formatVersion!==21||!Array.isArray(book.entries)||book.entries.length)throw new AppError('FORMAT');
 admitResearchBytes('metadata',researchBytes(book));
 return validateBook(book,{reservedIds,entryTargets,websiteContexts});
}
function validateBook(book,{reservedIds=[],entryTargets=[],websiteContexts}={}) {
  if(Object.hasOwn(book??{},'websites')){
    if(book.formatVersion!==21||!validWebsites(book.websites,book))throw new AppError('INVALID');
    for(const site of book.websites)validateBook(websiteBook(book,site),websiteContexts?.get(site.id)??{reservedIds,entryTargets});
    const {websites,...source}=book;return validateBook(source,{reservedIds,entryTargets});
  }
  const issues = [];
  const check = (valid, field, recordId) => { if (!valid) issues.push({ field, ...(id(recordId) ? { recordId } : {}) }); };
  if (!keys(book, ['formatVersion', 'id', 'revision', 'title', 'description', 'createdAt', 'updatedAt', 'appearance', 'projects', 'notebooks', 'entries', ...(book?.formatVersion >= 2 ? ['website', 'pages', ...(book.formatVersion >= 3 ? ['branding'] : []), ...(book.formatVersion >= 4 ? ['themes', 'activeThemeId'] : []), ...(book.formatVersion >= 5 ? ['identity'] : [])] : [])]) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].includes(book.formatVersion)) throw new AppError('FORMAT');
  if(book.formatVersion>=2&&(!book.website||typeof book.website!=='object'||Array.isArray(book.website)||!Array.isArray(book.pages))||
    book.formatVersion>=3&&!Array.isArray(book.branding)||book.formatVersion>=4&&!Array.isArray(book.themes))throw new AppError('INVALID');
  check(id(book.id), 'id');
  if (book.formatVersion >= 5) check(validIdentity(book.identity), 'identity');
  check(Number.isSafeInteger(book.revision) && book.revision >= 0, 'revision');
  check(text(book.title, 160, true), 'title');
  check(text(book.description, 1500), 'description');
  check(date(book.createdAt) && date(book.updatedAt), 'dates');
  const a = book.appearance;
  check(book.formatVersion >= 4 ? validAppearance(a) : keys(a, ['theme', 'accent', 'font', 'width', 'density', ...(book.formatVersion >= 2 ? ['headingFont', 'background', 'surface', 'text'] : [])]) && ['research', 'studio'].includes(a.theme) && /^#[0-9a-f]{6}$/i.test(a.accent) && ['editorial', 'modern', 'atkinson', 'source-serif', 'space-grotesk'].includes(a.font) && Number.isInteger(a.width) && a.width >= 640 && a.width <= 1100 && ['comfortable', 'compact'].includes(a.density), 'appearance');
  if (!Array.isArray(book.projects) || !Array.isArray(book.notebooks) || !Array.isArray(book.entries) || book.formatVersion < 21 && (book.projects.length > 100 || book.notebooks.length > 500) || book.entries.length > MAX_WORKSPACE_RECORDS) throw new AppError('LIMIT');
  const allIds = new Set([book.id,...reservedIds]);
  const unique = record => { const valid = id(record.id) && !allIds.has(record.id); allIds.add(record.id); return valid; };
  for (const p of book.projects) check(keys(p, book.formatVersion === 1 ? ['id', 'title', 'description'] : ['id', 'title', 'description', 'share', 'logoId',...(book.formatVersion>=15?['parentId','kind'].filter(k=>Object.hasOwn(p??{},k)):[]),...(book.formatVersion>=16&&Object.hasOwn(p??{},'tools')?['tools']:[]),...(book.formatVersion>=21&&Object.hasOwn(p??{},'labBookTemplate')?['labBookTemplate']:[])]) && (book.formatVersion === 1 || (typeof p.share === 'boolean' && (p.logoId === null || id(p.logoId)))) && unique(p) && text(p.title, 160, true) && text(p.description, 1500), 'project', p?.id);
  check(validHierarchy(book.projects), 'structure hierarchy');
  for(const p of book.projects){if(Object.hasOwn(p??{},'labBookTemplate'))check(validLabBookTemplate(p.labBookTemplate),'project lab-book template',p.id);if(Object.hasOwn(p??{},'tools'))check(validProjectTools(p.tools),'project tools',p.id);if(Object.hasOwn(p??{},'parentId'))check(p.parentId===null||id(p.parentId),'parent',p.id);if(Object.hasOwn(p??{},'kind'))check(text(p.kind,80,true),'kind',p.id);}
  for (const n of book.notebooks) check(keys(n, ['id', 'projectId', 'title',...(book.formatVersion>=15&&Object.hasOwn(n??{},'configuration')?['configuration']:[])]) && unique(n) && book.projects.some(p => p?.id === n.projectId) && text(n.title, 160, true), 'notebook', n?.id);
  for(const n of book.notebooks)if(Object.hasOwn(n??{},'configuration'))check(validConfiguration(n.configuration),'notebook configuration',n.id);
  checkRecords(book,book.entries,unique,check);
  if (book.formatVersion >= 2) {
    check(validFont(a?.headingFont) && ['background', 'surface', 'text'].every(key => /^#[0-9a-f]{6}$/i.test(a?.[key])), 'appearance');
    const site = book.website;
    check(keys(site, ['logoId', 'logoAlt', 'footer', 'navigation', ...(book.formatVersion >= 6 ? ['title','description','home'] : []), ...(book.formatVersion >= 7 ? ['design','assets'] : []), ...(book.formatVersion >= 8 ? ['layouts','templates'] : []), ...(book.formatVersion >= 10 ? ['typography'] : []), ...(book.formatVersion >= 11 ? ['presentation','palette'] : [])]) && (site.logoId === null || id(site.logoId)) && text(site.logoAlt, 160) && text(site.footer, 1500) && Array.isArray(site.navigation) && site.navigation.length <= 200 && site.navigation.every(item => keys(item, ['target', 'label', 'show', ...(book.formatVersion>=7&&item&&Object.hasOwn(item,'parent')?['parent']:[])]) && text(item.target, 100, true) && text(item.label, 160) && typeof item.show === 'boolean') && new Set(site.navigation.map(item => item.target)).size === site.navigation.length, 'website');
    if (book.formatVersion >= 11) {check(validPresentation(site.presentation), 'media presentation');check(validPalette(site.palette), 'website colors');}
    if (book.formatVersion >= 10) check(validTypography(site.typography), 'website typography');
    if (book.formatVersion >= 6) check(validWebsiteComposition(site,book.formatVersion>=7,book.formatVersion>=8,book.formatVersion>=9,book.formatVersion>=10,book.formatVersion>=12,book.formatVersion>=18), 'website composition');
    if (book.formatVersion >= 7) {
      check(Array.isArray(site.navigation)&&validMenuParents(site.navigation), 'menu hierarchy');
      check(validSiteLayout(site.design), 'website layout');
      check(Array.isArray(site.assets)&&site.assets.length<=500&&new Set(site.assets.map(a=>a?.id)).size===site.assets.length&&site.assets.every(a=>keys(a,['id','kind','caption','alt','transcript',...(a.kind==='file'?['name','size','sha256']:[])])&&id(a.id)&&['image','audio','video','file'].includes(a.kind)&&(a.kind!=='file'||validDownloadInfo(a))&&text(a.caption,1500)&&text(a.alt,1500)&&text(a.transcript,60000)), 'website assets');
    }
    check(Array.isArray(book.pages) && book.pages.length <= 50 && book.pages.every(p => keys(p, ['id', 'title', 'body', 'share', ...(book.formatVersion>=7&&p&&Object.hasOwn(p??{},'sections')?['sections']:[])]) && (!Object.hasOwn(p??{},'sections')||validSections(p.sections,true,book.formatVersion>=8,book.formatVersion>=9,book.formatVersion>=10,book.formatVersion>=12)) && unique(p) && text(p.title, 160, true) && text(p.body, 60000) && typeof p.share === 'boolean'), 'pages');
    if (book.formatVersion >= 8) {
      const targets=new Set(issues.length?[]:[...layoutTargets(book).map(t=>t.target),...entryTargets]);
      check(Array.isArray(site.layouts)&&site.layouts.length<=1700&&new Set(site.layouts.map(l=>l?.target)).size===site.layouts.length&&site.layouts.every(l=>keys(l,['target','showHeading','heading','description','placement','sections'])&&targets.has(l.target)&&typeof l.showHeading==='boolean'&&text(l.heading,180)&&text(l.description,1500)&&['before','after','replace'].includes(l.placement)&&(!l.target.startsWith('entry:')||l.placement!=='replace')&&validSections(l.sections,true,true,book.formatVersion>=9,book.formatVersion>=10,book.formatVersion>=12)), 'page layouts');
      check(Array.isArray(site.templates)&&site.templates.length<=100&&site.templates.every(t=>keys(t,['id','name','sections'])&&id(t.id)&&text(t.name,80,true)&&validSections(t.sections,true,true,book.formatVersion>=9,book.formatVersion>=10,book.formatVersion>=12))&&new Set(site.templates.map(t=>t.id)).size===site.templates.length, 'page templates');
    }
    if (!issues.length) {
      const targets = new Set(['home', ...book.projects.map(p => 'project:' + p.id), ...book.notebooks.map(n => 'notebook:' + n.id), ...book.pages.map(p => 'page:' + p.id)]);
      check(site.navigation.every(item => targets.has(item.target)), 'navigation');
    }
  }
  if (book.formatVersion >= 3) {
    const targets = new Set(issues.length ? [] : [...brandingTargets(book).map(item => item.target),...entryTargets]);
    check(Array.isArray(book.branding) && book.branding.length <= 1700 && book.branding.every(item => keys(item, ['target', 'logos']) && targets.has(item.target) && Array.isArray(item.logos) && item.logos.length <= 4 && item.logos.every(logo => keys(logo, ['id', 'alt']) && id(logo.id) && text(logo.alt, 160))) && new Set(book.branding.map(item => item.target)).size === book.branding.length, 'branding');
  }
  if (book.formatVersion >= 4) {
    check(Array.isArray(book.themes) && book.themes.length <= 50 && book.themes.every(preset => keys(preset, ['id', 'name', 'appearance']) && unique(preset) && text(preset.name, 80, true) && validAppearance(preset.appearance)), 'themes');
    check(book.activeThemeId === null || (id(book.activeThemeId) && Array.isArray(book.themes) && book.themes.some(preset => preset?.id === book.activeThemeId)), 'activeThemeId');
  }
  if(!issues.length&&book.formatVersion>=19)issues.push(...workflowIssues(book));
  if (issues.length) throw new AppError('INVALID', issues.slice(0, 30));
  if (Buffer.byteLength(JSON.stringify(book, null, 2) + '\n') > MAX_BYTES) throw new AppError('LIMIT');
  return book;
}

export function createNotebook(title = 'My field notes', description = '', theme = 'research') {
  if (!['research', 'studio'].includes(theme)) throw new AppError('INVALID');
  const now = new Date().toISOString();
  return validateNotebook({
    formatVersion: 21, identity: {kind:'personal',label:''}, branding: [], themes: [], activeThemeId: null, id: randomUUID(), revision: 0, title, description, createdAt: now, updatedAt: now,
    appearance: startingAppearance(theme),
    website: { ...websiteDefaults(), home:emptyHomepage(), design:siteLayoutDefaults(), assets:[], layouts:[], templates:[], typography:{}, presentation:presentationDefaults(), palette:{}, logoId: null, logoAlt: '', footer: '', navigation: [] }, pages: [],
    projects: [], notebooks: [], entries: []
  });
}


export function upgradeNotebook(source) {
  validateNotebook(source);
  const book = structuredClone(source);
  if (book.formatVersion === 1) {
    book.formatVersion = 2;
    Object.assign(book.appearance, { headingFont: book.appearance.font, background: '#faf9f5', surface: '#fffdfa', text: '#25382e' });
    book.website = { logoId: null, logoAlt: '', footer: 'A record of questions, observations, and discoveries.', navigation: [] };
    book.pages = [];
    for (const project of book.projects) {
      const notebooks = new Set(book.notebooks.filter(n => n.projectId === project.id).map(n => n.id));
      project.logoId = null;
      project.share = book.entries.some(e => notebooks.has(e.notebookId) && e.share);
    }
    for (const entry of book.entries) Object.assign(entry, { status: 'draft', sections: [], attachments: [] });
  }
  if (book.formatVersion === 2) { book.formatVersion = 3; book.branding = []; }
  if (book.formatVersion === 3) {
    book.formatVersion = 4;
    book.themes = []; book.activeThemeId = null;
    // Preserve existing palette/type choices; only add previously unavailable controls.
    Object.assign(book.appearance, { muted: book.appearance.text, border: '#cbd5df', fontSize: 18, lineHeight: 1.8, radius: book.appearance.theme === 'studio' ? 4 : 8, layout: 'grid', header: 'plain' });
  }
  if (book.formatVersion === 4) { book.formatVersion = 5; book.identity = {kind:'workspace',label:''}; }
  if (book.formatVersion === 5) { book.formatVersion = 6; Object.assign(book.website, websiteDefaults()); }
  if (book.formatVersion === 6) { book.formatVersion = 7; book.website.design=siteLayoutDefaults();book.website.assets=[]; }
  if (book.formatVersion === 7) { book.formatVersion = 8; book.website.layouts=[]; book.website.templates=[]; }
  if(book.formatVersion===8)book.formatVersion=9;
  if(book.formatVersion===9){book.formatVersion=10;book.website.typography={};}
  if(book.formatVersion===10){book.formatVersion=11;book.website.presentation=presentationDefaults();book.website.palette={};}
  if(book.formatVersion===11)book.formatVersion=12;
  if(book.formatVersion===12){book.formatVersion=13;book.entries=book.entries.map(upgradeRecord);}
  if(book.formatVersion===13){book.formatVersion=14;book.entries=book.entries.map(upgradeRecord);}
  if(book.formatVersion===14)book.formatVersion=15;
  if(book.formatVersion===15)book.formatVersion=16;
  if(book.formatVersion===16)book.formatVersion=17;
  // Existing editions retain their homepage; new workspaces explicitly opt in.
  if(book.formatVersion===17)book.formatVersion=18;
  // Optional outcomes and workflow roles leave every existing record byte-identical.
  if(book.formatVersion===18)book.formatVersion=19;
  // Broader date choices do not rewrite existing records or pinned revisions.
  if(book.formatVersion===19)book.formatVersion=20;
  if(book.formatVersion===20)book.formatVersion=21;
  return validateNotebook(book);
}
