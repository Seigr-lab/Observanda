import {validMediaMetadata,validMediaCaptions} from './web/record-media-value.js';
import {validTemplateLink} from './web/website-template-inheritance.js';
import {validPublicationPrivacy} from './web/record-publication-privacy.js';
import {isConfigurationReference,validConfigurationReference} from './web/configuration-reference.js';
import {publicationPresentationTarget} from './web/publication-presentation-target.js';
import {validWebsitePage,validWebsiteNavigationItem,validWebsiteAsset,validWebsiteLayout,validWebsiteBranding} from './web/website-item-validation.js';
import {validRecordDate,recordDateIssue} from './web/record-date.js';
import {workflowIssues} from './web/record-workflow.js';
import {validAttempt} from './web/attempt-model.js';
import {validResults} from './web/result-statements.js';
import {validHierarchy} from './web/workspace-structure.js';
import {validConfiguration,validTemplate} from './web/notebook-schema.js';
import {fieldValueErrors} from './web/custom-fields.js';
import {customFieldLabel} from './web/custom-field-presentation.js';
import {validProse} from './web/prose-model.js';
import {validFigure} from './web/figure-model.js';
import {figureTargets} from './web/figure-composition.js';
import {validContributors,validRelations} from './web/record-model.js';
import {validPresentation} from './web/media-presentation.js';
import {validTypography,validPalette} from './web/website-typography.js';
import {layoutTargets} from './web/website-layouts.js';
import {validWebsiteComposition,validSiteLayout,validSections,validMenuParents} from './web/website-model.js';
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
    if (!keys(e, ['id', 'notebookId', 'type', 'title', 'body', ...['sharePdf','publication','results','attempt','outcome','template'].filter(key=>Object.hasOwn(e??{},key)), 'contributors', 'relations', 'tags', 'occurredOn', 'createdAt', 'updatedAt', 'share', 'figures', 'status', 'sections', 'attachments'])) { check(false, 'entry', e?.id); continue; }
    if(Object.hasOwn(e,'sharePdf'))check(typeof e.sharePdf==='boolean','PDF availability',e.id);
    if(Object.hasOwn(e,'publication'))check(validPublicationPrivacy(e.publication),'publication privacy',e.id);
    if(Object.hasOwn(e,'attempt'))check(validAttempt(e.attempt),'attempt',e.id);
    if(Object.hasOwn(e,'results'))check(validResults(e.results),'analysis results',e.id);
    check(unique(e) && book.notebooks.some(n => n?.id === e.notebookId), 'notebook', e.id);
    check(TYPES.includes(e.type), 'type', e.id);
    if(Object.hasOwn(e,'outcome'))check(text(e.outcome,500), 'outcome', e.id);
    if(Object.hasOwn(e??{},'template')&&!validTemplate(e.template)){
      if(e.template&&validTemplate({...e.template,values:{}},{draft:true})){
        for(const label of fieldValueErrors(e.template.fields,e.template.values,{label:customFieldLabel}))check(false,label,e.id);
      }else check(false,'record fields',e.id);
    }
    check(text(e.title, 180, true), 'title', e.id);
    check(validProse(e.body), 'body', e.id);
    if(validProse(e.body)&&Array.isArray(e.sections)&&e.sections.every(s=>s&&validProse(s.body))&&Array.isArray(e.figures)&&e.figures.every(f=>f&&typeof f==='object')&&Array.isArray(e.attachments)&&e.attachments.every(a=>a&&typeof a==='object')){const selectors=bookSelectors(e).map(s=>s.kind+':'+s.id);check(new Set(selectors).size===selectors.length,'duplicate book content identity',e.id);}
    check(validContributors(e.contributors), 'contributors', e.id);
    check(validRelations(e.relations), 'research links', e.id);
    check(Array.isArray(e.tags) && e.tags.every(t => text(t, 40, true)), 'tags', e.id);
    check(validRecordDate(e.occurredOn), recordDateIssue(e.occurredOn)||'occurredOn', e.id);
    check(date(e.createdAt) && date(e.updatedAt), 'dates', e.id);
    check(typeof e.share === 'boolean', 'share', e.id);
    check(STATUSES.includes(e.status), 'status', e.id);
    check(Array.isArray(e.sections) && e.sections.every(s => keys(s, ['id', 'title', 'body',...['share','sharePdf'].filter(key=>Object.hasOwn(s??{},key))]) && ['share','sharePdf'].every(key=>!Object.hasOwn(s,key)||typeof s[key]==='boolean') && unique(s) && text(s.title, 160, true) && validProse(s.body)), 'sections', e.id);
    const attachmentIds = new Set();
    check(Array.isArray(e.attachments) && e.attachments.every(a => {
      if (!keys(a, ['id', 'kind', 'caption', 'alt', 'transcript', 'share',...['sharePdf','metadata','captions'].filter(key=>Object.hasOwn(a??{},key))]) || !id(a.id) || attachmentIds.has(a.id)) return false;
      attachmentIds.add(a.id);
      return ['image', 'video', 'audio'].includes(a.kind) && text(a.caption, 1500) && text(a.alt, 1500) && text(a.transcript, 60000) && typeof a.share === 'boolean'&&(!Object.hasOwn(a,'sharePdf')||typeof a.sharePdf==='boolean')&&(!Object.hasOwn(a,'metadata')||validMediaMetadata(a.metadata))&&(!Object.hasOwn(a,'captions')||a.kind==='video'&&validMediaCaptions(a.captions));
    }), 'attachments', e.id);
    check(Array.isArray(e.figures)&&e.figures.every(f=>validFigure(f))&&new Set(figureTargets(e.figures).map(f=>f.id)).size===figureTargets(e.figures).length, 'figures', e.id);
  }

}

// The catalogue supplies authenticated metadata and summaries of the other
// records. Reuse the same record checks without loading their prose or evidence.
// Review packets have detached records; references do not imply that their targets
// were shared. Validate the same record content contract without resolving links.
export function validateDetachedRecords(records){
 const issues=[],seen=new Set(),check=(valid,field)=>{if(!valid)issues.push({field});};
 const book={notebooks:[...new Set(records.map(r=>r.notebookId))].map(id=>({id}))};
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
 if(![21,22].includes(book?.formatVersion)||!Array.isArray(book.entries)||book.entries.length)throw new AppError('FORMAT');
 admitResearchBytes('metadata',researchBytes(book));
 return validateBook(book,{reservedIds,entryTargets,websiteContexts,configurationReferences:true});
}
function validateBook(book,{reservedIds=[],entryTargets=[],websiteContexts,configurationReferences=false}={}) {
  if(Object.hasOwn(book??{},'websites')){
    if(book.formatVersion!==21||!validWebsites(book.websites,book))throw new AppError('INVALID');
    for(const site of book.websites)validateBook(websiteBook(book,site),{...(websiteContexts?.get(site.id)??{reservedIds,entryTargets}),configurationReferences});
    const {websites,...source}=book;return validateBook(source,{reservedIds,entryTargets,configurationReferences});
  }
  const issues = [];
  const check = (valid, field, recordId) => { if (!valid) issues.push({ field, ...(id(recordId) ? { recordId } : {}) }); };
  if (!keys(book, ['formatVersion', 'id', 'revision', 'title', 'description', 'createdAt', 'updatedAt', 'appearance', 'projects', 'notebooks', 'entries', ...(book?.formatVersion === 21 ? ['website', 'pages', 'branding'] : []), 'themes', 'activeThemeId', 'identity']) || ![21, 22].includes(book.formatVersion)) throw new AppError('FORMAT');
  if(book.formatVersion===21&&(!book.website||typeof book.website!=='object'||Array.isArray(book.website)||!Array.isArray(book.pages)||!Array.isArray(book.branding))||!Array.isArray(book.themes))throw new AppError('INVALID');
  check(id(book.id), 'id');
  check(validIdentity(book.identity), 'identity');
  check(Number.isSafeInteger(book.revision) && book.revision >= 0, 'revision');
  check(text(book.title, 160, true), 'title');
  check(text(book.description, 1500), 'description');
  check(date(book.createdAt) && date(book.updatedAt), 'dates');
  const a = book.appearance;
  check(validAppearance(a), 'appearance');
  if (!Array.isArray(book.projects) || !Array.isArray(book.notebooks) || !Array.isArray(book.entries) || book.entries.length > MAX_WORKSPACE_RECORDS) throw new AppError('LIMIT');
  const allIds = new Set([book.id,...reservedIds]);
  const unique = record => { const valid = id(record.id) && !allIds.has(record.id); allIds.add(record.id); return valid; };
  for (const p of book.projects) check(keys(p, ['id', 'title', 'description', 'share', 'logoId',...['parentId','kind','tools','labBookTemplate'].filter(k=>Object.hasOwn(p??{},k))]) && typeof p.share === 'boolean' && (p.logoId === null || id(p.logoId)) && unique(p) && text(p.title, 160, true) && text(p.description, 1500), 'project', p?.id);
  check(validHierarchy(book.projects), 'structure hierarchy');
  for(const p of book.projects){if(Object.hasOwn(p??{},'labBookTemplate'))check(configurationReferences&&isConfigurationReference(p.labBookTemplate?.configuration)?keys(p.labBookTemplate,['name','configuration'])&&text(p.labBookTemplate.name,160,true)&&validConfigurationReference(p.labBookTemplate.configuration,{workspaceId:book.id,projectId:p.id,notebookId:null,slot:'labBookTemplate'}):validLabBookTemplate(p.labBookTemplate),'project lab-book template',p.id);if(Object.hasOwn(p??{},'tools'))check(validProjectTools(p.tools),'project tools',p.id);if(Object.hasOwn(p??{},'parentId'))check(p.parentId===null||id(p.parentId),'parent',p.id);if(Object.hasOwn(p??{},'kind'))check(text(p.kind,80,true),'kind',p.id);}
  for (const n of book.notebooks) check(keys(n, ['id', 'projectId', 'title',...['configuration','share','sharePdf'].filter(key=>Object.hasOwn(n??{},key))]) && ['share','sharePdf'].every(key=>!Object.hasOwn(n,key)||typeof n[key]==='boolean') && unique(n) && book.projects.some(p => p?.id === n.projectId) && text(n.title, 160, true), 'notebook', n?.id);
  for(const n of book.notebooks)if(Object.hasOwn(n??{},'configuration'))check(configurationReferences&&isConfigurationReference(n.configuration)?validConfigurationReference(n.configuration,{workspaceId:book.id,projectId:n.projectId,notebookId:n.id,slot:'configuration'}):validConfiguration(n.configuration),'notebook configuration',n.id);
  checkRecords(book,book.entries,unique,check);
  check(validFont(a?.headingFont) && ['background', 'surface', 'text'].every(key => /^#[0-9a-f]{6}$/i.test(a?.[key])), 'appearance');
  // Format 21 carries the earlier website system's settings, pages and branding.
  if (book.formatVersion === 21) {
    const site = book.website;
    check(keys(site, ['logoId', 'logoAlt', 'footer', 'navigation', ...(site.researchSources===undefined?[]:['researchSources']), 'title', 'description', 'home', 'design', 'assets', 'layouts', 'templates', 'typography', 'presentation', 'palette']) && (site.logoId === null || id(site.logoId)) && text(site.logoAlt, 160) && text(site.footer, 1500) && Array.isArray(site.navigation) && site.navigation.length <= 200 && site.navigation.every(item => validWebsiteNavigationItem(item)) && new Set(site.navigation.map(item => item.target)).size === site.navigation.length, 'website');
    check(validPresentation(site.presentation), 'media presentation');
    check(validPalette(site.palette), 'website colors');
    check(validTypography(site.typography), 'website typography');
    check(validWebsiteComposition(site), 'website composition');
    check(Array.isArray(site.navigation)&&validMenuParents(site.navigation), 'menu hierarchy');
    check(validSiteLayout(site.design), 'website layout');
    check(Array.isArray(site.assets)&&site.assets.length<=500&&new Set(site.assets.map(a=>a?.id)).size===site.assets.length&&site.assets.every(validWebsiteAsset), 'website assets');
    check(Array.isArray(book.pages) && book.pages.length <= 50 && book.pages.every(p => validWebsitePage(p) && unique(p)), 'pages');
    const targets=new Set(issues.length?[]:[...layoutTargets(book).map(t=>t.target),...entryTargets]);
    check(Array.isArray(site.layouts)&&site.layouts.length<=1700&&new Set(site.layouts.map(l=>l?.target)).size===site.layouts.length&&site.layouts.every(l=>validWebsiteLayout(l)&&(targets.has(l.target)||publicationPresentationTarget(site,l.target))), 'page layouts');
    check(Array.isArray(site.templates)&&site.templates.length<=100&&site.templates.every(t=>keys(t,['id','name','sections',...(Object.hasOwn(t??{},'templateLink')?['templateLink']:[])])&&(!Object.hasOwn(t,'templateLink')||validTemplateLink(t.templateLink))&&id(t.id)&&text(t.name,80,true)&&validSections(t.sections))&&new Set(site.templates.map(t=>t.id)).size===site.templates.length, 'page templates');
    if (!issues.length) {
      const targets = new Set(['home', ...book.projects.map(p => 'project:' + p.id), ...book.notebooks.map(n => 'notebook:' + n.id), ...book.pages.map(p => 'page:' + p.id)]);
      check(site.navigation.every(item => targets.has(item.target)||publicationPresentationTarget(site,item.target,{records:false})), 'navigation');
    }
  }
  if (book.formatVersion === 21) {
    const targets = new Set(issues.length ? [] : [...brandingTargets(book).map(item => item.target),...entryTargets]);
    check(Array.isArray(book.branding) && book.branding.length <= 1700 && book.branding.every(item => validWebsiteBranding(item) && (targets.has(item.target)||publicationPresentationTarget(book.website,item.target))) && new Set(book.branding.map(item => item.target)).size === book.branding.length, 'branding');
  }
  check(Array.isArray(book.themes) && book.themes.length <= 50 && book.themes.every(preset => keys(preset, ['id', 'name', 'appearance']) && unique(preset) && text(preset.name, 80, true) && validAppearance(preset.appearance)), 'themes');
  check(book.activeThemeId === null || (id(book.activeThemeId) && Array.isArray(book.themes) && book.themes.some(preset => preset?.id === book.activeThemeId)), 'activeThemeId');
  if(!issues.length)issues.push(...workflowIssues(book));
  if (issues.length) throw new AppError('INVALID', issues.slice(0, 30));
  if (Buffer.byteLength(JSON.stringify(book, null, 2) + '\n') > MAX_BYTES) throw new AppError('LIMIT');
  return book;
}

// Format 22 leaves the earlier website system's settings, pages, branding and
// named sites behind; websites are made in the website editor with their own files.
export const CURRENT_FORMAT=22;
export function currentWorkspaceMetadata(metadata){
 if(metadata.formatVersion!==21)return metadata;
 const {website,websites,pages,branding,...current}=metadata;void website;void websites;void pages;void branding;
 return {...current,formatVersion:22};
}
export function createNotebook(title = 'My field notes', description = '', theme = 'research') {
  if (!['research', 'studio'].includes(theme)) throw new AppError('INVALID');
  const now = new Date().toISOString();
  return validateNotebook({
    formatVersion: 22, identity: {kind:'personal',label:''}, themes: [], activeThemeId: null, id: randomUUID(), revision: 0, title, description, createdAt: now, updatedAt: now,
    appearance: startingAppearance(theme),
    projects: [], notebooks: [], entries: []
  });
}


// Catalogue results keep their admitted configuration references; documents
// from anywhere else must carry complete configurations. Only formats 21 and 22
// are valid; stored format 21 metadata becomes the current format 22.
export function upgradeNotebook(source,{configurationReferences=false}={}) {
  validateBook(source,{configurationReferences});
  return validateBook(currentWorkspaceMetadata(structuredClone(source)),{configurationReferences});
}
