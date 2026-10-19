import {locationTools,locationToolLabel} from './modules/location-tools.js';
import {scopePath,parseScope} from './modules/scope.js';
import {childrenOf,ancestors} from './workspace-structure.js';
import {notebookDirectory} from './laboratory/notebook-model.js';
import {moduleChildren,enabledModule} from './feature-modules.js';
import {preferencePage} from './preferences-ui.js';
import {t,language} from './i18n/index.js';
import {orderNavigationNodes} from './navigation-dom.js';
import {explicitWebsite} from './website-context.js';

const text = (node, value) => { if(node.textContent !== String(value))node.textContent = value; };
const attr = (node, name, value) => {
  if(value === null) { if(node.hasAttribute(name))node.removeAttribute(name); }
  else if(node.getAttribute(name) !== String(value))node.setAttribute(name, value);
};
const element = (tag, className='') => {
  const node=document.createElement(tag);if(className)node.className=className;return node;
};
function active(node, selected) {
  selected=Boolean(selected);
  if(node.classList.contains('active') !== selected)node.classList.toggle('active', selected);
  attr(node,'aria-current',selected?'page':null);
}

// Routes select items; they never recreate the tree. Stable project/notebook IDs
// also retain their nodes during renames and moves.
export function workspaceNavigation({state,icon,logosFor}) {
  let host=null,context=null,root,heading,identity,name,dashboard,projectsSection,projectOverview,tree,settings,lock;
  let projects=new Map(),notebooks=new Map(),modules=new Map(),logos=new Map(),selectedTrail=null;
  function button(action,label,glyph) {
    const node=element('button','nav-button');node.type='button';node.dataset.action=action;
    node.innerHTML=icon(glyph);
    const title=element('span','tree-title');title.textContent=label;node.append(title);
    return node;
  }
  function group(label) {
    const node=element('nav');node.setAttribute('aria-label',label);
    const title=element('span','nav-group-label');title.textContent=label;node.append(title);return node;
  }
  function unmount() {
    root?.remove();heading?.remove();
    host=context=root=heading=identity=name=dashboard=projectsSection=tree=settings=lock=null;
    projects.clear();notebooks.clear();modules.clear();logos.clear();selectedTrail=null;
  }
  function mount(sidebar,topbar,key) {
    unmount();
    host=sidebar;context=key;
    projects=new Map();notebooks=new Map();modules=new Map();logos=new Map();
    root=element('div','workspace-navigation');root.id='workspace-navigation';
    const home=element('nav');home.setAttribute('aria-label',t('navigation','dashboard'));
    dashboard=button('workspace',t('navigation','dashboard'),'dashboard');home.append(dashboard);
    projectsSection=element('section');projectsSection.dataset.navSection='projects';
    const label=element('div','workspace-label');
    projectOverview=element('button','project-overview');projectOverview.type='button';projectOverview.dataset.action='projects';projectOverview.textContent=t('navigation','projects');projectOverview.title=t('navigation','overview');label.append(projectOverview);
    const add=element('button','icon-button');add.type='button';add.dataset.action='new-project';
    add.setAttribute('aria-label',t('navigation','newProject'));add.innerHTML=icon('plus');label.append(add);
    tree=element('div','workspace-tree');projectsSection.append(label,tree);
    settings=group(t('navigation','settings'));settings.dataset.navSection='workspace';
    settings.setAttribute('aria-label',t('navigation','workspaceSettings'));
    settings.append(button('storage-workspaces',t('navigation','workspaces'),'folder'),button('preferences',t('navigation','preferences'),'settings'));
    lock=button('storage-lock',t('navigation','lock'),'lock');
    root.append(home,projectsSection,settings);sidebar.append(root);
    heading=element('div','workspace-heading');identity=element('button','workspace-identity');
    identity.type='button';identity.dataset.action='workspace';
    name=element('span','workspace-name');identity.append(name);heading.append(identity);topbar.append(heading);
  }
  function updateModules() {
    const wanted=new Set();let structureChanged=false;
    for(const manifest of moduleChildren()) {
      if(!enabledModule(state.dashboardSettings,manifest.id)||!manifest.navigation.length)continue;
      wanted.add(manifest.id);
      let item=modules.get(manifest.id);
      if(!item) {
        structureChanged=true;
        item={node:group(manifest.label),buttons:new Map()};
        item.node.dataset.moduleNav=manifest.id;modules.set(manifest.id,item);
        root.insertBefore(item.node,projectsSection);
      }
      if(item.node.dataset.navSection!==(manifest.navigationGroup??manifest.id))structureChanged=true;
      attr(item.node,'data-nav-section',manifest.navigationGroup??manifest.id);
      attr(item.node,'aria-label',manifest.label);text(item.node.firstElementChild,manifest.label);
      const keys=new Set(),ordered=[item.node.firstElementChild];
      const entries=(module,depth=0)=>[
        ...module.navigation.map(entry=>({...entry,depth})),
        ...moduleChildren(module.id).filter(child=>enabledModule(state.dashboardSettings,child.id)).flatMap(child=>entries(child,depth+1))
      ];
      for(const entry of entries(manifest)) {
        const key=JSON.stringify([entry.action,entry.moduleId,entry.modulePath]);
        keys.add(key);
        let node=item.buttons.get(key);
        if(!node){node=button(entry.action,entry.label,entry.icon);item.buttons.set(key,node);}
        text(node.querySelector('.tree-title'),entry.label);
        node.classList.toggle('nav-submodule',entry.depth>0);
        attr(node,'data-module-id',entry.moduleId??null);
        attr(node,'data-module-workspace',entry.action==='module-open'?'true':null);
        attr(node,'data-module-path',entry.moduleId?entry.modulePath??'':null);
        active(node,entry.action==='module-open'
          ?state.page==='module'&&state.moduleId===entry.moduleId&&parseScope(state.modulePath).projectId===parseScope(entry.modulePath).projectId&&(!entry.modulePath||state.modulePath===entry.modulePath||state.modulePath?.startsWith(entry.modulePath+'/'))
          :entry.action==='website'?state.page==='website'||state.page==='websites'||explicitWebsite(state)&&['appearance','branding'].includes(state.page):entry.action==='publishing'?state.page==='publishing'||explicitWebsite(state)&&['integrations','review'].includes(state.page):state.page===entry.action);
        ordered.push(node);
      }
      for(const [key,node] of item.buttons)if(!keys.has(key)){node.remove();item.buttons.delete(key);}
      orderNavigationNodes(item.node,ordered);
    }
    for(const [id,item] of modules)if(!wanted.has(id)){item.node.remove();modules.delete(id);structureChanged=true;}
    return structureChanged;
  }

  function updateTree(initial) {
    const book=state.book,wantedProjects=new Set(book.projects.map(p=>p.id)),wantedNotebooks=new Set();
    const selected=state.projectOwner?.projectId??state.project,key=JSON.stringify([selected,state.projectOwner?.labBookId??state.notebook]),changed=key!==selectedTrail;selectedTrail=key;
    const trail=new Set(ancestors(book,selected).map(p=>p.id));
    for(const project of book.projects){
      if(!projects.has(project.id)){
        const node=element('details','tree-project'),summary=element('summary'),link=element('button','tree-project-link');
        node.dataset.projectId=project.id;link.type='button';link.dataset.action='open-project';link.dataset.id=project.id;
        summary.append(link);node.append(summary);const item={node,summary,link,tools:new Map(),disclosureTouched:false};projects.set(project.id,item);
        summary.addEventListener('click',event=>{if(!event.target.closest('button'))item.disclosureTouched=true;});
        if(trail.has(project.id))node.open=true;
      }
      const item=projects.get(project.id);if((initial||changed)&&!item.disclosureTouched&&trail.has(project.id))item.node.open=true;
      text(item.link,project.title);attr(item.link,'aria-label',t('navigation','openProject',{title:project.title}));
      active(item.link,state.page==='project'&&state.project===project.id);
    }
    for(const project of book.projects){
      const item=projects.get(project.id),ordered=[item.summary,...childrenOf(book,project.id).map(p=>projects.get(p.id).node)];
      const tools=locationTools(state.dashboardSettings,book,project.id),wantedTools=new Set(tools.map(m=>m.id));
      for(const module of tools){
        let node=item.tools.get(module.id);
        if(!node){node=button('module-open',module.locationTool.label,'folder');node.classList.add('location-tool-link');node.dataset.moduleId=module.id;item.tools.set(module.id,node);}
        text(node.querySelector('.tree-title'),locationToolLabel(book,project.id,module));
        node.dataset.modulePath=scopePath(project.id,module.locationTool.path);node.dataset.moduleProjectId=project.id;
        active(node,state.page==='module'&&state.moduleId===module.id&&parseScope(state.modulePath).projectId===project.id);ordered.push(node);
      }
      for(const [id,node] of item.tools)if(!wantedTools.has(id)){node.remove();item.tools.delete(id);}
      for(const notebook of notebookDirectory(book,project.id,{counts:(state.workspaceOutline??state.recordScope)?.notebookCounts})){
        wantedNotebooks.add(notebook.id);let node=notebooks.get(notebook.id);
        if(!node){node=button('filter-notebook',notebook.title,'book');node.classList.add('notebook-link');node.dataset.id=notebook.id;node.append(element('span','count'));notebooks.set(notebook.id,node);}
        text(node.querySelector('.tree-title'),notebook.title);text(node.querySelector('.count'),notebook.count??'');
        active(node,['entries','editor','record-reader'].includes(state.page)&&(state.projectOwner?.labBookId??state.notebook)===notebook.id);ordered.push(node);
      }
      orderNavigationNodes(item.node,ordered);
    }
    for(const [id,node] of notebooks)if(!wantedNotebooks.has(id)){node.remove();notebooks.delete(id);}
    for(const [id,item] of projects)if(!wantedProjects.has(id)){item.node.remove();projects.delete(id);}
    orderNavigationNodes(tree,childrenOf(book).map(p=>projects.get(p.id).node));
    projectsSection.hidden=false;
    active(projectOverview,state.page==='projects');
  }
  function updateIdentity() {
    text(name,state.book.title);attr(identity,'title',state.book.title);
    const wanted=new Set(),ordered=[];
    for(const logo of logosFor(state.book,'home')) {
      wanted.add(logo.id);
      let node=logos.get(logo.id);
      if(!node){node=element('img','workspace-logo');node.src='/api/media/'+logo.id;logos.set(logo.id,node);}
      attr(node,'alt',logo.alt??'');ordered.push(node);
    }
    for(const [id,node] of logos)if(!wanted.has(id)){node.remove();logos.delete(id);}
    orderNavigationNodes(identity,document.documentElement.dataset.headerOrder==='title-first'?[name,...ordered]:[...ordered,name]);
  }
  return {
    unmount,
    update(sidebar,topbar) {
      const key=state.storage?.contextId??state.book.id;
      const initial=host!==sidebar||context!==key;
      if(initial)mount(sidebar,topbar,key);
      root.querySelector('nav').setAttribute('aria-label',t('navigation','dashboard'));
      text(dashboard.querySelector('.tree-title'),t('navigation','dashboard'));
      for(const [action,key] of [['storage-workspaces','workspaces'],['preferences','preferences']]){
        const node=settings.querySelector('[data-action="'+action+'"]');text(node.querySelector('.tree-title'),t('navigation',key));attr(node,'lang',language());
      }
      attr(dashboard,'lang',language());attr(projectsSection.querySelector('.workspace-label'),'lang',language());
      text(projectOverview,t('navigation','projects'));attr(projectOverview,'title',t('navigation','overview'));
      attr(projectsSection.querySelector('[data-action="new-project"]'),'aria-label',t('navigation','newProject'));
      text(settings.firstElementChild,t('navigation','settings'));attr(settings.firstElementChild,'lang',language());
      attr(settings,'aria-label',t('navigation','workspaceSettings'));
      text(lock.querySelector('.tree-title'),t('navigation','lock'));attr(lock,'lang',language());
      const structureChanged=updateModules();
      updateTree(initial);updateIdentity();
      active(dashboard,state.page==='workspace');
      active(settings.querySelector('[data-action="storage-workspaces"]'),state.page==='workspaces');
      active(settings.querySelector('[data-action="preferences"]'),!explicitWebsite(state)&&(preferencePage(state.page)||state.page==='branding'&&(!state.brandReturn||state.brandReturn.startsWith('#/preferences'))));
      if(state.access?.protected){if(!lock.isConnected)settings.append(lock);}else lock.remove();
      return initial||structureChanged;
    }
  };
}
