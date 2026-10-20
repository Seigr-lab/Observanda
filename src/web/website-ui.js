import {publicationSourceCount} from './publication-source-context.js';
import {sameWebsitePin} from './website-pin.js';
import {websiteDocumentPages} from './website-document-pages.js';
import {publicationMediaClient} from './publication-media-client.js';
import {publicationPageClient,publicationPageSections} from './publication-page-client.js';
import {publicationSourcesUI} from './publication-sources-ui.js';
import {publicationEditorClient} from './publication-editor-client.js';
import {websiteDownloadFields} from './website-download-ui.js';
import {websiteSectionPicker} from './website-section-picker.js';
import {websiteActionUI} from './website-action-ui.js';
import {websitePopupFields} from './website-popup-ui.js';
import {websiteDisclosureFields} from './website-disclosure-ui.js';
import {REGION_SLOTS} from './website-regions.js';
import {websiteContext,websiteSnapshot} from './website-context.js';
import {WebsiteReferenceNavigation} from './website-reference-navigation.js';
import {WebsiteCollectionNavigation} from './website-collection-navigation.js';
import {canvasResourceLinks} from './website-canvas-resources.js';
import {websiteFeedFields,changeWebsiteFeed} from './website-feed-ui.js';
import {enhancePublicFeeds} from './public-feeds.js';
import {FEED_KINDS,validFeed} from './website-feed-model.js';
import {websiteMediaUI} from './website-media-ui.js';
import {websiteContentUI} from './website-content-ui.js';
import {websiteContentPages} from './website-content-pages.js';
import {websiteResearchClient} from './website-research-client.js';
import {websiteResearchMedia} from './website-research-media.js';
import {websiteLinkDestinations} from './website-link-destinations.js';
import {websitePagePicker} from './website-page-picker.js';
import {websitePageTarget,websitePageAtPath,websitePageTargets,websitePageChoices,websitePageWindow,websiteStartingPage} from './website-page-targets.js';
import {WebsiteHistory} from './website-history.js';
import {WebsitePageContexts} from './website-page-contexts.js';
import {websiteRegionsUI} from './website-regions-ui.js';
import {websiteNavigationFields,websiteNavigationUI} from './website-navigation-ui.js';
import {resolveRegion,regionsOf} from './website-regions.js';
import {t} from './i18n/index.js';
import {draftWorkspace} from './workspace-snapshot.js';
import {applyRichTextStyles as refreshRichStyles} from './document-editor.js';
import {textTools} from './text-tools.js';
import {reconcileCanvas} from './canvas-document.js';
import {acceptsChildren,childrenOf,descendantsOf,treeOrder,moveElement,insertElement,cloneElements,newElement,ELEMENTS,MAX_ELEMENTS} from './composition-tree.js';
import {composerDrag} from './composer-drag.js';
import {mediaStyle,copySectionPresentation,clearSectionPresentation} from './media-presentation.js';
import {previewSurface} from './preview-surface.js';
import {FONT_OPTIONS} from './themes.js';
import {fontSelect,axisControls,checkFontInputs} from './font-picker.js';
import {websiteTypography,TYPOGRAPHY_RANGES,validTypography,WEBSITE_COLORS} from './website-typography.js';
import {renderRichText} from './rich-text-model.js';
import {mountRichText} from './vendor/rich-text-editor.js';
import {richTextPlain} from './rich-text-model.js';
import {hasHomepage,defaultPageLayout} from './website-layouts.js';
import {websiteLibraryUI} from './website-library-ui.js';
import {emptyHomepage,homeIntroduction,websiteSummary,siteIdentity,navigationItems,storedNavigation,sectionStyle,publicSections,menuCanNest,safeLink,linkAvailable} from './website-model.js';
import {bindReorder} from './reorder-ui.js';
import {moveItem} from './dashboard-model.js';
const tr=(key,values)=>t('websiteEditor',key,values);

export function websiteUI({state,api,esc,field,option,icon,dirty,render,notify,showDialog,selection,documents,access,bindMedia=()=>{},previewDraft=book=>({book})}) {
  const research=websiteResearchClient({state,api,selection,onChange:()=>{if(state.page==='website')refreshSummary();}});
  const sourcePages=publicationEditorClient({state});
  const mediaQuery=publicationMediaClient({state,api,access,research,snapshots:()=>sourcePages.sources()});
  const researchMedia=websiteResearchMedia({state,research,esc,field,showDialog,notify,query:mediaQuery});
  let pageLabels=[],pageLabelContext=null,pageChange=0,overrideController=null,overrideError='',switchingPage=false;
  const native=()=>Boolean(documents?.enabled());
  const pageBook=()=>{const book=sourcePages.pageBook(research.pageBook());return native()?{...book,pages:[...pageLabels.filter(page=>!book.pages.some(value=>value.id===page.id)),...book.pages]}:book;};
  const structurePages=options=>native()?websiteDocumentPages(documents,pageBook(),options):Promise.resolve(websitePageWindow(pageBook(),options));
  async function load(){if(!native())return;const stamp=documents.viewKey(),fresh=pageLabelContext!==stamp;const result=await documents.window('pages',{limit:25});if(stamp!==documents.viewKey())return;pageLabels=result.items.map(row=>row.value);pageLabelContext=stamp;
   let path=documents.selectedPage()?'pages/'+documents.selectedPage()+'.html':previewPage;if(fresh&&context!==websiteContext(state)){try{const stored=JSON.parse(sessionStorage.getItem('observanda.editor.'+state.book.id+'.'+(state.websiteId??'workspace'))??'null');path=stored?.path??'index.html';}catch{path='index.html';}}
   const id=/^pages[/]([a-f0-9-]{36})[.]html$/.exec(path)?.[1];if(id&&(!state.book.pages.some(page=>page.id===id)||documents.selectedPage()!==id))try{await documents.selectPage(id);}catch(reason){if(reason.code!=='NOT_FOUND')throw reason;}
   if(!hasHomepage(state.book)&&!state.book.pages.length&&pageLabels.length)await documents.selectPage(pageLabels[0].id);
   const selected=documents.selectedPage();await ensureOverrides(websitePageAtPath(pageBook(),selected?'pages/'+selected+'.html':path)?.target??websiteStartingPage(pageBook())?.target);
  }
  const recordPages=publicationPageClient({state,api,access,snapshots:()=>sourcePages.sources()});
  const linkDestinations=websiteLinkDestinations({state,api,pageBook,structurePages,recordPages,documents});
  const pagePicker=websitePagePicker({state,api,esc,field,showDialog,pageBook,structurePages,recordPages,documents,onChoose:async item=>{if(item.owner)sourcePages.remember(item);research.choosePage(item);await changePreviewPage(item.path);}});
  const sectionPicker=websiteSectionPicker({state,api,esc,showDialog,pagePicker,previewTarget,pageBook,recordSections:options=>publicationPageSections({state,api,access,...options}),documents,onChoose:(selector,href)=>{const field=document.querySelector(selector);if(field){field.value=href;input(field,{discrete:true});}}});
  const history=new WebsiteHistory(),documentContexts=new WebsitePageContexts();
  const referenceNavigation=new WebsiteReferenceNavigation(),collectionNavigation=new WebsiteCollectionNavigation(api),canvasSources=new WeakMap(),canvasRequests=new WeakMap();
  let previewController=null;
  let richMount=null,richEditor=null,richId=null,richContext=null,revealSection=null,focusText=false,pageOptions=false;const richStates=new Map();
  function releaseRichEditor(){if(richEditor){if(richContext===websiteContext(state)){richStates.set(richId,richEditor.state);if(richStates.size>100)richStates.delete(richStates.keys().next().value);}const value=richEditor.doc;richEditor.destroy();if(richMount?.node.isConnected){for(const attr of [...richMount.node.attributes])richMount.node.removeAttribute(attr.name);for(const [name,value] of richMount.attributes)richMount.node.setAttribute(name,value);richMount.node.innerHTML=renderRichText(value);}richMount=null;richEditor=null;}}
  let area='body',toolTrail=[];
  let inlineHeading=null,pendingScroll=null,canvasDragging=false,disposeDrag=()=>{},structureOpen=false,paletteQuery='';
  let tool='page',sectionTab='content',typeTab='fonts',designTab='layout',selectedMedia=null,tab='home',context=null,timer,version=0,preview=null,previewPage='index.html',pageChosen=false,dispose=()=>{},disposeCanvas=()=>{},resizeObserver=null,surface=null,device='canvas',zoom='fit',inspector=true,expanded=false,editingPage=null,editingScope=null,inspectorWidth=380,openSection=null,historyRevision=null,historyBook=null,previewKey=null;
  const button=(label,action,extra='')=>`<button class="button" data-action="${action}" ${extra}>${label}</button>`;
  const canvasIcons={
    'website-inspector':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    'website-expand':'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    'website-undo':'<path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12"/>',
    'website-redo':'<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>'
  };
  const canvasButton=(label,action,extra='')=>`<button class="button canvas-icon" data-action="${action}" aria-label="${label}" title="${label}" ${extra}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${canvasIcons[action]}</svg></button>`;
  const pageModel=()=>state.book.pages.find(p=>'pages/'+p.id+'.html'===previewPage)??null;
  const scopeTarget=()=>previewTarget();
  const presentationTarget=()=>area==='body'?scopeTarget():'region:'+regionUI.selected()?.id;
  const canvasMediaScope=scope=>scope.startsWith('region:')?scopeTarget()+'#'+scope.split('#')[1]:scope;
  const layoutFor=target=>state.book.website.layouts.find(l=>l.target===target)??defaultPageLayout(target);
  function changeLayout(key,value){const target=scopeTarget();if(!target)return;let layout=native()?documents.editableOverride('layouts',target,()=>defaultPageLayout(target)):state.book.website.layouts.find(l=>l.target===target);if(!layout){layout=defaultPageLayout(target);state.book.website.layouts.push(layout);}layout[key]=value;}
  const sections=()=>previewSections();
  const setSections=value=>{if(area!=='body'){const region=resolveRegion(state.book.website,scopeTarget(),area);if(region)region.sections=value;return;}if(pageModel())pageModel().sections=value;else if(scopeTarget()==='home')state.book.website.home.sections=value;else changeLayout('sections',value);};
  const regionUI=websiteRegionsUI({state,esc,field,option,area:()=>area,target:scopeTarget,checkpoint,changed,resetSelection:()=>{openSection=null;selectedMedia=null;tool='page';toolTrail=[];},notify,pagePicker});
  const actionUI=websiteActionUI({state,esc,field,sections,checkpoint,changed});
  const mediaUI=websiteMediaUI({state,esc,field,option,showDialog,render:refreshTools,sections,checkpoint,changed,notify,research,researchMedia,documents});
  const navigationUI=websiteNavigationUI({state,documents,esc,field,option,showDialog,render:refreshTools,changed,notify});
  const legacyContent=websiteContentUI({state,esc,field,option,selection,render:refreshTools});
  const contentPages=websiteContentPages({state,esc,field,option,render:refreshTools,research,selection});
  const contentUI=Object.fromEntries(['view','input','action','bind','sync'].map(key=>[key,(...args)=>(research.enabled()?contentPages:legacyContent)[key](...args)]));
  const sourceUI=publicationSourcesUI({state,api,documents,esc,access,checkpoint,changed,notify,onOpenPage:async page=>{sourcePages.remember(page);research.choosePage(page);await changePreviewPage(page.path);tool='page';refreshTools();}});
  const compositionKind=()=>area!=='body'?area:previewTarget()==='home'?'home':previewTarget()?.startsWith('page:')?'page':'layout';
  const activeRoot=doc=>doc?.querySelector('[data-composition="'+compositionKind()+'"]');
  function goTool(next){if(tool!==next)toolTrail.push({tool,scroll:window.scrollY});tool=next;inspector=true;refreshTools();}
  const library=websiteLibraryUI({state,esc,field,option,sections,setSections,scopeTarget,changeLayout,checkpoint,changed,notify,api,render:refreshTools});
  const selectedSummary=()=>{
    if(!research.enabled())return websiteSummary(state.book);
    const selected=research.cachedRecord(),projectId=state.book.notebooks.find(n=>n.id===selected?.notebookId)?.projectId;
    const display=sourcePages.pageBook({...state.book,entries:selected?[{...selected,share:selection.projectRecordShare(selected,projectId)}]:[]}),result=websiteSummary(display),totals=research.totals();
    if(totals)result.notebooks=display.notebooks.filter(n=>(!state.book.notebooks.some(local=>local.id===n.id)||totals.notebookIds.includes(n.id))&&display.projects.some(p=>p.id===n.projectId&&p.share));
    return result;
  };
  const summary=()=>{const result=selectedSummary();if(native()){result.sourceCount=publicationSourceCount(state);result.canPublish ||= result.sourceCount>0||documents.descriptor().collections.pages.sharedCount>0;}return result;};
  function counts(){
    if(native())return tr('documentMediaCounts',{pages:documents.descriptor().collections.pages.sharedCount});
    const s=summary(),totals=research.totals(),groups=totals?.projects.filter(group=>s.projects.some(p=>p.id===group.id));
    if(research.enabled()&&!groups)return research.error()||t('websiteContent','loading');
    if(s.sourceCount){const sourceCount=sourcePages.recordCount();return sourceCount===null?t('publicationSources','selectionReady',{sources:s.sourceCount,pages:s.pages.length}):t('publicationSources','counts',{projects:s.projects.length,notebooks:s.notebooks.length,records:(groups?.reduce((sum,p)=>sum+p.included,0)??s.entries.length)+sourceCount,pages:s.pages.length});}
    return t('websiteContent','counts',{projects:s.projects.length,notebooks:s.notebooks.length,records:groups?groups.reduce((n,p)=>n+p.included,0):s.entries.length,pages:s.pages.length,media:groups?groups.reduce((n,p)=>n+p.includedMedia,0)+s.media.filter(a=>state.book.website.assets.some(asset=>asset.id===a.id)).length:s.media.length});
  }
  const toolActive=value=>tool===value||value==='page'&&['page-settings','library','selection','gallery','insert'].includes(tool)||value==='site'&&['typography','layout','menu','media','actions'].includes(tool);
  const taskButton=(label,value)=>`<button class="button ${toolActive(value)?'primary':''}" data-action="website-tool" data-tool="${value}" ${toolActive(value)?'aria-current="page"':''}>${label}</button>`;
  const overridesReady=()=>!native()||!previewTarget()||['layouts','branding'].every(collection=>documents.hasSelected(collection,previewTarget()));
  async function ensureOverrides(target,{signal}={}){if(native()&&target){await documents.selectOverride('layouts',target,{signal});await documents.selectOverride('branding',target,{signal});}}
  async function loadOverrides(){
   if(!native()||overridesReady()||overrideController||switchingPage||state.page!=='website')return;
   const controller=overrideController=new AbortController(),target=previewTarget(),stamp=websiteContext(state);overrideError='';
   try{await ensureOverrides(target,{signal:controller.signal});}
   catch(error){if(!controller.signal.aborted&&stamp===websiteContext(state)&&target===previewTarget())overrideError=error.message;}
   finally{if(overrideController===controller)overrideController=null;if(!controller.signal.aborted&&state.page==='website'&&stamp===websiteContext(state)&&target===previewTarget()){refreshTools();schedulePreview();}}
  }
  function inspectorContent(){if(switchingPage||!overridesReady())return '<section class="panel"><p role="'+(overrideError?'alert':'status')+'">'+esc(overrideError||tr('documentLoading'))+'</p>'+(!overrideController?button(esc(tr('documentLoadRetry')),'website-target-retry'):'')+'</section>';return (!['page','site','content'].includes(tool)?'<div class="editor-return">'+button(esc(tr(toolTrail.length?'back':'backPage')),'website-back')+'</div>':'')+inspectorBody();}
  function inspectorBody(){
    if(!previewTarget()&&['page','page-settings','insert','library','selection'].includes(tool))return emptyPage();
    if(tool==='page')return pageOutline();
    if(tool==='content')return (state.book.projects.length?contentUI.view():'')+sourceUI.view();
    if(tool==='media')return mediaUI.library();
    if(tool==='menu'&&native())return navigationUI.view();
    if(tool==='menu')return websiteNavigationFields(pageBook(),summary(),{esc,field,option});
    if(tool==='gallery')return '<section class="panel"><h2>'+esc(t('websiteMedia','gallery'))+'</h2>'+mediaUI.gallery(sections().find(s=>s.id===openSection))+'</section>';
    if(tool==='insert')return insertPanel();
    if(tool==='selection')return selectedMedia?mediaInspector():openSection?`<section class="panel selected-section"><h2 data-selection-title>${esc(sectionName(sections().find(s=>s.id===openSection)??{kind:'Selection'}))}</h2><ol id="website-section-order" class="website-section-order">${sections().filter(s=>s.id===openSection).map(s=>sectionEditor(s,sections().indexOf(s))).join('')}</ol></section>`:'<section class="panel"><h2>Selection</h2><p>Select text, an image, or a section on the page.</p></section>';
    if(tool==='page-settings')return previewTarget()==='home'?home():customPages();
    if(tool==='actions')return actionUI.site();
    if(tool==='typography')return typography();
    if(tool==='layout')return layout();
    if(tool==='library')return `<section class="panel">${library.view()}</section>`;
    return `<section class="panel site-tools"><h2>Site settings</h2>${siteFields()}${[['typography','Typography'],['layout','Layout & branding'],['menu','Navigation'],['actions',tr('action_site')],['media','Media library']].map(([key,label])=>taskButton(label,key)).join('')}</section>`;
  }
  function view(){
    research.sync();if(research.enabled()&&!research.totals()&&!research.error())research.refresh();
    syncHistory();
    if(context!==websiteContext(state)){context=websiteContext(state);area='body';toolTrail=[];richStates.clear();documentContexts.clear();structureOpen=false;selectedMedia=null;tab='home';tool='page';preview=null;previewPage='index.html';pageChosen=false;openSection=null;selectedMedia=null;history.clear();
      try{
        const stored=sessionStorage.getItem('observanda.editor.'+state.book.id+'.'+(state.websiteId??'workspace')),remembered=stored&&stored.length<=65536?JSON.parse(stored):null;
        if(research.enabled()&&remembered?.recordPage&&/^entries\/[a-f0-9-]{36}\.html$/.test(remembered.path)&&remembered.path==='entries/'+remembered.recordPage.id+'.html'&&typeof remembered.recordPage.title==='string'&&remembered.recordPage.title.length<=180)research.choosePage({target:'entry:'+remembered.recordPage.id,title:remembered.recordPage.title});
        if(remembered&&websiteStartingPage(pageBook(),remembered.path,{chosen:remembered.pageChosen===true})?.path===remembered.path){
          pageChosen=remembered.pageChosen===true;
          documentContexts.restore(remembered.documents);
          documentContexts.set(remembered.path,{...remembered,scroll:documentContexts.get(remembered.path)?.scroll});
          const page=documentContexts.get(remembered.path);
          device=['canvas','desktop','tablet','phone'].includes(remembered.device)?remembered.device:'canvas';zoom=remembered.zoom==='actual'?'actual':'fit';
          structureOpen=remembered.structureOpen===true;sectionTab=page.sectionTab;typeTab=page.typeTab;designTab=page.designTab;previewPage=remembered.path;area=page.area;
          selectTarget(previewTarget(),{section:page.section,showControls:false});if(!sections().some(s=>s.id===openSection))openSection=null;
          tool=page.tool;selectedMedia=page.media;pendingScroll=page.scroll;
        }
      }catch{}
    }
    if(!websitePageAtPath(pageBook(),previewPage))selectTarget(null,{showControls:false});
    rememberContext();

    return `<div class="website-workbench ${expanded?'website-expanded':''}">
      <header class="website-toolbar"><h1>Website</h1><nav class="editor-jumps" aria-label="Editor areas">${button('Tools','website-jump-tools')}${button('Canvas','website-jump-canvas')}</nav></header>
      <div class="website-studio ${inspector?'':'inspector-hidden'}"><aside class="website-controls" aria-label="Editing tools" ${inspector?'':'hidden'}>
        <nav class="inspector-tasks" aria-label="Editing tools">${[['page',tr('page')],['site',tr('site')],['content',tr('content')]].map(([key,label])=>taskButton(label,key)).join('')}</nav>
        <div class="inspector-content">${inspectorContent()}</div>
        <div id="composer-structure">${structureOutline()}</div>
        <p id="website-order-help" class="website-visually-hidden">Drag to place an element. On a move handle, use Up and Down to reorder, Right to move into the previous container, Left to move out, or Escape to cancel a drag.</p>
      </aside><div class="website-inspector-resizer" role="separator" aria-label="Resize website controls" aria-orientation="vertical" tabindex="0"></div><section class="website-preview-panel" data-zoom="${zoom}" aria-label="Page canvas">
        <div class="website-preview-tools"><div class="canvas-toolbar"><label class="canvas-page">Page<select id="website-preview-page" aria-label="Page">${previewPageOptions()}</select></label>${button('Add page','website-create-page')}${button('Create homepage','website-create-home',hasHomepage(state.book)?'hidden':'')}<label>Viewport<select id="website-device" aria-label="Viewport">${[['canvas','Canvas'],['desktop','Desktop'],['tablet','Tablet'],['phone','Phone']].map(([v,l])=>option(v,l,device)).join('')}</select></label><label>Zoom<select id="website-zoom" aria-label="Zoom">${option('fit','Fit',zoom)}${option('actual','100%',zoom)}</select></label><div class="inline-actions">${canvasButton(inspector?'Hide controls':'Show controls','website-inspector')}${canvasButton(expanded?'Exit full screen':'Full screen','website-expand')}${canvasButton('Undo','website-undo',(native()?documents.draft()?.canUndo:history.undoCount)?'':'disabled')}${canvasButton('Redo','website-redo',(native()?documents.draft()?.canRedo:history.redoCount)?'':'disabled')}</div></div><p id="website-history-status" class="canvas-content-scope" role="status" ${history.trimmed?'':'hidden'}>${esc(tr('historyLimited'))}</p>
        ${textToolbar()}<p id="website-content-scope" class="canvas-content-scope" hidden></p></div><div class="website-canvas" id="website-canvas"><div id="website-preview-empty" class="website-empty" role="status" hidden><h2>No page selected</h2><p>${emptyPageDetail()}</p></div>
          <div id="website-preview-frame"><iframe id="website-draft-preview" title="Website draft preview" sandbox="allow-same-origin" ${preview?`src="${preview.baseUrl}${previewPage}"`:''}></iframe></div>
        </div><div class="canvas-status"><span id="website-preview-status" role="status"></span><span data-website-draft-status role="status"></span>${button(esc(tr('documentRetry')),'website-draft-retry','hidden')}${button('Retry preview','website-refresh','id="website-preview-retry" hidden')}<span id="website-viewport-size"></span></div>
        <p id="website-counts" class="website-visually-hidden">${counts()}</p>
      </section></div></div>`;
  }
  function pageOutline(){return `<section class="panel page-overview"><h2>${esc(websitePageAtPath(pageBook(),previewPage)?.title??'Page')}</h2><div class="inline-actions">${button('Settings','website-tool','data-tool="page-settings"')}${area==='body'?taskButton('Page layouts','library'):''}</div>${field(tr('area'),'<select id="website-editing-area" aria-label="'+esc(tr('area'))+'">'+['body',...REGION_SLOTS].map(value=>option(value,tr(value),area)).join('')+'</select>')}</section>${regionUI.view()}${area==='body'||regionUI.selected()?insertPanel():''}`;}
  function structureOutline(){
    if(switchingPage||!overridesReady())return '';
    return `<details class="composer-structure" ${tool==='page'||structureOpen?'open':''}><summary>Structure <span>${sections().length}</span></summary><ol id="website-outline">${treeOrder(sections()).map(({element:e,depth},i)=>`<li data-tree-id="${e.id}" data-reorder-item="${e.id}" class="tree-depth-${depth}"><button class="button drag-handle" data-element-drag="${e.id}" data-reorder-handle="${e.id}" aria-label="Move section ${i+1}" aria-describedby="website-order-help">&#10303;</button><button class="section-select" data-action="website-select-section" data-id="${e.id}" aria-pressed="${e.id===openSection}">${esc(sectionName(e))}${e.show?'':' <small>Hidden</small>'}</button>${button('Edit','website-edit-section',`data-id="${e.id}" aria-label="Edit ${esc(sectionName(e))}"`)}</li>`).join('')||'<li class="muted">No elements yet.</li>'}</ol><p id="website-move-status" class="website-visually-hidden" role="status"></p></details>`;
  }
  function insertPanel(){return `<section class="panel element-library"><h2>Elements</h2><label class="website-visually-hidden" for="element-search">Search elements</label><input id="element-search" type="search" placeholder="Search elements" value="${esc(paletteQuery)}"><div class="insert-grid">${ELEMENTS.map(e=>({...e,name:['link','contents','disclosure','popup','copy-text'].includes(e.kind)?tr(e.kind):e.name})).map(({kind,name,symbol})=>button(`<span class="element-symbol" aria-hidden="true">${symbol}</span><span>${name}</span>`,'website-add-section',`data-kind="${kind}" data-palette-kind="${kind}" aria-label="${name}" title="Drag onto the page, or click to insert" ${paletteQuery&&!name.toLowerCase().includes(paletteQuery.toLowerCase())?'hidden':''}`)).join('')}</div>${field('Upload image, audio or video',`<input type="file" data-upload="website" data-target="${area==='body'?scopeTarget():'region:'+regionUI.selected()?.id}" accept="image/*,audio/*,video/*">`)}</section>`;}
  function selectTarget(target,{section=null,showControls=true}={}){
    const destination=websitePageTarget(pageBook(),target)??websiteStartingPage(pageBook());
    if(!destination){previewPage='';editingScope=null;editingPage=null;openSection=null;selectedMedia=null;return;}
    previewPage=destination.path;
    editingScope=!['home','page'].includes(destination.target.split(':')[0])?destination.target:null;
    editingPage=destination.target.startsWith('page:')?destination.target.slice(5):null;
    if(showControls){tab=destination.target==='home'?'home':'pages';tool=section?'selection':'page';selectedMedia=null;}
    openSection=section;
  }
  function typography(){const a=websiteTypography(state.book),overrides=state.book.website.typography;return `<section class="panel"><h2>Website typography</h2><nav class="inspector-subtabs" aria-label="Typography tools">${[['fonts','Fonts'],['size','Size'],['spacing','Spacing']].map(([key,label])=>button(label,'website-type-tab',`data-tab="${key}" aria-pressed="${typeTab===key}"`)).join('')}</nav>${typeTab==='fonts'?['font','headingFont'].map(key=>field(key==='font'?'Body font':'Heading font',fontSelect(`data-website-type="${key}"`,overrides[key]??'',{first:[['','Theme ('+(FONT_OPTIONS.find(([id])=>id===state.book.appearance[key])?.[1]??'Custom font')+')']]})+`<div data-website-axes="${key}">${axisControls(a[key],a[key+'Axes'],`data-website-axis="${key}"`)}</div>`)).join(''):Object.entries(TYPOGRAPHY_RANGES).filter(([key])=>typeTab==='size'?['fontSize','headingScale'].includes(key):!['fontSize','headingScale'].includes(key)).map(([key,[min,max,step]])=>field({fontSize:'Body text size (px)',lineHeight:'Line spacing',headingScale:'Heading scale',letterSpacing:'Letter spacing (px)',paragraphSpacing:'Paragraph spacing (em)'}[key],`<input type="number" data-website-type="${key}" min="${min}" max="${max}" step="${step}" value="${overrides[key]??''}" placeholder="${a[key]}">`)).join('')}${button('Reset website typography','website-type-reset')}</section>`;}
  function customPages(){
    if(!editingScope&&!state.book.pages.some(p=>p.id===editingPage))editingPage=state.book.pages[0]?.id??null;
    const p=pageModel();
    const target=scopeTarget(),generated=editingScope&&websitePageTarget(pageBook(),editingScope);

    return `<section class="panel"><details class="page-settings" open><summary>Page settings</summary>${p?`${field('Page title',`<input data-authored-page="title" maxlength="160" required value="${esc(p.title)}">`)}${!p.share?'<p>This page is excluded from export.</p>':''}${field('Page introduction',`<textarea data-authored-page="body" rows="4" maxlength="60000">${esc(p.body)}</textarea>`)}<details><summary>Page actions</summary><div class="inline-actions">${button(p.share?'Exclude from export':'Include in export','website-include-page',`data-id="${p.id}"`)}${button('Page logos','branding',`data-target="page:${p.id}"`)}${button('Remove page','delete-page',`data-id="${p.id}"`)}</div></details>`:generated?`<h2>${esc(generated.title)}</h2>${field('Section placement',`<select data-page-layout="placement">${[['before','Before the existing content'],['after','After the existing content'],...(!target.startsWith('entry:')?[['replace','Use these sections as the page']]:[])].map(([v,l])=>option(v,l,layoutFor(target).placement)).join('')}</select>`)}`:'<p class="muted">No pages yet.</p>'}${p||generated?pageHeadingControls(target):''}</details></section>`;
  }
  function pageHeadingControls(target){const l=layoutFor(target);return `<details><summary>Page header</summary><label class="checkbox"><input type="checkbox" data-page-layout="showHeading" ${l.showHeading?'checked':''}><span>Show page header</span></label>${field('Display heading',`<input data-page-layout="heading" maxlength="180" value="${esc(l.heading)}" placeholder="Use page title">`)}${field('Display introduction',`<textarea data-page-layout="description" rows="3" maxlength="1500">${esc(l.description)}</textarea>`)}${native()&&state.book.website.layouts.some(layout=>layout.target===target)?button(esc(tr('documentLayoutDefault')),'website-layout-default'):''}</details>`;}

  function layout(){const d=state.book.website.design;return `<nav class="inspector-subtabs" aria-label="Site design">${[['layout','Layout'],['colors','Colors']].map(([key,label])=>button(label,'website-design-tab',`data-tab="${key}" aria-pressed="${designTab===key}"`)).join('')}</nav>${designTab==='colors'?`<section class="panel"><h2>Website colors</h2>${WEBSITE_COLORS.map(key=>field({background:'Page background',surface:'Card background',text:'Text',muted:'Secondary text',accent:'Links & accents',border:'Borders'}[key],`<input type="color" data-website-color="${key}" value="${esc(state.book.website.palette[key]??state.book.appearance[key])}">`)).join('')}${button('Reset website colors','website-colors-reset')}</section>`:layoutFields()}`;}
  function layoutFields(){const d=state.book.website.design;return `<section class="panel"><h2>Site layout</h2>${field('Page width',`<input type="range" data-site-design="width" min="720" max="1600" step="20" value="${d.width}"><output id="site-width-value">${d.width} px</output>`)}${field('Site navigation',`<select data-site-design="navigation">${option('top','Across the top',d.navigation)}${option('side','Side navigation',d.navigation)}${option('none',tr('navigation_none'),d.navigation)}</select>`)}${field('Page heading layout',`<select data-site-design="heading">${option('compact','Compact',d.heading)}${option('split','Title and introduction side by side',d.heading)}${option('center','Centered',d.heading)}</select>`)}<label class="checkbox"><input type="checkbox" data-site-design="contents" ${d.contents?'checked':''}><span>Section links on long records</span></label></section><section class="panel"><div class="inline-actions">${button('Website logos','branding','data-target="home"')}</div></section>`;}
  const sectionName=s=>s.title||({download:t('websiteMedia','downloadElement'),popup:tr('popup'),'copy-text':tr('copy-text'),disclosure:tr('disclosure'),contents:tr('contents'),container:'Container',heading:'Heading',hero:'Introduction',gallery:'Gallery',text:'Text',callout:'Callout',media:'Research media',link:'Link',divider:'Divider',asset:'Media',projects:'Projects',records:'Records',pages:'Pages'}[s.kind]??s.kind);
  function previewPageOptions(){
    const {choices,more}=websitePageChoices(pageBook(),previewPage),text=key=>t('websitePages',key);
    if(!choices.length)return '<option value="">'+esc(publicationSourceCount(state)?t('publicationSources','choosePage'):text('noPages'))+'</option>'+(publicationSourceCount(state)?'<option value="find">'+esc(text('find'))+'</option>':'');
    return (!previewTarget()?'<option value="" selected>'+esc(text('noPageSelected'))+'</option>':'')+['home','page','project','notebook','entry'].map(kind=>{
      const items=choices.filter(p=>p.target.split(':')[0]===kind),options=items.map(p=>option(p.path,kind==='home'?text('home'):p.title,previewPage)).join('');
      return kind==='home'?options:items.length?'<optgroup label="'+esc(text(kind))+'">'+options+'</optgroup>':'';
    }).join('')+(more||native()&&documents.count('pages')>pageLabels.length||publicationSourceCount(state)||research.enabled()&&state.workspaceOutline?.total>0?'<option value="find">'+esc(text('find'))+'</option>':'');
  }
  function previewTarget(){return websitePageAtPath(pageBook(),previewPage)?.target??null;}
  async function changePreviewPage(path){
   const request=++pageChange;storePageContext();releaseRichEditor();overrideController?.abort();overrideController=null;overrideError='';switchingPage=native();if(switchingPage)refreshTools();
   try{if(native()){const id=/^pages[/]([a-f0-9-]{36})[.]html$/.exec(path)?.[1]??null;await documents.selectPage(id);if(request!==pageChange)return;}previewPage=path;pageChosen=true;await ensureOverrides(previewTarget());if(request!==pageChange)return;restorePageContext();}
   catch(error){if(request===pageChange)overrideError=error.message;throw error;}
   finally{if(request===pageChange){switchingPage=false;if(state.page==='website'){refreshTools();schedulePreview();document.querySelector('#website-preview-page')?.focus({preventScroll:true});}}}
  }
  function previewSections(){const target=previewTarget();if(!target)return [];if(area!=='body')return resolveRegion(state.book.website,target,area)?.sections??[];return target==='home'?state.book.website.home.sections:target.startsWith('page:')?state.book.pages.find(p=>p.id===target.slice(5))?.sections??[]:layoutFor(target).sections;}
  function focusPreviewSection(id){if(tool!=='selection')toolTrail.push({tool,scroll:window.scrollY});const target=previewTarget();tab=target==='home'?'home':'pages';editingScope=target!=='home'&&!target.startsWith('page:')?target:null;editingPage=target.startsWith('page:')?target.slice(5):null;openSection=id;selectedMedia=null;tool=id?'selection':'page';sectionTab='content';revealSection=id;pageOptions=false;inspector=true;}
  function textToolbar(){
    const selected=previewSections().find(s=>s.id===openSection),editable=tool==='selection'&&!selectedMedia&&selected&&['text','hero','callout'].includes(selected.kind);
    return `<div id="website-text-tools" class="website-text-tools" ${editable?'':'hidden'}>${editable?textTools():''}</div>`;
  }
  function mountCanvasEditor(doc){
    releaseRichEditor();const selected=previewSections().find(s=>s.id===openSection);if(tool!=='selection'||selectedMedia||!selected||!['text','hero','callout'].includes(selected.kind))return;
    let block=activeRoot(doc)?.querySelector(`[data-section-id="${selected.id}"]`);if(!block){const kind=compositionKind();let composition=doc.querySelector(`[data-composition="${kind}"]`);if(!composition){composition=doc.createElement('div');composition.className='page-composition';composition.dataset.composition=kind;doc.querySelector('main').append(composition);}block=doc.createElement('section');block.dataset.sectionId=selected.id;block.className='home-section section-'+selected.kind;const copy=doc.createElement('div');copy.className=selected.kind==='hero'?'hero-copy':'prose';if(selected.kind==='hero'){const prose=doc.createElement('div');prose.className='prose';copy.append(prose);}block.append(copy);composition.append(block);}
    const mount=block.querySelector(selected.kind==='hero'?'.hero-copy>.prose':':scope>.prose'),toolbar=document.querySelector('#website-text-tools');if(!mount||!toolbar)return;
    richMount={node:mount,attributes:[...mount.attributes].map(a=>[a.name,a.value])};richId=selected.id;richContext=websiteContext(state);richEditor=mountRichText({mount,toolbar,section:selected,getDestinations:linkDestinations,revealSelection:view=>{surface?.measure();const tools=document.querySelector(".website-preview-tools"),top=Math.max(document.querySelector(".topbar")?.getBoundingClientRect().bottom??0,getComputedStyle(tools).position==="sticky"?tools.getBoundingClientRect().bottom:0);surface?.reveal(view.coordsAtPos(view.state.selection.head),top);return true;},initialState:richStates.get(selected.id),onError:message=>notify(message,true),onChange:value=>{checkpoint('rich:'+selected.id);const current=previewSections().find(s=>s.id===selected.id);if(!current)return;current.richText=value;current.format='rich';current.body=richTextPlain(value);refreshRichStyles(doc,value);dirty();refreshSummary();previewKey=null;schedulePreview();updateHistoryControls();}});
  }

  function emptyPageDetail(){return publicationSourceCount(state)?esc(t('publicationSources','choosePageDetail')):'Use Add page or Create homepage above the canvas. A homepage is optional.';}
  function emptyPage(){return `<section class="panel"><h2>${publicationSourceCount(state)?esc(t('publicationSources','choosePage')):'Create a page'}</h2><p>${emptyPageDetail()}</p></section>`;}
  function siteFields(){const b=state.book,identity=siteIdentity(b);return `${field('Website title',`<input data-site="title" value="${esc(identity.title)}" maxlength="160" aria-describedby="website-title-help">`)}<p id="website-title-help" class="muted">${esc(tr('titleHelp'))}</p>${field('Website description',`<textarea data-site="description" rows="3" maxlength="1500">${esc(identity.description)}</textarea>`)}`;}
  function home(){
    const b=state.book,h=b.website.home;
    return `<section class="panel"><details class="page-settings" open><summary>Home page settings</summary>${field('Homepage heading',`<input data-home="title" value="${esc(h.title??siteIdentity(b).title)}" maxlength="160">`)}<label class="checkbox"><input type="checkbox" data-home="showTitle" ${h.showTitle?'checked':''}><span>Show homepage heading</span></label>${field('Homepage introduction',`<textarea data-home="introduction" rows="4" maxlength="1500">${esc(homeIntroduction(b))}</textarea>`)}</details>${button('Remove homepage','website-remove-home')}</section>`;
  }
  function sectionEditor(s,i){
    const style=sectionStyle(s);
    return `<li data-section-editor="${s.id}"><nav class="inspector-subtabs" aria-label="Section tools">${[['content','Content'],['layout','Layout'],['style','Style'],...(s.kind==='hero'?[['link','Image & link']]:[])].map(([key,label])=>button(label,'website-section-tab',`data-tab="${key}" aria-pressed="${sectionTab===key}"`)).join('')}</nav>
      ${sectionTab==='content'?`${field('Section heading',`<input data-home-section="${s.id}" data-key="title" value="${esc(s.title)}" maxlength="160">`)}
      ${['text','callout','hero'].includes(s.kind)?button('Edit text on page','website-edit-text',`data-id="${s.id}"`):s.kind==='media'?mediaUI.selector(s,{research:true,label:t('websiteMedia','research')}):s.kind==='download'?websiteDownloadFields(s,{book:state.book,esc,field,selector:mediaUI.selector}):s.kind==='asset'?assetFields(s):s.kind==='gallery'?button('Choose and arrange images','website-tool','data-tool="gallery"'):s.kind==='link'?`${field(t('websitePages','linkDestination'),`<input data-home-section="${s.id}" data-key="href" value="${esc(s.href)}">`)}${button(esc(t('websitePages','chooseLink')),'website-choose-link',`data-link-owner="${s.id}"`)}${button(esc(t('websitePages','chooseSection')),'website-choose-section',`data-link-owner="${s.id}"`)}${field('Link label',`<input data-home-section="${s.id}" data-key="label" value="${esc(s.label)}" maxlength="160">`)}${field('Link description',`<textarea data-home-section="${s.id}" data-key="body" rows="2">${esc(s.body)}</textarea>`)}${linkFields(s)}`:s.kind==='container'?containerFields(s):['popup','copy-text'].includes(s.kind)?websitePopupFields(s,esc):s.kind==='disclosure'?websiteDisclosureFields(s,esc):s.kind==='heading'?field('Heading level',`<select data-home-section="${s.id}" data-key="level">${[1,2,3,4,5,6].map(n=>option(String(n),'Heading '+n,String(s.level))).join('')}</select>`):s.kind==='contents'?'<p>'+esc(tr('contentsHelp'))+'</p>':s.kind==='divider'?'':`${field('Collection layout',`<select data-home-section="${s.id}" data-key="layout">${[['inherit','Theme'],['grid','Cards'],['list','Single column'],['editorial','Editorial rows']].map(([v,l])=>option(v,l,s.layout)).join('')}</select>`)}${['projects','records'].includes(s.kind)?`${field('Project',`<select data-block-filter="${s.id}" data-key="projectId"><option value="">All included projects</option>${pageBook().projects.map(p=>option(p.id,p.title,s.filter?.projectId)).join('')}</select>`)}${s.kind==='records'?field('Tag',`<input data-block-filter="${s.id}" data-key="tag" maxlength="40" value="${esc(s.filter?.tag??'')}">`):''}${field(t('websiteFeeds','totalLimit'),`<input type="number" min="0" step="1" data-block-filter="${s.id}" data-key="limit" value="${s.filter?.limit??0}">`)}`:''}`}
      ${actionUI.content(s)}
      ${FEED_KINDS.includes(s.kind)?websiteFeedFields(s,{esc,field,option}):''}
      `:sectionTab==='link'?heroFields(s)+linkFields(s):sectionTab==='layout'?`${s.kind==='container'?containerFields(s):''}<div class="block-style-fields">${[['width','Width',[['full','Full'],['half','Half'],['third','One third'],['two-thirds','Two thirds']]],['surface','Surface',[['none','None'],['card','Card'],['tint','Accent tint']]],['space','Spacing',[['compact','Compact'],['normal','Normal'],['roomy','Roomy']]]].map(([key,label,values])=>field(label,`<select data-block-style="${s.id}" data-key="${key}">${values.map(([v,l])=>option(v,l,style[key])).join('')}</select>`)).join('')}</div>${alignmentFields(s)}`:advancedStyle(s)+actionUI.sectionStyle(s)}
      <details class="element-actions"><summary>Section actions</summary><label class="checkbox"><input type="checkbox" aria-label="Include section ${i+1}" data-home-section="${s.id}" data-key="show" ${s.show?'checked':''}>Show section</label><div class="inline-actions">${button('Up','website-section-up',`data-index="${i}" aria-label="Move section ${i+1} up" ${i===0?'disabled':''}`)}${button('Down','website-section-down',`data-index="${i}" aria-label="Move section ${i+1} down" ${i===sections().length-1?'disabled':''}`)}${button('Duplicate','website-section-duplicate',`data-id="${s.id}"`)}${button('Remove','website-section-remove',`data-id="${s.id}"`)}</div></details></li>`;
  }
  function alignmentFields(s){
    const collection=['projects','records','pages'].includes(s.kind),fields=[];
    if(!['container','divider'].includes(s.kind))fields.push(['headingAlign','Heading alignment']);
    if(collection||['text','callout','hero','link','popup','copy-text','download'].includes(s.kind))fields.push(['bodyAlign','Body alignment']);
    if(collection)fields.push(['itemHeadingAlign','Item heading alignment'],['detailsAlign','Details alignment']);
    if(['media','asset','gallery','hero'].includes(s.kind))fields.push(['captionAlign','Caption alignment']);
    if(['hero','link','download'].includes(s.kind))fields.push(['buttonAlign','Button alignment']);
    return fields.length?`<fieldset class="section-alignment"><legend>Text alignment</legend><div class="block-style-fields">${fields.map(([key,label])=>field(label,`<select data-block-style="${s.id}" data-key="${key}">${[['start','Start'],['center','Center'],['end','End'],...(key==='bodyAlign'?[['justify','Justify']]:[])].map(([value,name])=>option(value,name,s.style?.[key]??s.style?.align??'start')).join('')}</select>`)).join('')}</div></fieldset>`:'';
  }
  function containerFields(s){return `${field('Container layout',`<select data-home-section="${s.id}" data-key="layout">${[['row','Side by side'],['column','Stacked'],['grid','Grid']].map(([v,l])=>option(v,l,s.layout)).join('')}</select>`)}<div class="block-style-fields">${field('Columns',`<select data-home-section="${s.id}" data-key="columns">${[1,2,3,4].map(n=>option(String(n),String(n),String(s.columns))).join('')}</select>`)}${field('Gap (px)',`<input type="number" min="0" max="120" data-home-section="${s.id}" data-key="gap" value="${s.gap}">`)}</div>`;}
  function mediaRecordId(scope,id,sectionId=scope.split('#')[1]){
    if(/^(entry|cover):/.test(scope))return scope.split('#')[0].split(':')[1];
    const section=[...state.book.website.home.sections,...state.book.pages.flatMap(p=>p.sections),...state.book.website.layouts.flatMap(l=>l.sections),...regionsOf(state.book.website).definitions.flatMap(r=>r.sections)].find(s=>s.id===sectionId);
    return section?.entryId??state.book.entries.find(e=>e.attachments.some(a=>a.id===id))?.id;
  }
  function mediaInspector(){
    const {id,scope,entryId}=selectedMedia,entry=sourcePages.record(entryId)??(research.enabled()?research.cachedRecord():state.book.entries.find(e=>e.id===entryId));
    if(research.enabled()&&entryId&&entry?.id!==entryId){if(!research.recordError(entryId))void research.record(entryId).catch(()=>{}).finally(()=>{if(selectedMedia?.entryId===entryId)refreshTools();});return '<section class="panel"><p role="status">'+esc(research.recordError(entryId)??t('websiteContent','loading'))+'</p>'+button(esc(t('websiteContent','retry')),'website-media-retry')+'</section>';}
    if(native()&&!entryId){const result=mediaUI.selected(id);if(!result.item)return '<section class="panel" data-native-media-selected="'+esc(id)+'"><p role="'+(result.error?'alert':'status')+'">'+esc(result.error?.message??tr('documentLoading'))+'</p>'+(result.error?button(esc(tr('documentLoadRetry')),'website-media-retry'):'')+'</section>';}
    const a=entry?.attachments.find(a=>a.id===id)??state.book.website.assets.find(a=>a.id===id);if(!a)return '<section class="panel">This media is unavailable.</section>';
    const m=mediaStyle(state.book.website,scope,id),cover=scope.startsWith('cover:');
    return `<section class="panel"><h2>${cover?'Record cover':'Media'}</h2><nav class="inspector-subtabs" aria-label="Media tools">${[['content','Description'],['layout','Size & crop'],['link','Link']].map(([key,label])=>button(label,'website-section-tab',`data-tab="${key}" aria-pressed="${sectionTab===key}"`)).join('')}</nav>
      ${sectionTab==='content'?`${cover?field('Cover image',`<select data-record-cover="${entryId}"><option value="">No cover</option>${entry.attachments.filter(a=>a.kind==='image').map(a=>option(a.id,a.caption||a.alt||'Image',id)).join('')}</select>`):''}${field('Alternative text',`<textarea data-media-style="alt" rows="2" maxlength="1500">${esc(m.alt??a.alt)}</textarea>`)}${!cover?field('Caption',`<textarea data-media-style="caption" rows="2" maxlength="1500">${esc(m.caption??a.caption)}</textarea>`):''}`:sectionTab==='layout'?`${field('Image width (%)',`<input type="number" data-media-style="width" value="${m.width}" min="10" max="100">`)}${field('Image proportions',`<select data-media-style="ratio">${[['original','Original'],['square','Square'],['landscape','Landscape 4:3'],['portrait','Portrait 3:4'],['wide','Wide 16:9']].map(([v,l])=>option(v,l,m.ratio)).join('')}</select>`)}${field('Image fit',`<select data-media-style="fit">${option('contain','Show entire image',m.fit)}${option('cover','Fill and crop',m.fit)}</select>`)}`:`${field(t('websitePages','imageLink'),`<input data-media-style="link" value="${esc(m.link)}" placeholder="${esc(t('websitePages','noLink'))}">`)}${button(esc(t('websitePages','chooseLink')),'website-choose-link','data-link-owner="media"')}${button(esc(t('websitePages','chooseSection')),'website-choose-section','data-link-owner="media"')}${field(t('websitePages','openImageLink'),`<select data-media-style="target">${option('_self',t('websitePages','sameTab'),m.target)}${option('_blank',t('websitePages','newTab'),m.target)}</select>`)}`}
      ${button('Reset image presentation','website-media-style-reset')}</section>`;
  }
  function advancedStyle(s){return `<div class="section-design">${field('Section text size (px)',`<input type="number" min="14" max="48" placeholder="Theme" data-style-value="${s.id}" data-key="fontSize" value="${s.style?.fontSize??''}">`)}<div class="block-style-fields">${[['padding','Padding',0,100],['radius','Corners',0,40]].map(([key,label,min,max])=>field(label,`<input type="number" min="${min}" max="${max}" placeholder="Theme" data-style-value="${s.id}" data-key="${key}" value="${s.style?.[key]??''}">`)).join('')}${[['background','Background'],['color','Text color']].map(([key,label])=>field(label,`<input type="text" pattern="#[0-9A-Fa-f]{6}" maxlength="7" placeholder="Theme" data-style-value="${s.id}" data-key="${key}" value="${s.style?.[key]??''}">`)).join('')}</div>${button('Reset section style','website-style-reset',`data-id="${s.id}"`)}</div>`;}
  function linkFields(s){return `<details><summary>Link behaviour</summary>${field('Open button link',`<select data-home-section="${s.id}" data-key="linkTarget">${option('_self','Same tab',s.linkTarget??'_self')}${option('_blank','New tab',s.linkTarget)}</select>`)}${field('Button link title',`<input maxlength="200" data-home-section="${s.id}" data-key="linkTitle" value="${esc(s.linkTitle??'')}">`)}<label class="checkbox"><input type="checkbox" data-home-section="${s.id}" data-key="linkNoFollow" ${s.linkNoFollow?'checked':''}><span>Mark button link as nofollow</span></label></details>`;}
  function heroFields(s){return `${mediaUI.selector(s,{images:true,label:t('websiteMedia','hero'),empty:t('websiteMedia','noImage')})}${field('Button label',`<input maxlength="160" data-home-section="${s.id}" data-key="label" value="${esc(s.label)}">`)}${field(t('websitePages','linkDestination'),`<input data-home-section="${s.id}" data-key="href" value="${esc(s.href)}">`)}${button(esc(t('websitePages','chooseLink')),'website-choose-link',`data-link-owner="${s.id}"`)}${button(esc(t('websitePages','chooseSection')),'website-choose-section',`data-link-owner="${s.id}"`)}`;}
  function assetFields(section){
    if(native()&&section.assetId){const result=mediaUI.selected(section.assetId);if(!result.item)return '<div data-native-media-selected="'+esc(section.assetId)+'"><p role="'+(result.error?'alert':'status')+'">'+esc(result.error?.message??tr('documentLoading'))+'</p>'+(result.error?button(esc(tr('documentLoadRetry')),'website-media-retry'):'')+mediaUI.selector(section)+'</div>';}
    const asset=state.book.website.assets.find(a=>a.id===section.assetId);if(!asset)return `<div class="empty-media-slot"><p>${esc(t('websiteMedia','elementEmpty'))}</p>${field(t('websiteMedia','elementUpload'),`<input type="file" data-upload="website" data-target="element:${section.id}" accept="image/*,audio/*,video/*">`)}${mediaUI.selector(section)}</div>`;
    const display=mediaStyle(state.book.website,presentationTarget()+'#'+section.id,asset.id);
    return `${mediaUI.selector(section)}${field(t('websiteMedia','elementCaption'),`<textarea rows="2" maxlength="1500" data-section-media="${section.id}" data-key="caption">${esc(display.caption??asset.caption)}</textarea>`)}${field(t('websiteMedia','alt'),`<input maxlength="1500" data-section-media="${section.id}" data-key="alt" value="${esc(display.alt??asset.alt)}">`)}${asset.kind!=='image'?field(t('websiteMedia','transcript'),`<textarea rows="3" maxlength="60000" data-site-asset="${asset.id}" data-key="transcript">${esc(asset.transcript)}</textarea>`):''}`;
  }
  async function acceptAsset(asset,target){
    if(native()){try{await documents.item('assets',asset.id);}catch(reason){if(reason.code!=='NOT_FOUND')throw reason;}}
    previewKey=null;
    const existing=state.book.website.assets.find(a=>a.id===asset.id);
    const insert=async()=>{if(existing)return;if(native())await documents.stageAsset({...asset,caption:'',alt:'',transcript:''});else state.book.website.assets.push({...asset,caption:'',alt:'',transcript:''});};
    if(existing&&existing.kind!==asset.kind)throw new Error('The prepared media type does not match this library item.');
    if(!native()&&!existing&&state.book.website.assets.length>=500)throw new Error('This workspace has reached the current limit of 500 website media files.');
    if(target.startsWith('element:')){const id=target.slice(8),section=sections().find(e=>e.id===id);if(!section)throw new Error('The selected element was removed.');if((section.kind==='download')!==(asset.kind==='file'))throw new Error('Choose a compatible element for this file.');checkpoint();await insert();section.assetId=asset.id;openSection=id;tool='selection';return;}

    if(target==='library'){checkpoint();await insert();tool='media';mediaUI.uploaded(asset.id);return;}
    if(target.startsWith('region:')){const region=regionsOf(state.book.website).definitions.find(r=>r.id===target.slice(7));if(!region)throw new Error(tr('missing'));if(region.sections.length>=MAX_ELEMENTS)throw new Error(tr('elementLimit'));checkpoint();await insert();const section={...newElement(asset.kind==='file'?'download':'asset'),assetId:asset.id};region.sections.push(section);if(regionUI.selected()?.id===region.id)openSection=section.id;return;}
    const destination=websitePageTarget(pageBook(),target);
    if(!destination)throw new Error('The destination was removed. The uploaded file remains private.');
    const page=target.startsWith('page:')?state.book.pages.find(p=>p.id===target.slice(5)):null;
    const list=page?(page.sections??[]):target==='home'?state.book.website.home.sections:layoutFor(target).sections;
    if(list.length>=MAX_ELEMENTS)throw new Error('This page has reached its element limit.');
    checkpoint();await insert();const section={...newElement(asset.kind==='file'?'download':'asset'),assetId:asset.id};
    area='body';editingPage=page?.id??null;editingScope=!page&&target!=='home'?target:null;tab=target==='home'?'home':'pages';previewPage=destination.path;setSections([...list,section]);openSection=section.id;sectionTab='content';selectedMedia=null;previewPage=destination.path;
  }

  function capture(){return {editor:{path:previewPage,area,section:openSection,media:structuredClone(selectedMedia),tool,sectionTab},branding:structuredClone(state.book.branding),website:structuredClone(state.book.website),pages:structuredClone(state.book.pages),selection:{projects:state.book.projects.map(p=>({id:p.id,share:p.share})),entries:[],draft:selection.snapshot()}};}
  function restore(value){
    state.book.branding=value.branding;state.book.website=value.website;state.book.pages=value.pages;
    if(value.editor){area=value.editor.area??'body';previewPage=value.editor.path;selectTarget(previewTarget(),{section:value.editor.section});selectedMedia=value.editor.media;tool=value.editor.tool;sectionTab=value.editor.sectionTab;}
    for(const p of value.selection.projects){const item=state.book.projects.find(v=>v.id===p.id);if(item)item.share=p.share;}
    if(value.selection.draft){selection.restore(value.selection.draft);research.invalidate();contentPages.refresh();}
  }
  function syncHistory(){if(historyRevision!==state.book.revision||historyBook!==state.book){historyBook=state.book;history.clear();historyRevision=state.book.revision;}}
  function checkpoint(key=null){if(native())return;syncHistory();history.checkpoint(capture,key);}
  function refreshSummary(){
    const node=document.querySelector('#website-counts');if(node)node.textContent=counts();
    const scope=document.querySelector('#website-content-scope');if(!scope)return;
    const selected=summary(),book=state.book;
    const excluded=research.enabled()||selected.projects.length<book.projects.length||selected.entries.length<book.entries.length||selected.pages.length<book.pages.length||book.entries.some(e=>e.attachments.some(a=>!a.share));
    scope.hidden=!excluded;
    scope.textContent=tr('scope');
  }
  function updateHistoryControls(){
    const status=document.querySelector('#website-history-status');if(status)status.hidden=native()||!history.trimmed;
    document.querySelectorAll('[data-action=website-undo]').forEach(b=>b.disabled=!(native()?documents.draft()?.canUndo:history.undoCount));
    document.querySelectorAll('[data-action=website-redo]').forEach(b=>b.disabled=!(native()?documents.draft()?.canRedo:history.redoCount));
  }
  function changed(redraw=false){updateHistoryControls();previewKey=null;dirty();if(redraw)refreshTools();refreshSummary();schedulePreview();}
  function input(el,{discrete=false}={}){
    if(native()&&navigationUI.input(el))return true;
    if(actionUI.input(el,{discrete})||mediaUI.input(el)||contentUI.input(el)||regionUI.input(el))return true;
    if(el.id==='website-editing-area'){releaseRichEditor();area=el.value;openSection=null;selectedMedia=null;toolTrail=[];refreshTools();schedulePreview();return true;}
    if(el.id==='element-search'){paletteQuery=el.value;document.querySelectorAll('[data-palette-kind]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(paletteQuery.toLowerCase()));return true;}

    if(el.dataset.sectionMedia){const section=sections().find(s=>s.id===el.dataset.sectionMedia);if(!section)return true;checkpoint('section-media:'+section.id+el.dataset.key);const scope=presentationTarget()+'#'+section.id,id=section.assetId,list=state.book.website.presentation.media;let item=list.find(m=>m.scope===scope&&m.id===id);if(!item){item={...mediaStyle(state.book.website,scope,id),scope,id};list.push(item);}item[el.dataset.key]=el.value;changed();return true;}
    if(el.dataset.websiteColor){checkpoint('color:'+el.dataset.websiteColor);state.book.website.palette[el.dataset.websiteColor]=el.value;changed();return true;}
    if(el.dataset.mediaStyle&&selectedMedia){el.setCustomValidity('');checkpoint(discrete?null:'media:'+JSON.stringify(selectedMedia)+el.dataset.mediaStyle);const {id,scope}=selectedMedia,list=state.book.website.presentation.media;let m=list.find(m=>m.id===id&&m.scope===scope);if(!m){m={...mediaStyle(state.book.website,scope,id),id,scope};list.push(m);}m[el.dataset.mediaStyle]=el.dataset.mediaStyle==='width'?Number(el.value):el.value;changed();return true;}
    if(el.dataset.recordCover){checkpoint();const entryId=el.dataset.recordCover,list=state.book.website.presentation.covers;state.book.website.presentation.covers=[...list.filter(c=>c.entryId!==entryId),...(el.value==='auto'?[]:[{entryId,attachmentId:el.value||null}])];if(selectedMedia){if(el.value)selectedMedia.id=el.value;else{selectedMedia=null;tool='page';}}changed(true);return true;}

    if(el.matches?.('.website-controls input,.website-controls textarea,#website-text-tools input'))el.setCustomValidity('');
    if(['styleValue','pageLayout','site','home','homeSection','menu','projectShare','publishEntry','pageShare','websiteMedia','authoredPage','websiteType','siteDesign','blockStyle','blockFilter','siteAsset'].some(k=>el.dataset[k]!==undefined))checkpoint(discrete?null:JSON.stringify(el.dataset));
    if(el.dataset.websiteAxis){if(!el.checkValidity())return true;const key=el.dataset.websiteAxis+'Axes',axes=state.book.website.typography[key]??={};if(el.value==='')delete axes[el.dataset.fontAxis];else axes[el.dataset.fontAxis]=Number(el.value);changed();return true;}
    if(el.dataset.websiteType){const key=el.dataset.websiteType;if(['font','headingFont'].includes(key)){delete state.book.website.typography[key+'Axes'];const controls=document.querySelector(`[data-website-axes="${key}"]`);if(controls)controls.innerHTML=axisControls(el.value||state.book.appearance[key],{},`data-website-axis="${key}"`);}if(el.value==='')delete state.book.website.typography[key];else state.book.website.typography[key]=['font','headingFont'].includes(key)?el.value:Number(el.value);changed();return true;}
    if(library.input(el))return true;
    if(el.id==='website-active-section'){focusPreviewSection(el.value);render();return true;}
    if(el.dataset.pageLayout){changeLayout(el.dataset.pageLayout,el.type==='checkbox'?el.checked:el.value);changed();return true;}
    if(el.id==='website-device'||el.id==='website-zoom'){if(el.id==='website-device')device=el.value;else zoom=el.value;document.querySelector('.website-preview-panel').dataset.zoom=zoom;fitPreview();rememberContext();return true;}

    if(el.dataset.siteDesign){state.book.website.design[el.dataset.siteDesign]=el.type==='checkbox'?el.checked:el.type==='range'?Number(el.value):el.value;const output=document.querySelector('#site-width-value');if(output)output.textContent=state.book.website.design.width+' px';changed();return true;}
    if(el.dataset.authoredPage){pageModel()[el.dataset.authoredPage]=el.type==='checkbox'?el.checked:el.value;if(pageModel().share)previewPage='pages/'+pageModel().id+'.html';changed();return true;}
    if(el.dataset.styleValue){const section=previewSections().find(s=>s.id===el.dataset.styleValue)??sections().find(s=>s.id===el.dataset.styleValue);section.style={...sectionStyle(section)};if(el.value==='')delete section.style[el.dataset.key];else section.style[el.dataset.key]=['fontSize','padding','radius'].includes(el.dataset.key)?Number(el.value):el.value;changed();return true;}
    if(el.dataset.blockStyle){const s=sections().find(s=>s.id===el.dataset.blockStyle);s.style={...sectionStyle(s),[el.dataset.key]:el.value};changed();return true;}
    if(el.dataset.blockFeed){checkpoint(discrete?null:JSON.stringify(el.dataset));const s=sections().find(s=>s.id===el.dataset.blockFeed);changed(changeWebsiteFeed(s,el));return true;}
    if(el.dataset.blockFilter){const s=sections().find(s=>s.id===el.dataset.blockFilter);s.filter={projectId:null,tag:'',limit:0,...s.filter,[el.dataset.key]:el.dataset.key==='limit'?Number(el.value):el.value||null};if(el.dataset.key==='tag')s.filter.tag=el.value;changed();return true;}
    if(el.id==='website-preview-page'){if(el.value==='find'){el.value=previewPage;pagePicker.open(previewTarget());}else void changePreviewPage(el.value).catch(error=>notify(error.message,true));return true;}
    if(el.dataset.siteAsset){const asset=state.book.website.assets.find(a=>a.id===el.dataset.siteAsset);asset[el.dataset.key]=el.value;changed();return true;}
    if(el.dataset.site){if(hasHomepage(state.book)){const h=state.book.website.home;if(h.title===null)h.title=siteIdentity(state.book).title;if(h.introduction===undefined)h.introduction=homeIntroduction(state.book);}state.book.website[el.dataset.site]=el.value;changed();return true;}
    if(el.dataset.home){state.book.website.home[el.dataset.home]=el.type==='checkbox'?el.checked:el.value;changed();return true;}
    if(el.dataset.homeSection){const s=sections().find(s=>s.id===el.dataset.homeSection);if(!s)return true;
      s[el.dataset.key]=el.type==='checkbox'?el.checked:['columns','gap','level','dialogWidth'].includes(el.dataset.key)?Number(el.value):el.value;if(el.dataset.key==='title'){const heading=document.querySelector('[data-selection-title]');if(heading)heading.textContent=sectionName(s);}changed();return true;
    }
    if(el.dataset.menu!==undefined){const items=navigationItems(pageBook(),summary());items[Number(el.dataset.menu)][el.dataset.column]=el.type==='checkbox'?el.checked:el.dataset.column==='parent'?el.value||null:el.value;state.book.website.navigation=storedNavigation(items);changed(el.dataset.column==='parent');return true;}
    if(el.dataset.projectShare){state.book.projects.find(p=>p.id===el.dataset.projectShare).share=el.checked;changed(true);return true;}
    if(el.dataset.publishEntry){selection.share(el.dataset.publishEntry,el.checked,el.closest('[data-project]')?.dataset.project);if(research.enabled()){research.invalidate();contentPages.refresh();}changed(true);return true;}
    if(el.dataset.pageShare){state.book.pages.find(p=>p.id===el.dataset.pageShare).share=el.checked;changed();return true;}
    if(el.dataset.websiteMedia){selection.media(el.dataset.record,el.dataset.websiteMedia,el.checked);if(research.enabled()){research.invalidate();contentPages.refresh();}const record=el.closest('.website-record'),details=record?.querySelector('details'),isOpen=details?.open;changed(true);if(isOpen)document.querySelector(`[data-record-cover="${el.dataset.record}"]`)?.closest('details').setAttribute('open','');return true;}
    return false;
  }
  function reorder(kind,from,to,key){
    checkpoint();
    if(kind==='sections'){const element=sections().find(e=>e.id===key);if(!element)return;const siblings=childrenOf(sections(),element.parentId??null),i=siblings.findIndex(e=>e.id===key),before=to<from?siblings[Math.max(0,i-1)]?.id:siblings[i+2]?.id??null;setSections(moveElement(sections(),key,element.parentId??null,before));}
    else state.book.website.navigation=storedNavigation(moveItem(navigationItems(pageBook(),summary()),from,to));
    changed(true);document.querySelector(`#website-${kind==='sections'?'outline':'menu-order'} [data-reorder-handle="${key}"]`)?.focus();
    const status=document.querySelector('#website-move-status');if(status)status.textContent=`Moved to position ${to+1}.`;
  }
  async function action(buttonEl){
    if(buttonEl.dataset.action==='website-target-retry'){await changePreviewPage(previewPage);return true;}
    if(buttonEl.dataset.action==='website-layout-default'){await documents.perform([{type:'remove',collection:'layouts',key:scopeTarget()}]);await load();changed(true);return true;}
    if(buttonEl.dataset.action==='website-draft-retry'){await documents.flush();schedulePreview();return true;}
    if(buttonEl.dataset.action==='website-media-retry'&&selectedMedia?.entryId){if(selectedMedia?.entryId)await research.record(selectedMedia.entryId).catch(()=>{});refreshTools();return true;}
    if(buttonEl.dataset.action==='website-research-media'){
      const id=buttonEl.dataset.section;researchMedia.open({focus:'[data-section="'+id+'"]',choose:item=>{const section=sections().find(s=>s.id===id);if(!section)return;checkpoint();section.entryId=item.entryId;section.attachmentId=item.asset.id;changed(true);}});return true;
    }
    if(native()&&await navigationUI.action(buttonEl))return true;
    if(await mediaUI.action(buttonEl))return true;
    if(actionUI.action(buttonEl)||contentUI.action(buttonEl)||regionUI.action(buttonEl))return true;
    if(await library.action(buttonEl))return true;
    const name=buttonEl.dataset.action,index=Number(buttonEl.dataset.index);
    if(name==='delete-page'&&state.page==='website'){if(confirm('Remove this page? Saved versions remain in history.')){if(native()){await documents.perform([{type:'page-remove',key:buttonEl.dataset.id}]);await load();selectTarget('home');changed(true);return true;}checkpoint();const id=buttonEl.dataset.id;state.book.pages=state.book.pages.filter(p=>p.id!==id);state.book.branding=state.book.branding.filter(b=>b.target!=='page:'+id);state.book.website.layouts=state.book.website.layouts.filter(l=>l.target!=='page:'+id);state.book.website.navigation=state.book.website.navigation.filter(n=>n.target!=='page:'+id).map(n=>n.parent==='page:'+id?{...n,parent:null}:n);clearSectionPresentation(state.book.website,'page:'+id);selectTarget('home');changed(true);}return true;}
    if(name==='website-jump-tools'){inspector=true;refreshTools();jumpToArea('tools');return true;}
    if(name==='website-jump-canvas'){jumpToArea('canvas');return true;}
    if(name==='website-back'){const previous=toolTrail.pop();tool=previous?.tool??'page';refreshTools();if(previous)window.scrollTo(0,previous.scroll);return true;}
    if(name==='website-tool'){if(buttonEl.closest('.inspector-tasks')){toolTrail=[];tool=buttonEl.dataset.tool;inspector=true;refreshTools();}else goTool(buttonEl.dataset.tool);return true;}
    if(name==='website-section-tab'){sectionTab=buttonEl.dataset.tab;refreshTools();return true;}
    if(name==='website-design-tab'){designTab=buttonEl.dataset.tab;refreshTools();return true;}
    if(name==='website-colors-reset'){checkpoint();state.book.website.palette={};changed(true);return true;}
    if(name==='website-type-tab'){typeTab=buttonEl.dataset.tab;refreshTools();return true;}
    if(name==='website-include-page'){checkpoint();const p=state.book.pages.find(p=>p.id===buttonEl.dataset.id);p.share=!p.share;changed(true);return true;}
    if(name==='website-choose-link'||name==='website-choose-section'){
      const media=buttonEl.dataset.linkOwner==='media',id=buttonEl.dataset.linkOwner;
      const selector=media?'[data-media-style="link"]':'[data-home-section="'+id+'"][data-key="href"]',field=document.querySelector(selector);
      if(field&&name==='website-choose-section'){sectionPicker.open(selector);return true;}
      if(field)pagePicker.open(safeLink(field.value)?field.value:previewTarget(),{returnFocus:selector,choose:item=>{const current=document.querySelector(selector);if(current){current.value=item.target;input(current,{discrete:true});}}});
      return true;
    }
    if(name==='website-media-style-reset'){checkpoint();state.book.website.presentation.media=state.book.website.presentation.media.filter(m=>m.id!==selectedMedia.id||m.scope!==selectedMedia.scope);changed(true);return true;}

    if(name==='website-select-section'){openSection=buttonEl.dataset.id;selectedMedia=null;pageOptions=false;refreshTools();revealSelected();return true;}
    if(name==='website-edit-section'){focusPreviewSection(buttonEl.dataset.id);refreshTools();revealSelected();document.querySelector('[data-home-section][data-key="title"]')?.focus();return true;}
    if(name==='website-edit-text'){selectTarget(scopeTarget(),{section:buttonEl.dataset.id??openSection});refreshTools();richEditor?.focus();revealSelected();return true;}
    if(name==='website-type-reset'){checkpoint();state.book.website.typography={};changed(true);return true;}
    if(name==='website-text-reset'){checkpoint();const s=previewSections().find(s=>s.id===buttonEl.dataset.id);if(s?.style)delete s.style.fontSize;changed(true);return true;}
    if(name==='website-add-text'){focusPreviewSection(null);checkpoint();const s={id:crypto.randomUUID(),kind:'text',title:'',body:'',show:true};setSections([...sections(),s]);openSection=s.id;revealSection=s.id;focusText=true;changed(true);return true;}
    if(name==='website-style-reset'){checkpoint();delete sections().find(s=>s.id===buttonEl.dataset.id).style;changed(true);return true;}
    if(name==='website-create-home'){
      if(hasHomepage(state.book)){await changePreviewPage('index.html');return true;}
      checkpoint();storePageContext();area='body';toolTrail=[];state.book.website.home={...emptyHomepage(),enabled:true};
      selectTarget('home');tool='page-settings';inspector=true;await ensureOverrides('home');changed(true);
      document.querySelector('[data-home=title]')?.focus();return true;
    }
    if(name==='website-remove-home'){
      if(!confirm('Remove the Home page from this website? You can undo this before saving.'))return true;
      if(native()){await documents.perform([{type:'home-remove'}]);await load();selectTarget(null);tool='page';changed(true);return true;}
      checkpoint();state.book.website.home=emptyHomepage();
      state.book.website.layouts=state.book.website.layouts.filter(l=>l.target!=='home');
      state.book.website.navigation=state.book.website.navigation.filter(n=>n.target!=='home').map(n=>n.parent==='home'?{...n,parent:null}:n);
      clearSectionPresentation(state.book.website,'home');selectTarget(null);tool='page';changed(true);return true;
    }
    if(name==='website-create-page'){if(!native()&&state.book.pages.length>=50){notify('This workspace already has 50 custom pages.',true);return true;}checkpoint();storePageContext();const page={id:crypto.randomUUID(),title:'Untitled page',body:'',share:true,sections:[]};if(native()){await documents.append('pages',page);await load();}else state.book.pages.push(page);area='body';toolTrail=[];editingPage=page.id;editingScope=null;previewPage='pages/'+page.id+'.html';tab='pages';tool='page-settings';openSection=null;selectedMedia=null;pageOptions=true;inspector=true;changed(true);const input=document.querySelector('[data-authored-page=title]');input?.focus();input?.select();return true;}
    if(name==='website-edit-authored'){if(native())await changePreviewPage('pages/'+buttonEl.dataset.id+'.html');editingPage=buttonEl.dataset.id;editingScope=null;tab='pages';previewPage='pages/'+editingPage+'.html';inspector=true;render();return true;}
    if(name==='website-tab'){const key=buttonEl.dataset.tab;if(key==='home')await changePreviewPage('index.html');tool=key==='home'||key==='pages'?'page':key;inspector=true;refreshTools();return true;}
    if(name==='website-undo'||name==='website-redo'){if(native()){releaseRichEditor();await documents.history(name==='website-undo'?'undo':'redo');await load();restorePageContext();changed(true);return true;}const value=history.step(name==='website-undo'?'undo':'redo',capture);if(value){restore(value);changed(true);}return true;}
    if(['website-section-remove','include-project-entries'].includes(name))checkpoint();
    if(name==='website-inspector'){inspector=!inspector;document.querySelector('.website-controls').hidden=!inspector;document.querySelector('.website-studio').classList.toggle('inspector-hidden',!inspector);buttonEl.setAttribute('aria-label',inspector?'Hide controls':'Show controls');buttonEl.title=inspector?'Hide controls':'Show controls';fitPreview();return true;}
    if(name==='website-expand'){if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();return true;}
    if(name==='website-section-duplicate'){
      const original=sections().find(e=>e.id===buttonEl.dataset.id);if(!original)return true;
      const ids=descendantsOf(sections(),original.id),source=treeOrder(sections()).map(row=>row.element).filter(e=>ids.has(e.id)),copy=cloneElements(source,()=>crypto.randomUUID());
      if(sections().length+copy.length>MAX_ELEMENTS)throw new Error('This page has reached its element limit.');
      checkpoint();copySectionPresentation(state.book.website,presentationTarget(),source,presentationTarget(),copy);
      const siblings=childrenOf(sections(),original.parentId??null),next=siblings[siblings.findIndex(e=>e.id===original.id)+1];
      setSections(moveElement([...sections(),...copy],copy[0].id,original.parentId??null,next?.id??null));openSection=copy[0].id;selectedMedia=null;changed(true);return true;
    }
    if(name==='website-refresh'){schedulePreview();return true;}
    if(name==='website-add-section'){const selected=sections().find(s=>s.id===openSection),parent=acceptsChildren(selected)?selected.id:selected?.parentId??null,siblings=childrenOf(sections(),parent),before=!selected||acceptsChildren(selected)?null:siblings[siblings.findIndex(s=>s.id===openSection)+1]?.id??null;insertKind(buttonEl.dataset.kind,parent,before);return true;}
    if(name==='website-section-remove'){const element=sections().find(e=>e.id===buttonEl.dataset.id);if(!element)return true;const ids=descendantsOf(sections(),element.id);clearSectionPresentation(state.book.website,presentationTarget(),sections().filter(e=>ids.has(e.id)));setSections(sections().filter(e=>!ids.has(e.id)));openSection=element.parentId??null;selectedMedia=null;tool=openSection?'selection':'page';changed(true);return true;}
    if(name==='website-section-up'||name==='website-section-down'){reorder('sections',index,index+(name.endsWith('up')?-1:1),sections()[index].id);return true;}
    if(name==='website-menu-clear'){checkpoint();state.book.website.navigation=storedNavigation(navigationItems(pageBook(),summary()).map(item=>({...item,show:false})));state.book.website.design.browseLink=false;changed(true);return true;}
    if(name==='menu-up'||name==='menu-down'){reorder('menu',index,index+(name==='menu-up'?-1:1),navigationItems(pageBook(),summary())[index].target);return true;}
    if(name==='include-project-entries'){
      state.book.projects.find(p=>p.id===buttonEl.dataset.id).share=true;
      selection.includeProject(buttonEl.dataset.id);if(research.enabled()){research.invalidate();contentPages.refresh();}changed(true);return true;
    }
    return false;
  }
  async function showPreview(result,iframe,revision,signal,command,collectionRequest){
    canvasRequests.set(iframe,{command,request:collectionRequest});
    const doc=iframe.contentDocument,url=result.baseUrl+previewPage;
    if(!doc?.querySelector('main')||doc.body.dataset.page!==previewTarget()){iframe.contentWindow.location.replace(url);return;}
    const response=await fetch(url,{signal});if(!response.ok)throw new Error(tr('pageLoadFailed'));
    const html=await response.text();if(revision!==version||state.page!=='website'||!iframe.isConnected)return;
    const parsed=new DOMParser().parseFromString(html,'text/html'),body=doc.importNode(parsed.body,true),base=new URL(url,location.href);
    canvasResourceLinks(body,base.href,collectionRequest.context);
    // Keep assets on the current candidate: older preview candidates are evicted.
    reconcileCanvas(doc.body,body,{editor:richMount?.node??inlineHeading});
    canvasSources.set(doc,base.href);
    const style=doc.querySelector('link[href$="styles.css"]');if(style)style.href=new URL(result.baseUrl+'styles.css',location.href).href;
    if(!richEditor)mountCanvasEditor(doc);
    collectionNavigation.attach(doc,command,collectionRequest);decorateCanvas(doc);referenceNavigation.restoreFocus(doc);if(richEditor)refreshRichStyles(doc,richEditor.doc);surface?.measure();fitPreview();
    if(revealSection){revealSelected();revealSection=null;}
  }

  function schedulePreview(){
    if(canvasDragging||switchingPage||!overridesReady())return;
    clearTimeout(timer);previewController?.abort();previewController=null;const revision=++version;
    if(state.page!=='website')return;
    const iframe=document.querySelector('#website-draft-preview'),status=document.querySelector('#website-preview-status'),empty=document.querySelector('#website-preview-empty'),select=document.querySelector('#website-preview-page');
    if(!iframe)return;refreshSummary();
    if(!previewTarget()){
      preview=null;previewKey=null;empty.hidden=false;iframe.hidden=true;document.querySelector('#website-preview-frame').hidden=true;
      status.textContent='';document.querySelector('#website-preview-retry').hidden=true;document.querySelector('.website-preview-panel').classList.remove('canvas-is-loading');return;
    }
    const previewedPage=state.book.pages.find(p=>'pages/'+p.id+'.html'===previewPage),privatePage=!linkAvailable(previewTarget(),summary());empty.hidden=true;iframe.hidden=false;document.querySelector('#website-preview-frame').hidden=false;select.parentElement.hidden=false;
    const designPageId=previewedPage?.id??null,designTarget=previewTarget(),currentContext=websiteContext(state),currentSnapshot=websiteSnapshot(state);
    const current=()=>revision===version&&state.page==='website'&&currentContext===websiteContext(state)&&currentSnapshot===websiteSnapshot(state)&&iframe.isConnected;
    status.textContent=tr('previewUpdating');document.querySelector('#website-preview-retry').hidden=true;
    timer=setTimeout(async()=>{
      const controller=new AbortController();previewController=controller;let referenceRequest,collectionRequest;
      try{
        const source=await previewDraft(native()?undefined:draftWorkspace(state.book));if(!current())return;
        const documentSnapshot=native()?documents.snapshot():null;
        referenceRequest=referenceNavigation.prepare(currentContext,designTarget,source);collectionRequest=collectionNavigation.prepare(currentContext,designTarget,source,state.book);
        const key={book:state.book,draft:JSON.stringify(source.websiteDraft??null),designPageId,designTarget,referenceCursor:referenceRequest.cursor,collections:JSON.stringify(collectionRequest.collections)};
        if(preview&&previewKey?.book===key.book&&previewKey.draft===key.draft&&previewKey.designPageId===designPageId&&previewKey.designTarget===designTarget&&previewKey.referenceCursor===key.referenceCursor&&previewKey.collections===key.collections){select.innerHTML=previewPageOptions();status.textContent=privatePage?tr('previewPrivate'):'';fitPreview();return;}
        const command={mode:'website',...source,designPageId,designTarget,workspaceContent:true,...(source.draft||source.websitePin?{referenceCursor:referenceRequest.cursor,collections:collectionRequest.collections}:{})};
        const result=await api('/api/design-preview',command,{adopt:false,signal:controller.signal});
        if(!current()||native()&&documentSnapshot!==documents.snapshot())return;
        if(source.websitePin&&(!sameWebsitePin(result.websitePin,source.websitePin)||(result.websiteDraft?.id??null)!==(source.websiteDraft?.id??null)||(result.websiteDraft?.revision??null)!==(source.websiteDraft?.revision??null)))throw Error(tr('pageRenderFailed'));
        sourcePages.accept(result.editor);refreshSummary();preview=result;previewKey=key;if(!result.pages.some(p=>p.path===previewPage))throw Error(tr('pageRenderFailed'));
        select.innerHTML=previewPageOptions();await showPreview(result,iframe,revision,controller.signal,command,collectionRequest);if(!current())return;
        referenceNavigation.accept(referenceRequest);iframe.hidden=false;status.textContent=privatePage?tr('previewPrivate'):'';fitPreview();updateHistoryControls();
      }catch(error){if(controller.signal.aborted||!current())return;
        if(referenceRequest)referenceNavigation.reject(referenceRequest);if(collectionRequest)collectionNavigation.reject(collectionRequest);
        preview=null;previewKey=null;document.querySelector('#website-preview-retry').hidden=false;if(!iframe.contentDocument?.querySelector('main')){iframe.hidden=true;iframe.contentWindow.location.replace('about:blank');}status.textContent=error.code==='PRIVACY'?tr('previewPrivacy'):error.message??tr('previewFailed');
      }finally{if(previewController===controller)previewController=null;}
    },iframe.contentDocument?.body?.dataset.page===designTarget?200:0);
  }
  function bind(){
    researchMedia.sync();
    pagePicker.sync();sectionPicker.sync();mediaUI.sync();if(native())navigationUI.sync();contentUI.sync();sourceUI.sync();sourcePages.sync();releaseRichEditor();
    dispose();disposeCanvas();disposeDrag();surface?.destroy();surface=null;resizeObserver?.disconnect();clearTimeout(timer);previewController?.abort();previewController=null;version++;
    if(state.page!=='website'){overrideController?.abort();overrideController=null;switchingPage=false;overrideError='';research.close();sourceUI.close();sourcePages.close();context=null;previewKey=null;preview=null;history.clear();historyBook=null;richStates.clear();documentContexts.clear();return;}
    if(!overridesReady()&&!overrideError)void loadOverrides();
    const kind='menu',root=document.querySelector('#website-menu-order');
    dispose=bindReorder(native()?null:root,{label:kind==='sections'?'Section':'Menu item',commit:(from,to,key)=>reorder(kind,from,to,key),announce:text=>{const node=document.querySelector('#website-move-status');if(node)node.textContent=text;}});
    document.querySelectorAll('[data-section-details]').forEach(el=>el.addEventListener('toggle',()=>{if(el.open){openSection=el.dataset.sectionDetails;document.querySelectorAll('[data-section-details]').forEach(other=>{if(other!==el)other.open=false;});}}));

    library.bind();regionUI.bind();contentUI.bind();sourceUI.bind();if(native())navigationUI.bind();bindStructure();if(!document.querySelector('#website-canvas'))return;bindInspector();document.querySelectorAll('.page-settings').forEach(el=>el.addEventListener('toggle',()=>{pageOptions=el.open;}));
    const canvas=document.querySelector('#website-canvas'),iframe=document.querySelector('#website-draft-preview');
    surface=previewSurface(iframe,{geometry:previewGeometry});
    resizeObserver=new ResizeObserver(fitPreview);resizeObserver.observe(canvas);resizeObserver.observe(document.querySelector('.website-controls'));
    iframe.addEventListener('load',()=>{
      if(!iframe.isConnected||state.page!=='website')return;fitPreview();const doc=iframe.contentDocument;if(!doc?.querySelector('main')||doc.body.dataset.page!==previewTarget())return;
      canvasSources.set(doc,doc.URL);
      const reading=canvasRequests.get(iframe);if(reading){canvasResourceLinks(doc.body,doc.URL,reading.request.context);collectionNavigation.attach(doc,reading.command,reading.request);}
      iframe.style.pointerEvents='';iframe.removeAttribute('aria-busy');document.querySelector('.website-preview-panel')?.classList.remove('canvas-is-loading');document.querySelectorAll('[data-palette-kind]').forEach(b=>b.disabled=false);mountCanvasEditor(doc);decorateCanvas(doc);referenceNavigation.restoreFocus(doc);surface.measure();if(revealSection){doc.querySelector(`[data-section-id="${revealSection}"]`)?.scrollIntoView({block:'center'});revealSection=null;}if(focusText&&richEditor){richEditor.focus();focusText=false;}if(pendingScroll!==null){const top=pendingScroll;pendingScroll=null;doc.fonts.ready.then(()=>{surface?.measure();window.scrollTo(0,top);});}
      doc.addEventListener('auxclick',event=>{if(event.target.closest('a'))event.preventDefault();});
      doc.addEventListener('click',event=>{
        if(doc.body.dataset.page!==previewTarget()||event.target.closest('[data-reorder-handle],[data-drop-parent]'))return;
        if(referenceNavigation.click(event,canvasSources.get(doc)??doc.baseURI,()=>{previewKey=null;schedulePreview();}))return;
        if(collectionNavigation.click(event,canvasSources.get(doc)??doc.baseURI,()=>{previewKey=null;schedulePreview();}))return;
        if(event.target.closest('[data-feed-controls],[data-feed-next],[data-feed-previous],[data-feed-cancel],[data-feed-retry]'))return;
        if(event.target.closest('.ProseMirror')){if(tool!=='selection'){tool='selection';refreshTools();}return;}
        if(event.target.closest('a,button,summary'))event.preventDefault();
        const composed=event.target.closest('[data-composition]')?.dataset.composition;
        const media=event.target.closest('[data-media-id]'),section=event.target.closest('[data-section-id]'),card=event.target.closest('[data-record-id]');
        if(media||section)area=REGION_SLOTS.includes(composed)?composed:'body';
        if(media){selectedMedia={id:media.dataset.mediaId,scope:section&&area!=='body'?presentationTarget()+'#'+section.dataset.sectionId:media.dataset.mediaScope,entryId:card?.dataset.recordId??mediaRecordId(media.dataset.mediaScope,media.dataset.mediaId,section?.dataset.sectionId)};openSection=section?.dataset.sectionId??null;sectionTab='layout';}
        else if(section){openSection=section.dataset.sectionId;selectedMedia=null;sectionTab='content';revealSection=null;}
        else if(event.target.closest('.site-footer,.site-sidebar,.site-masthead')){area=event.target.closest('.site-footer')?'footer':event.target.closest('[data-region-kind]')?.dataset.regionKind??'sidebar';tool='page';openSection=null;selectedMedia=null;}
        else if(event.target.closest('.site-top'))tool='site';
        else if(event.target.closest('.site-header'))tool='page-settings';
        else return;
        inspector=true;refreshTools();if(tool==='selection'&&window.innerWidth<=760)jumpToArea('tools');
      });
    });
    if(preview){document.querySelector('#website-preview-page').innerHTML=previewPageOptions();}
    fitPreview();schedulePreview();
  }
  function decorateCanvas(doc){
    disposeCanvas();markSelection(doc);doc.body.classList.add('canvas-edit-mode');
    enhancePublicFeeds(doc,doc.defaultView,(url,options)=>collectionNavigation.fetch(doc,url,options,canvasSources.get(doc)??doc.baseURI),{baseURL:canvasSources.get(doc)??doc.baseURI,history:false});
    for(const href of ['/website-canvas.css','/rich-text-editor.css'])if(!doc.querySelector('link[href="'+href+'"]')){const sheet=doc.createElement('link');sheet.rel='stylesheet';sheet.href=href;doc.head.append(sheet);}
    doc.querySelectorAll('.canvas-section-handle,.canvas-section-edit,.canvas-empty-media,[data-drop-parent]').forEach(n=>n.remove());
    for(const element of doc.querySelectorAll('[data-section-id],[data-media-id]')){
      element.tabIndex=0;element.setAttribute('aria-label',element.hasAttribute('data-media-id')?'Select media':'Select element');
      if(!element.dataset.keyboardBound){element.dataset.keyboardBound='true';element.addEventListener('keydown',e=>{if(e.target===element&&['Enter',' '].includes(e.key)){e.preventDefault();element.click();}});}
    }
    for(const [i,block] of [...doc.querySelectorAll('[data-section-id]')].entries()){
      const model=sections().find(e=>e.id===block.dataset.sectionId);if(!model||!activeRoot(doc)?.contains(block))continue;
      const handle=doc.createElement('button');handle.className='canvas-section-handle';handle.dataset.elementDrag=block.dataset.sectionId;handle.dataset.reorderHandle=block.dataset.sectionId;handle.setAttribute('aria-label','Move canvas section '+(i+1));handle.title='Drag to move; arrow keys also work';handle.textContent=sectionName(model??{kind:'Element'});block.prepend(handle);
      const edit=doc.createElement('button');edit.type='button';edit.className='canvas-section-edit';edit.textContent='Edit';edit.setAttribute('aria-label','Edit '+sectionName(model??{kind:'Element'}));
      edit.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();focusPreviewSection(block.dataset.sectionId);refreshTools();document.querySelector('[data-home-section][data-key="title"]')?.focus();});block.prepend(edit);
      block.classList.toggle('canvas-hidden-element',model?.show===false);
      if(model?.kind==='heading'){
        const heading=block.querySelector(':scope>h'+model.level);
        if(heading){heading.contentEditable=tool==='selection'&&openSection===model.id?'plaintext-only':'false';heading.setAttribute('aria-description','Use Edit to change this heading');
          if(!heading.dataset.headingBound){heading.dataset.headingBound='true';
            heading.addEventListener('focus',()=>{inlineHeading=heading;});
            heading.addEventListener('blur',()=>{if(inlineHeading===heading)inlineHeading=null;});
            heading.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();heading.blur();}});
            heading.addEventListener('input',()=>{const current=sections().find(e=>e.id===block.dataset.sectionId);if(!current)return;checkpoint('heading:'+current.id);current.title=heading.textContent.slice(0,160);const field=document.querySelector('[data-home-section="'+current.id+'"][data-key="title"]');if(field)field.value=current.title;const row=document.querySelector('[data-action="website-select-section"][data-id="'+current.id+'"]');if(row)row.textContent=current.title||'Heading';changed();});
          }
        }
      }
      if(['asset','download'].includes(model?.kind)&&!model.assetId){const slot=doc.createElement('div');slot.className='canvas-empty-media';slot.textContent=model.kind==='download'?t('websiteMedia','chooseFile'):'Choose image or media';block.append(slot);}
      if(acceptsChildren(model))addDropZone(block.querySelector(model.kind==='popup'?':scope>details>.popup-body>.container-content':model.kind==='disclosure'?':scope>details>.container-content':':scope>.container-content'),model.id);
    }
    const kind=compositionKind();
    let root=doc.querySelector('[data-composition="'+kind+'"]');
    if(!root&&area!=='body'){bindDragging();return;}
    if(!root){root=doc.createElement('div');root.className='page-composition';root.dataset.composition=kind;doc.querySelector('main').append(root);}
    addDropZone(root,null);bindDragging();
  }
  function addDropZone(parent,id){if(!parent)return;const zone=parent.ownerDocument.createElement('button');zone.type='button';zone.className='canvas-drop-zone';zone.dataset.dropParent=id??'';zone.textContent=parent.children.length?'+':'Drag an element here  +';zone.setAttribute('aria-label',id?'Add element to container':'Add element to page');zone.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openSection=id;selectedMedia=null;tool='page';refreshTools();});parent.append(zone);}
  function bindDragging(){
    disposeDrag();const host=document.querySelector('.website-workbench'),frame=document.querySelector('#website-draft-preview');if(!host||!frame)return;
    disposeDrag=composerDrag({host,frame,canvasRoot:()=>activeRoot(frame.contentDocument),elements:sections,insert:insertKind,move:placeElement,activity:active=>{canvasDragging=active;if(active){clearTimeout(timer);previewController?.abort();previewController=null;version++;}else schedulePreview();},announce:text=>{const node=document.querySelector('#website-preview-status');if(node)node.textContent=text;}});
  }
  function insertKind(kind,parentId=null,beforeId=null){
    const element=newElement(kind);if(kind==='contents')element.title=tr('contents');
    if(kind==='media'&&research.enabled()){
      const target=presentationTarget();researchMedia.open({focus:'[data-palette-kind="media"]',choose:item=>{if(presentationTarget()!==target)return;element.entryId=item.entryId;element.attachmentId=item.asset.id;const next=insertElement(sections(),element,parentId,beforeId);checkpoint();setSections(next);openSection=element.id;selectedMedia=null;sectionTab='content';revealSection=element.id;changed(true);}});return;
    }
    if(kind==='media'){const record=state.book.entries.find(e=>e.attachments.length);if(!record){notify('Add media to a logbook record first.',true);return;}element.entryId=record.id;element.attachmentId=record.attachments[0].id;}
    const next=insertElement(sections(),element,parentId,beforeId);checkpoint();setSections(next);openSection=element.id;selectedMedia=null;sectionTab='content';revealSection=element.id;changed(true);
  }
  function placeElement(id,parentId,beforeId){
    const next=moveElement(sections(),id,parentId,beforeId);if(next===sections())return;
    releaseRichEditor();checkpoint();setSections(next);openSection=id;selectedMedia=null;changed(true);
  }
  function storePageContext(){documentContexts.set(previewPage,{area,section:openSection,media:selectedMedia,tool,sectionTab,typeTab,designTab,scroll:window.scrollY});}
  function restorePageContext(){
    const c=documentContexts.get(previewPage);area=c?.area??'body';toolTrail=[];selectTarget(previewTarget(),{section:c?.section??null});
    if(c){pendingScroll=c.scroll??0;tool=c.tool;sectionTab=c.sectionTab??'content';typeTab=c.typeTab??'fonts';designTab=c.designTab??'layout';selectedMedia=c.media??null;}
    if(openSection&&!sections().some(e=>e.id===openSection)){openSection=null;selectedMedia=null;tool='page';}
  }
  function rememberContext(){try{storePageContext();sessionStorage.setItem('observanda.editor.'+state.book.id+'.'+(state.websiteId??'workspace'),JSON.stringify({path:previewPage,pageChosen,area,section:openSection,tool,documents:documentContexts,device,zoom,structureOpen,sectionTab,typeTab,designTab,media:selectedMedia,recordPage:research.labels()[0]??null}));}catch{}}
  function bindStructure(){const details=document.querySelector('.composer-structure');details?.querySelector('summary').addEventListener('click',()=>{structureOpen=!details.open;rememberContext();});}
  function refreshTools(){
    if(state.page!=='website')return;
    const host=document.querySelector('.website-controls');if(!host){render();return;}
    if(openSection&&!sections().some(e=>e.id===openSection)){openSection=null;selectedMedia=null;tool='page';}
    releaseRichEditor();rememberContext();
    host.hidden=!inspector;document.querySelector('.website-studio').classList.toggle('inspector-hidden',!inspector);
    host.querySelector('.inspector-content').innerHTML=inspectorContent();bindMedia();
    const structure=host.querySelector('#composer-structure');structure.innerHTML=structureOutline();bindStructure();
    host.querySelectorAll('[data-action="website-tool"]').forEach(b=>{b.classList.toggle('primary',toolActive(b.dataset.tool));if(toolActive(b.dataset.tool))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    document.querySelector('#website-preview-page').innerHTML=previewPageOptions();
    document.querySelectorAll('[data-action=website-create-home]').forEach(b=>b.hidden=hasHomepage(state.book));
    document.querySelector('#website-text-tools').outerHTML=textToolbar();
    dispose();dispose=bindReorder(native()?null:host.querySelector('#website-menu-order'),{label:'Menu item',commit:(from,to,key)=>reorder('menu',from,to,key),announce:text=>notify(text)});library.bind();regionUI.bind();contentUI.bind();sourceUI.bind();if(native())navigationUI.bind();
    const frame=document.querySelector('#website-draft-preview'),doc=frame?.contentDocument;
    if(previewTarget()&&(switchingPage||!overridesReady()||doc?.body?.dataset.page!==previewTarget())){frame.style.pointerEvents='none';frame.setAttribute('aria-busy',String(!overrideError));document.querySelector('.website-preview-panel').classList.toggle('canvas-is-loading',!overrideError);document.querySelectorAll('[data-palette-kind]').forEach(b=>b.disabled=true);}
    else if(!previewTarget()){frame.style.pointerEvents='';frame.removeAttribute('aria-busy');document.querySelector('.website-preview-panel').classList.remove('canvas-is-loading');}
    if(!switchingPage&&overridesReady()&&doc?.querySelector('main')&&doc.body.dataset.page===previewTarget()){mountCanvasEditor(doc);decorateCanvas(doc);}
    bindDragging();fitPreview();if(!switchingPage&&!overridesReady()&&!overrideError)void loadOverrides();
  }
  function markSelection(doc){
    for(const el of doc.querySelectorAll('[data-section-id],[data-media-id]'))el.classList.toggle('canvas-selected',(area==='body'||activeRoot(doc)?.contains(el))&&(selectedMedia?el.dataset.mediaId===selectedMedia.id&&el.dataset.mediaScope===canvasMediaScope(selectedMedia.scope):el.dataset.sectionId===openSection));
    for(const heading of doc.querySelectorAll('.section-heading>:is(h1,h2,h3,h4,h5,h6)'))heading.contentEditable=tool==='selection'&&!selectedMedia&&heading.parentElement.dataset.sectionId===openSection?'plaintext-only':'false';
  }
  function revealSelected(){const frame=document.querySelector('#website-draft-preview'),el=frame?.contentDocument?.querySelector(`[data-section-id="${openSection}"]`);if(el)surface?.reveal(el.getBoundingClientRect(),document.querySelector('.website-preview-tools')?.getBoundingClientRect().bottom??0);}
  function bindInspector(){
    const studio=document.querySelector('.website-studio'),handle=document.querySelector('.website-inspector-resizer');
    try{inspectorWidth=Number(sessionStorage.getItem('observanda.website.inspectorWidth'))||inspectorWidth;}catch{}
    const apply=value=>{inspectorWidth=Math.max(300,Math.min(600,value));studio.style.setProperty('--inspector-width',inspectorWidth+'px');handle.setAttribute('aria-valuenow',String(inspectorWidth));fitPreview();};
    const remember=()=>{try{sessionStorage.setItem('observanda.website.inspectorWidth',String(inspectorWidth));}catch{}};
    handle.setAttribute('aria-valuemin','300');handle.setAttribute('aria-valuemax','600');apply(inspectorWidth);let drag=null;
    handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();handle.focus();handle.setPointerCapture(e.pointerId);drag={x:e.clientX,width:inspectorWidth};});
    handle.addEventListener('pointermove',e=>{if(drag)apply(drag.width+e.clientX-drag.x);});
    handle.addEventListener('pointerup',()=>{if(drag){drag=null;remember();}});
    handle.addEventListener('pointercancel',()=>{if(drag){apply(drag.width);drag=null;}});
    handle.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){apply(drag.width);drag=null;e.preventDefault();}if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();apply(e.key==='Home'?300:e.key==='End'?600:inspectorWidth+(e.key==='ArrowRight'?20:-20));remember();}});
  }
  function pageForRegion(book,region){for(const page of websitePageTargets(book))for(const slot of REGION_SLOTS)if(resolveRegion(book.website,page.target,slot)?.id===region.id)return {...page,area:slot};return null;}
  function validate(){
    checkFontInputs();regionUI.validate();
    const b=state.book;let problem=null;
    if(!validTypography(b.website.typography)){const key=Object.keys(b.website.typography).find(key=>!validTypography({[key]:b.website.typography[key]}));problem={tab:'typography',typeGroup:['fontSize','headingScale'].includes(key)?'size':['font','headingFont'].includes(key)?'fonts':'spacing',selector:`[data-website-type="${key}"]`,message:'Check the website typography value.'};}
    for(const m of b.website.presentation.media){const key=!Number.isInteger(m.width)||m.width<10||m.width>100?'width':m.link&&!safeLink(m.link)?'link':null;if(key){const owner=m.scope.startsWith('region:')?regionsOf(b.website).definitions.find(r=>'region:'+r.id===m.scope.split('#')[0]):null,assigned=owner&&pageForRegion(b,owner);problem??={tab:'selection',media:m,...(assigned?{area:assigned.area,scope:assigned.target,section:m.scope.split('#')[1]}:{}),selector:`[data-media-style="${key}"]`,message:key==='width'?'Enter an image width from 10 to 100 percent.':t('websitePages','invalidLink')};}}
    for(const p of b.pages){if(!p.title.trim()){problem??={tab:'pages',page:p.id,selector:'[data-authored-page="title"]',message:'Enter a page title.'};}}
    for(const destination of [{tab:'home',sections:b.website.home.sections},...b.pages.map(p=>({tab:'pages',page:p.id,sections:p.sections??[]})),...b.website.layouts.map(l=>({tab:'pages',scope:l.target,sections:l.sections})),...regionsOf(b.website).definitions.flatMap(r=>{const destination=pageForRegion(b,r);return destination?[{tab:'pages',scope:destination.target,area:destination.area,sections:r.sections}]:[];})]){
      for(const s of destination.sections){
        if(['link','hero'].includes(s.kind)&&!safeLink(s.href))problem??={...destination,section:s.id,selector:`[data-home-section="${s.id}"][data-key="href"]`,message:t('websitePages','invalidLink')};
        if(s.filter&&(!Number.isSafeInteger(s.filter.limit)||s.filter.limit<0))problem??={...destination,section:s.id,selector:`[data-block-filter="${s.id}"][data-key="limit"]`,message:t('websiteFeeds','totalInvalid')};
        if(s.feed&&!validFeed(s.feed,s.kind))problem??={...destination,section:s.id,selector:`[data-block-feed="${s.id}"][data-key="pageSize"]`,message:t('websiteFeeds','pageSizeInvalid')};
        for(const [key,min,max] of [['fontSize',14,48],['padding',0,100],['radius',0,40]])if(s.style?.[key]!==undefined&&(!Number.isInteger(s.style[key])||s.style[key]<min||s.style[key]>max))problem??={...destination,section:s.id,selector:`[data-style-value="${s.id}"][data-key="${key}"]`,message:`Enter a whole number from ${min} to ${max}.`};
        for(const key of ['background','color'])if(s.style?.[key]!==undefined&&!/^#[0-9a-f]{6}$/i.test(s.style[key]))problem??={...destination,section:s.id,selector:`[data-style-value="${s.id}"][data-key="${key}"]`,message:'Use a six-digit color such as #2456a8, or leave it empty to use the theme.'};
      }
    }
    if(problem){area=problem.area??'body';sectionTab=problem.selector.includes('data-style-value')?'style':problem.selector.includes('href')&&[...b.website.home.sections,...b.pages.flatMap(p=>p.sections),...b.website.layouts.flatMap(l=>l.sections),...regionsOf(b.website).definitions.flatMap(r=>r.sections)].some(s=>s.id===problem.section&&s.kind==='hero')?'link':'content';typeTab=problem.typeGroup??typeTab;selectedMedia=problem.media?{id:problem.media.id,scope:problem.media.scope,entryId:mediaRecordId(problem.media.scope,problem.media.id)}:null;if(selectedMedia)sectionTab=problem.selector.includes('width')?'layout':'link';tool=problem.section?'selection':problem.tab==='home'||problem.tab==='pages'?'page-settings':problem.tab;tab=problem.tab;editingPage=problem.page??null;editingScope=problem.scope??null;openSection=problem.section??null;previewPage=websitePageTarget(pageBook(),problem.scope??(problem.media?(problem.media.scope.startsWith('cover:')?'home':problem.media.scope.split('#')[0]):(problem.page?'page:'+problem.page:problem.tab==='home'?'home':previewTarget())))?.path??'index.html';pageOptions=!problem.section;inspector=true;render();const field=document.querySelector(problem.selector);for(let detail=field?.closest('details');detail;detail=detail.parentElement?.closest('details'))detail.open=true;field?.setCustomValidity(problem.message);field?.reportValidity();throw new Error(problem.message);}
  }
  function previewGeometry(){
    const canvas=document.querySelector('#website-canvas'),container=document.querySelector('#website-preview-frame');
    const available=Math.max(1,canvas.clientWidth-24),width=device==='canvas'?available:{desktop:1440,tablet:820,phone:390}[device],scale=zoom==='fit'?Math.min(1,available/width):1;
    document.querySelector('#website-viewport-size').textContent=width+' px / '+Math.round(scale*100)+'%';
    return {width,scale,container};
  }
  function jumpToArea(area){
    const top=(document.querySelector('.topbar')?.offsetHeight??0)+(document.querySelector('.website-toolbar')?.offsetHeight??0)+16;
    const selector=area==='tools'?'.website-controls':'.website-preview-panel',node=document.querySelector(selector);
    if(node){window.scrollTo({top:window.scrollY+node.getBoundingClientRect().top-top});const focus=area==='tools'?node.querySelector('[aria-current],button'):document.querySelector('#website-preview-page');focus?.focus({preventScroll:true});}
  }
  function fitPreview(){const controls=document.querySelector('.website-controls');if(controls){const top=(document.querySelector('.topbar')?.offsetHeight??76)+16;controls.classList.toggle('inspector-fits',controls.offsetHeight<window.innerHeight-top-16);}surface?.refresh();}
  document.addEventListener('fullscreenchange',()=>{
    expanded=Boolean(document.fullscreenElement);
    document.querySelector('.website-workbench')?.classList.toggle('website-expanded',expanded);
    const button=document.querySelector('[data-action=website-expand]');
    if(button){button.title=expanded?'Exit full screen':'Full screen';button.setAttribute('aria-label',button.title);}
    fitPreview();
  });
  return {load,view,input,action,bind,summary,acceptAsset,validate,focusEmpty:()=>{const hasResearch=state.book.projects.length>0||Boolean(publicationSourceCount(state));tool=hasResearch?'content':'insert';inspector=true;refreshTools();document.querySelector(hasResearch?'[data-project-share]':'#element-search')?.focus();notify(hasResearch?'Choose the logbook content to publish.':'Add content to the page before previewing.');},currentPath:()=>previewPage,saved:()=>{syncHistory();updateHistoryControls();previewKey=null;schedulePreview();}};
}
