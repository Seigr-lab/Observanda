import {upgradeNotebook} from './model.js';
import {withoutFigureSources} from './web/figure-provenance.js';
import {AppError} from './errors.js';
import {digest} from './storage.js';
import {revisionText} from './web/revision-model.js';
import {proseText,projectProse,proseReferences} from './web/prose-model.js';
import {researchReference} from './web/research-reference.js';
import {projectedRegions,resolveRegion} from './web/website-regions.js';
import {websiteTypography} from './web/website-typography.js';
import {usedAssetIds} from './web/website-layouts.js';
import {homeIntroduction,siteIdentity,selectedContent,publicSections,linkAvailable} from './web/website-model.js';
import {logosFor} from './web/branding.js';
import {admitPublicationPage} from './publication-context.js';
import {projectAttempt} from './web/attempt-view.js';
import {projectResults} from './web/result-statements.js';
import {selectorAnchor} from './web/book-selectors.js';
import {readingJourney} from './web/book-journeys.js';
import {publicationLinkResolver,publicationRecordText,publicationRecordDestination,publicationCollectionDestination,publicationTargetSelector} from './publication-prose.js';
import {selectEditionRecord} from './web/publication-selection.js';
import {validateEditionSelection,validateEditionRecord} from './publication-selection.js';
import {customFieldLabel} from './web/custom-field-presentation.js';

export function publicProjection(source, options={}) {
  const {designPageId=null,designTarget=null,workspaceContent=false}=options;
  const book = upgradeNotebook(source),selection=selectedContent(book);
  if(designPageId){const page=book.pages.find(p=>p.id===designPageId);if(!page)throw new AppError('INVALID');if(!selection.pages.some(p=>p.id===page.id))selection.pages=[...selection.pages,page];}
  if(designTarget!==null&&(typeof designTarget!=='string'||! /^(home|(?:page|project|notebook|entry):[a-f0-9-]{36})$/.test(designTarget)))throw new AppError('INVALID');
  if(designTarget&&designTarget!=='home'){
    const [kind,id]=designTarget.split(':'),key={project:'projects',notebook:'notebooks',entry:'entries',page:'pages'}[kind],item=book[key]?.find(v=>v.id===id);
    if(!item)throw new AppError('INVALID');
    const include=(key,item)=>{if(item&&!selection[key].some(v=>v.id===item.id))selection[key]=[...selection[key],item];};
    include(key,item);
    const notebook=kind==='entry'?book.notebooks.find(n=>n.id===item.notebookId):kind==='notebook'?item:null;
    if(notebook){include('notebooks',notebook);include('projects',book.projects.find(p=>p.id===notebook.projectId));}
  }
  // The authenticated composer uses actual workspace content, including items
  // not yet selected for publication. This never changes their sharing flags.
  if(workspaceContent){
    if(!designTarget)throw new AppError('INVALID');
    for(const key of ['projects','notebooks','entries','pages'])selection[key]=book[key];
  }
  if(options.edition){
    if(workspaceContent||designTarget||designPageId)throw new AppError('INVALID');
    validateEditionSelection(options.edition);if(options.edition.history?.some(r=>r.include))throw new AppError('INVALID');const choices=new Map(options.edition.records.map(r=>[r.id,r]));
    if([...choices.keys()].some(id=>!selection.entries.some(r=>r.id===id)))throw new AppError('RECORD_CHANGED');
    selection.entries=selection.entries.flatMap(record=>{const choice=choices.get(record.id);validateEditionRecord(record,choice);return choice?.include===false?[]:[{...selectEditionRecord(record,choice),revision:digest(revisionText(record))}];});
    selection.notebooks=selection.notebooks.filter(n=>selection.entries.some(r=>r.notebookId===n.id));
  }
  return projectPublication(book,selection,options);
}

// Internal projection boundary: the caller has validated metadata and originals.
// Destination summaries resolve links/counts; they are never rendered as records.
export function projectPublication(book,selection,{designPageId=null,designTarget=null,workspaceContent=false,singlePage=false,entryDestinations=null,publicationTarget=null,previewCounts=null,publicationCounts=null,browsePage=null,collectionPages=null,collectionQuery='',referencePage=null,referenceQuery='',edition}={}) {
  if(browsePage&&publicationTarget!=='browse')throw new AppError('INVALID');
  if(publicationCounts&&!publicationTarget)throw new AppError('INVALID');
  if(collectionPages&&!publicationTarget&&!(workspaceContent&&singlePage&&designTarget&&entryDestinations))throw new AppError('INVALID');
  if(referencePage&&!(publicationTarget??designTarget)?.startsWith('entry:'))throw new AppError('INVALID');
  if(previewCounts&&(!workspaceContent||!singlePage||!designTarget||!entryDestinations))throw new AppError('INVALID');
  if(publicationTarget&&(workspaceContent||singlePage||designTarget||designPageId||!entryDestinations))throw new AppError('INVALID');
  if(entryDestinations&&!publicationTarget&&(!workspaceContent||!singlePage||!designTarget))throw new AppError('INVALID');
  if(selection.recordCards&&!publicationTarget&&(!entryDestinations||!workspaceContent||!singlePage))throw new AppError('INVALID');
  const pageTarget=publicationTarget??designTarget,paged=singlePage||!!publicationTarget;
  const destinations=entryDestinations??selection.entries;
  const links={...selection,entries:destinations};
  selection={...selection,...(entryDestinations?{entryDestinations}:{}),...(collectionPages?{collectionPages}:{})};
  const destination=target=>publicationRecordDestination(destinations,target,book.id);
  const revisionMatches=target=>!!destination(target);
  const availability=(id,target)=>(edition?.availability??[]).find(r=>r.recordId===id&&researchReference(r.target)===researchReference(target))?.statement;
  const sectionsFor=(target,sections)=>paged&&target!==pageTarget?[]:sections;
  const projectLink=publicationLinkResolver(book.id,links,{workspaceContent});
  const publicText=value=>projectProse(value,projectLink);
  const recordText=(value,record)=>publicationRecordText(value,record,projectLink,{workspaceContent});
  const cleanSections=sections=>sections.map(section=>section.richText?{...section,richText:publicText(section.richText),body:proseText(publicText(section.richText))}:section);
  const projects = selection.projects.map(p => ({ id: p.id, title: p.title, description: p.description, logos: logosFor(book, 'project:' + p.id) }));
  const entries = selection.entries.map(e => ({
    ...(e.historical?{revisionEdition:{revision:e.revision,current:publicationRecordDestination(destinations,{workspaceId:e.sourceWorkspaceId??book.id,id:e.recordId},book.id)?.id??null}}:{}),
    availability:(edition?.availability??[]).filter(r=>r.recordId===e.id&&!projectLink(researchReference(r.target))).map(r=>r.statement),
    id: e.id, notebookId: e.notebookId, type: e.template?.label??e.type, journey:readingJourney(e), title: e.title, body: recordText(e.body,e), contributors:e.contributors.map(person=>({name:person.name,role:person.role})),
    relations:e.relations.flatMap(link=>{
      const href=projectLink(researchReference(link.target));if(!href)return [];
      const target=link.target.kind==='record'?destination(link.target):publicationCollectionDestination(selection,link.target,book.id);
      return [{type:link.type,...(link.role?{role:link.role}:{}),kind:link.target.kind,id:target?.id??book.id,...(link.target.selector?{fragment:selectorAnchor(publicationTargetSelector(target,link.target.selector))}:{}),label:link.target.kind==='workspace'?book.title:target.title}];
    }),
    logos: logosFor(book, 'entry:' + e.id), tags: [...e.tags], occurredOn: structuredClone(e.occurredOn), status: e.status, outcome:e.outcome??'',
    sections: [...(e.template?.fields??[]).map(f=>({id:'field-'+f.key,title:customFieldLabel(f),body:String(e.template.values[f.key]??'')})),...e.sections.map(s => ({ id:s.id,title: s.title, body: recordText(s.body,e) }))],
    attachments: e.attachments.filter(a => workspaceContent || a.share).map(a => ({ id: a.id, kind: a.kind, caption: a.caption, alt: a.alt, transcript: a.transcript })),
    figures: e.figures.map(withoutFigureSources),
    figureDownloads:edition?.records.find(r=>r.id===e.id)?.figures.filter(f=>f.data).map(f=>f.id)??[],
    ...(e.results?{results:projectResults(e.results)}:{}),
    ...(e.attempt?{attempt:projectAttempt(e.attempt,ref=>{
      const target=ref.kind==='record'&&projectLink(researchReference(ref))&&revisionMatches(ref)?destination(ref):null;
      return target?{kind:'record',id:target.id,revision:ref.revision,label:target.title,href:'../entries/'+target.id+'.html'}:availability(e.id,ref)?{withheld:true,statement:availability(e.id,ref)}:null;
    })}:{})
  }));
  const notebooks = selection.notebooks.map(n => ({ id: n.id, title: n.title, projectId: n.projectId, logos: logosFor(book, 'notebook:' + n.id) }));
  const pages = selection.pages.map(p => ({ id: p.id, title: p.title, body: p.body, ...(p.excerpt===undefined?{}:{excerpt:p.excerpt}), ...(p.hasBody===undefined?{}:{hasBody:p.hasBody}), sections:cleanSections(publicSections(sectionsFor('page:'+p.id,p.sections),selection,{includeUnpublished:workspaceContent,editing:designTarget==='page:'+p.id||designPageId===p.id})), logos: logosFor(book, 'page:' + p.id) }));
  const targets = [...(selection.homeEnabled?[{ target: 'home', title: 'Home', path: 'index.html' }]:[]), ...projects.map(p => ({ target: 'project:' + p.id, title: p.title, path: `projects/${p.id}.html` })), ...notebooks.map(n => ({ target: 'notebook:' + n.id, title: n.title, path: `notebooks/${n.id}.html` })), ...pages.map(p => ({ target: 'page:' + p.id, title: p.title, path: `pages/${p.id}.html` }))];
  const layouts=book.website.layouts.filter(l=>(!paged||l.target===pageTarget)&&linkAvailable(l.target,selection)).map(l=>({...l,sections:cleanSections(publicSections(l.sections,selection,{includeUnpublished:workspaceContent,editing:designTarget===l.target,region:'layout'}))}));
  const pageTargets=paged?[pageTarget]:[...targets.map(t=>t.target),...entries.map(e=>'entry:'+e.id)];
  const regionTarget=target=>target==='browse'?(selection.homeEnabled?'home':'project:'+selection.projects[0]?.id):target;
  const regions=projectedRegions(book.website,pageTargets.map(regionTarget),(sections,target,region)=>cleanSections(publicSections(sections,selection,{includeUnpublished:workspaceContent,editing:designTarget===target,region}))).map(region=>publicationTarget==='browse'?{...region,target:'browse'}:region);
  const assetIds=new Set(usedAssetIds([...regions.flatMap(r=>r.sections),...publicSections(selection.homeEnabled?sectionsFor('home',book.website.home.sections):[],selection,{includeUnpublished:workspaceContent,editing:designTarget==='home'}),...pages.flatMap(p=>p.sections),...layouts.flatMap(l=>l.sections)]));
  const assets=book.website.assets.filter(a=>assetIds.has(a.id)).map(a=>({id:a.id,kind:a.kind,caption:a.caption,alt:a.alt,transcript:a.transcript,...(a.kind==='file'?{name:a.name,size:a.size,sha256:a.sha256}:{})}));
  const homeSections=cleanSections(publicSections(selection.homeEnabled?sectionsFor('home',book.website.home.sections):[],selection,{includeUnpublished:workspaceContent,editing:designTarget==='home'})),mediaUses=new Map();
  const addUses=(target,sections)=>{for(const section of sections){const ids=section.kind==='media'?[section.attachmentId]:usedAssetIds([section]);mediaUses.set(target+'#'+section.id,new Set(ids));}};
  const regionScopes=new Map();
  for(const region of regions){addUses(region.target,region.sections);const owner=resolveRegion(book.website,regionTarget(region.target),region.kind);for(const s of region.sections){const source='region:'+owner.id+'#'+s.id,uses=regionScopes.get(source)??[];uses.push(region.target+'#'+s.id);regionScopes.set(source,uses);}}
  addUses('home',homeSections);for(const p of pages)addUses('page:'+p.id,p.sections);for(const layout of layouts)addUses(layout.target,layout.sections);
  for(const entry of entries)mediaUses.set('entry:'+entry.id,new Set(entry.attachments.map(a=>a.id)));
  const cards=selection.recordCards??entries;
  for(const entry of cards){const choice=book.website.presentation.covers.find(c=>c.entryId===entry.id),image=choice?entry.attachments.find(a=>a.id===choice.attachmentId&&a.kind==='image'):entry.attachments.find(a=>a.kind==='image');mediaUses.set('cover:'+entry.id,new Set(image?[image.id]:[]));}
  const presentation={media:book.website.presentation.media.flatMap(m=>(regionScopes.get(m.scope)??[m.scope]).filter(scope=>mediaUses.get(scope)?.has(m.id)).map(scope=>({...m,scope,link:m.link&&linkAvailable(m.link,selection)?m.link:''}))),covers:book.website.presentation.covers.filter(c=>cards.some(e=>e.id===c.entryId))};
  const settings = book.website.navigation;
  const navigation = [...settings.map(setting => { const target = targets.find(t => t.target === setting.target); return target && setting.show ? { title: setting.label || target.title, path: target.path, target:target.target, parent:setting.parent??null } : null; }).filter(Boolean), ...targets.filter(t => !settings.some(s => s.target === t.target) && !t.target.startsWith('notebook:')).map(t => ({ title: t.title, path: t.path, target:t.target, parent:null }))];
  for(const item of navigation){if(!navigation.some(parent=>parent.target===item.parent))item.parent=null;}
  const context={ browseRecords:destinations.filter(r=>!r.historical).map(r=>({id:r.id,title:r.title,notebookId:r.notebookId,type:r.template?.label??r.type,journey:readingJourney(r),tags:[...r.tags],occurredOn:structuredClone(r.occurredOn)})),...(selection.recordCards?{recordCards:selection.recordCards}:{}), ...(entryDestinations?{designOnly:!publicationTarget,entryDestinations:destinations.map(({id,title,notebookId})=>({id,title,notebookId}))}:{}), ...siteIdentity(book), homeEnabled:selection.homeEnabled, appearance: { ...book.appearance, ...book.website.palette, ...websiteTypography(book) }, projects, notebooks, entries, pages, website: { presentation, assets, layouts, design:{...Object.fromEntries(['buttons','links'].filter(key=>book.website.design[key]!==undefined).map(key=>[key,structuredClone(book.website.design[key])])),width:book.website.design.width,navigation:book.website.design.navigation,heading:book.website.design.heading,contents:book.website.design.contents,...(book.website.design.browseLink!==undefined?{browseLink:book.website.design.browseLink}:{})}, regions, home: selection.homeEnabled?{...book.website.home,introduction:homeIntroduction(book),sections:homeSections}:{enabled:false,sections:[]}, logos: pageTargets.some(target=>!regions.some(r=>r.target===target&&r.kind==='header'))?logosFor(book,'home'):[], footer: pageTargets.some(target=>!regions.some(r=>r.target===target&&r.kind==='footer'))?book.website.footer:'', navigation } };
  if(previewCounts)context.previewCounts=previewCounts;
  if(publicationCounts)context.publicationCounts=publicationCounts;
  if(collectionPages){context.collectionPages=collectionPages;context.collectionQuery=collectionQuery;}
  if(browsePage){context.browsePage=browsePage;context.browseRecords=browsePage.records;}
  if(referencePage){context.referencePage=referencePage;context.referenceQuery=referenceQuery;}
  context.recordJourneys=(publicationTarget||referencePage?destinations:selection.entries).flatMap(r=>{const references=[...r.relations,...(r.body!==undefined?[r.body,...r.sections.map(s=>s.body)].flatMap(proseReferences).map(target=>({role:'mention',target})):[])];const relations=references.filter(l=>(!publicationTarget&&!referencePage||pageTarget==='entry:'+destination(l.target)?.id)&&l.target.kind==='record'&&revisionMatches(l.target)&&projectLink(researchReference(l.target))).map(l=>({role:l.role??'related',id:destination(l.target).id}));return relations.length?[{id:r.id,title:r.title,status:r.status,outcome:r.outcome,relations}]:[];});
  if(publicationTarget){
    return admitPublicationPage(context,publicationTarget);
  }
  return context;
}
