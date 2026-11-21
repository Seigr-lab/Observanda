import {sourcePublicationRecord} from './web/source-publication-permissions.js';
import {withoutFigureSources} from './web/figure-provenance.js';
import {AppError} from './errors.js';
import {proseReferences} from './web/prose-model.js';
import {researchReference} from './web/research-reference.js';
import {websiteTypography} from './web/website-typography.js';
import {admitPublicationPage} from './publication-context.js';
import {projectAttempt} from './web/attempt-view.js';
import {projectResults} from './web/result-statements.js';
import {selectorAnchor} from './web/book-selectors.js';
import {readingJourney} from './web/book-journeys.js';
import {publicationLinkResolver,publicationRecordText,publicationRecordDestination,publicationCollectionDestination,publicationTargetSelector} from './publication-prose.js';
import {customFieldLabel} from './web/custom-field-presentation.js';
// Template field labels may be shipped profile text, which reads its catalogue;
// a website build registers it itself instead of relying on the interface.
import './web/i18n/catalogues/labBookProfiles.js';

// Internal projection boundary: the caller has validated metadata and originals.
// It projects the one record its page shows. Destination summaries resolve
// links and backlinks; they are never rendered as records.
export function projectPublication(book,selection,{entryDestinations,publicationTarget,privateRecordLink=null}={}) {
  if(!publicationTarget?.startsWith('entry:')||!Array.isArray(entryDestinations))throw new AppError('INVALID');
  selection={...selection,notebooks:selection.notebooks.filter(n=>n.share!==false),entries:selection.entries.filter(e=>e.share===true&&selection.notebooks.some(n=>n.id===e.notebookId&&n.share!==false)).map(record=>sourcePublicationRecord(record))};
  const destinations=entryDestinations,links={...selection,entries:destinations};
  selection={...selection,entryDestinations};
  const destination=target=>publicationRecordDestination(destinations,target,book.id);
  const revisionMatches=target=>!!destination(target);
  const projectLink=publicationLinkResolver(book.id,links);
  const proseLink=privateRecordLink?href=>projectLink(href)??privateRecordLink(href):projectLink;
  const recordText=(value,record)=>publicationRecordText(value,record,proseLink);
  const projects=selection.projects.map(p=>({id:p.id,title:p.title}));
  const entries=selection.entries.map(e=>({
    id: e.id, notebookId: e.notebookId, type: e.template?.label??e.type, journey:readingJourney(e), title: e.title, body: recordText(e.body,e), contributors:e.contributors.map(person=>({name:person.name,role:person.role})),
    relations:e.relations.flatMap(link=>{
      const href=projectLink(researchReference(link.target));if(!href)return [];
      const target=link.target.kind==='record'?destination(link.target):publicationCollectionDestination(selection,link.target,book.id);
      return [{type:link.type,...(link.role?{role:link.role}:{}),kind:link.target.kind,id:target?.id??book.id,...(link.target.selector?{fragment:selectorAnchor(publicationTargetSelector(target,link.target.selector))}:{}),label:link.target.kind==='workspace'?book.title:target.title}];
    }),
    tags: [...e.tags], occurredOn: structuredClone(e.occurredOn), status: e.status, outcome:e.outcome??'',
    sections: [...(e.template?.fields??[]).map(f=>({id:'field-'+f.key,title:customFieldLabel(f),body:String(e.template.values[f.key]??''),field:{type:f.type,value:e.template.values[f.key]??null}})),...e.sections.map(s => ({ id:s.id,title: s.title, body: recordText(s.body,e) }))],
    attachments: e.attachments.filter(a => a.share===true).map(a => ({ id: a.id, kind: a.kind, caption: a.caption, alt: a.alt, transcript: a.transcript, ...(a.attribution?{attribution:{...a.attribution}}:{}), ...(a.captions?{captions:a.captions.map(track=>({...track}))}:{}) })),
    figures: e.figures.map(withoutFigureSources),
    figureDownloads:[],
    ...(e.results?{results:projectResults(e.results)}:{}),
    ...(e.attempt?{attempt:projectAttempt(e.attempt,ref=>{
      const target=ref.kind==='record'&&projectLink(researchReference(ref))&&revisionMatches(ref)?destination(ref):null;
      return target?{kind:'record',id:target.id,revision:ref.revision,label:target.title,href:'../entries/'+target.id+'.html'}:null;
    })}:{})
  }));
  const notebooks=selection.notebooks.map(n=>({id:n.id,title:n.title,projectId:n.projectId}));
  const design=book.website.design;
  const context={entryDestinations:destinations.map(({id,title,notebookId})=>({id,title,notebookId})),homeEnabled:false,appearance:{...book.appearance,...book.website.palette,...websiteTypography(book)},projects,notebooks,entries,
    website:{presentation:{media:[],covers:[]},design:{...Object.fromEntries(['buttons','links'].filter(key=>design[key]!==undefined).map(key=>[key,structuredClone(design[key])])),width:design.width,navigation:design.navigation,heading:design.heading,contents:design.contents,...(design.browseLink!==undefined?{browseLink:design.browseLink}:{})}}};
  // Records that refer to this one, for its backlinks.
  context.recordJourneys=destinations.flatMap(r=>{const references=[...r.relations,...(r.body!==undefined?[r.body,...r.sections.map(s=>s.body)].flatMap(proseReferences).map(target=>({role:'mention',target})):[])];const relations=references.filter(l=>publicationTarget==='entry:'+destination(l.target)?.id&&l.target.kind==='record'&&revisionMatches(l.target)&&projectLink(researchReference(l.target))).map(l=>({role:l.role??'related',id:destination(l.target).id}));return relations.length?[{id:r.id,title:r.title,status:r.status,outcome:r.outcome,relations}]:[];});
  return admitPublicationPage(context,publicationTarget);
}
