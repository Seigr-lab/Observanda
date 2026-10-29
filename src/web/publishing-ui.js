import {ux} from './experience-ui.js';
import './i18n/catalogues/repositorySetup.js';
import {websiteContext,explicitWebsite} from './website-context.js';
import {githubConnectionUI} from './github-connection-ui.js';
import {githubDestinationUI} from './github-destination-ui.js';
import {verificationStatus,verificationActions} from './publication-verification-view.js';
import {deploymentView as renderDeployments} from './deployment-view.js';
import {publicationLinksUI} from './publication-links-ui.js';
import {t} from './i18n/index.js';
import './i18n/catalogues/websiteAuthoring.js';
import authoringMessages from './locales/en/websiteAuthoring.json' with {type:'json'};
import publicationMessages from './locales/en/publication.json' with {type:'json'};
import setupMessages from './locales/en/repositorySetup.json' with {type:'json'};
import {publishingMessage as displayMessage,publishingError as errorText,publishingJobText as jobText} from './publishing-presentation.js';
import {publicationText,destinationPlanRows,destinationConflictCount} from './publication-review.js';
import {requireAnalysisEditionReview} from './analysis-review-ui.js';
export function publishingUI({state,api,esc,field,option,render,notify,showDialog,onChange}) {
  const msg=(key,args)=>t('websiteAuthoring',key,args),text=(key,args)=>esc(msg(key,args));
  const legacyLinks=publicationLinksUI({state,api,esc,field,showDialog});
  const destinations=githubDestinationUI({state,api,esc,field,select:values=>{
    for(const [key,value] of Object.entries(values)){const element=document.querySelector('[data-destination="github.'+key+'"]');if(element){element.value=value;input(element);}}
  }});
  const github=githubConnectionUI({state,api,esc,field,notify,onConnectionChange:()=>destinations.invalidate()});
  let verificationJob=null;
  let saved=null,version=0,pending=null,deployments=null,cursor=null,previous=[],timer=null,loadId=0,workspaceContext=null,repositoryMode='existing',visibility='private',setupJob=null,setupTimer=null;
  const setupText=(key,values)=>t('repositorySetup',key,values);
  let emptyReview=null;
  const planPageRequests=new WeakMap();
  let planTimer=null;const planRequests=new WeakMap();
  function renderPlan(){const approvals=['review-confirm','rollback-confirm'].map(id=>[id,!!document.getElementById(id)?.checked]);render();for(const [id,checked] of approvals){const el=document.getElementById(id);if(el)el.checked=checked;}}
  function schedulePlan(preview){
    clearTimeout(planTimer);const context=websiteContext(state),route=location.hash,operationId=preview.destinationOperation.id;
    planTimer=setTimeout(async()=>{
      if(state.preview!==preview||context!==websiteContext(state)||route!==location.hash||preview.destinationOperation?.id!==operationId)return;
      try{
        const result=await api('/api/publishing/plan-operation',{id:preview.destinationOperation.id},{adopt:false,websitePin:preview.websitePin});
        if(state.preview!==preview||context!==websiteContext(state)||route!==location.hash||preview.destinationOperation?.id!==operationId)return;
        preview.destinationOperation=result.job;
        if(result.plan){preview.destinationPlan=result.plan;renderPlan();if(preview.publishAfterPlan&&!result.plan.requiresReview){preview.publishAfterPlan=false;await action({dataset:{action:'publish-release'}});}return;}
        const status=document.getElementById('destination-operation-status');if(status)status.textContent=jobText(result.job);
        if(['queued','running'].includes(result.job.state))schedulePlan(preview);else renderPlan();
      }catch(error){if(state.preview===preview&&context===websiteContext(state)&&route===location.hash&&preview.destinationOperation?.id===operationId){notify(errorText(error),true);preview.destinationOperation=null;renderPlan();}}
    },750);
  }
  async function restorePlan(preview){
    if(!preview||preview.destination?.kind!=='github')return;const context=websiteContext(state),route=location.hash,request=planRequests.get(preview);
    try{
      const result=await api('/api/publishing/plan-operation',{action:'current',reviewId:preview.id,configEtag:preview.configEtag,rollbackReview:preview.rollback?.id??null},{adopt:false,websitePin:preview.websitePin});
      if(state.preview!==preview||context!==websiteContext(state)||route!==location.hash||!result.job||planRequests.get(preview)!==request)return;
      preview.destinationOperation=result.job;if(result.plan)preview.destinationPlan=result.plan;renderPlan();if(['queued','running'].includes(result.job.state))schedulePlan(preview);
    }catch(error){if(state.preview===preview&&context===websiteContext(state)&&route===location.hash&&planRequests.get(preview)===request)notify(errorText(error),true);}
  }
  async function requestPlan(preview,options={},publishAfterPlan=false){
    const context=websiteContext(state),route=location.hash;clearTimeout(planTimer);planRequests.set(preview,(planRequests.get(preview)??0)+1);
    preview.destinationPlan=null;preview.publishAfterPlan=publishAfterPlan;preview.destinationOperation={state:'queued',progress:{stage:publicationMessages.repositoryReviewStarting}};renderPlan();
    try{
      const result=await api('/api/publishing/plan',{id:preview.id,configEtag:preview.configEtag,commandId:crypto.randomUUID(),background:true,...options,...(preview.rollback?{rollbackReview:preview.rollback.id}:{})},{adopt:false,websitePin:preview.websitePin});
      if(state.preview!==preview||context!==websiteContext(state)||route!==location.hash)return;
      preview.destinationOperation=result.job;renderPlan();schedulePlan(preview);
    }catch(error){if(state.preview===preview){preview.destinationOperation=null;renderPlan();}throw error;}
  }
  function initializationReview(){
    if(!emptyReview||emptyReview.configEtag!==state.publishing?.etag||state.publishing.dirty||setupJob&&['queued','running'].includes(setupJob.state))return '';
    return `<section id="repository-initialize-review" class="panel"><h3>${esc(setupText('emptyTitle'))}</h3><p>${esc(setupText('emptyGuidance',{repository:emptyReview.name,branch:emptyReview.branch}))}</p><button class="button primary" data-action="publish-initialize-repository">${esc(setupText('initialize'))}</button></section>`;
  }
  let liveTimer=null,liveKey=null,liveStarted=0,liveBusy=false;
  const currentDeployment=()=>!cursor?deployments?.items.find(d=>d.destinationKey===state.publishing?.destinationKey):null;
  function scheduleLiveVerification(){
    clearTimeout(liveTimer);const latest=currentDeployment(),p=state.publishing,c=p?.config,context=websiteContext(state);
    if(verificationJob&&['queued','running','cancelled'].includes(verificationJob.state))return;
    if(cursor||!latest||latest.job.state!=='completed'||latest.receipt?.status!=='uploaded-awaiting-pages'||latest.verification?.files||p.dirty||c?.kind!=='github'||c.github.pages===false||latest.destination!==`${c.github.owner}/${c.github.repository} / ${c.github.branch}${c.github.directory?' / '+c.github.directory:''}`)return;
    if(liveKey!==latest.id){liveKey=latest.id;liveStarted=Date.now();}
    if(Date.now()-liveStarted>600000){state.publishOutcome=authoringMessages.pubLiveTimeout;const status=document.getElementById('publish-outcome');if(status)status.textContent=outcome();return;}
    liveTimer=setTimeout(async()=>{
      if(liveBusy||context!==websiteContext(state)||state.page!=='publishing'||state.publishing.etag!==p.etag||state.publishing.dirty)return;
      liveBusy=true;
      try{
        state.publishOutcome=authoringMessages.pubLiveChecking;const status=document.getElementById('publish-outcome');if(status)status.textContent=outcome();
        const result=await api('/api/publishing/verify',{configEtag:p.etag,commit:latest.commit});
        if(context!==websiteContext(state)||state.page!=='publishing'||state.publishing.etag!==p.etag)return;
        state.publishOutcome=result.job?null:result.message;await load();render();
      }catch(error){
        if(context!==websiteContext(state)||state.page!=='publishing'||state.publishing.etag!==p.etag)return;
        state.publishOutcome=error.code==='PUBLISH_NOT_LIVE'?publicationMessages.liveRetrying:errorText(error);
        if(error.code==='PUBLISH_NOT_LIVE')await refreshDeployments();
        const status=document.getElementById('publish-outcome');if(status)status.textContent=outcome();
        if(error.code==='PUBLISH_NOT_LIVE')scheduleLiveVerification();
      }finally{liveBusy=false;}
    },5000);
  }
  async function load(){if(workspaceContext!==websiteContext(state)){workspaceContext=websiteContext(state);verificationJob=null;emptyReview=null;cursor=null;previous=[];deployments=null;state.publishOutcome=null;setupJob=null;repositoryMode='existing';clearTimeout(setupTimer);}state.publishing=await api('/api/publishing');await github.refresh();saved=structuredClone(state.publishing);if(state.storage?.encrypted){await refreshDeployments();setupJob=(await api('/api/repository-setup/current',{})).job;if(setupJob&&['queued','running'].includes(setupJob.state))scheduleSetup();}onChange();}
  function scheduleSetup(){clearTimeout(setupTimer);const context=websiteContext(state);setupTimer=setTimeout(()=>{if(context===websiteContext(state)&&document.getElementById('repository-setup-status'))refreshSetup().catch(error=>notify(errorText(error),true));},750);}
  function setupStatus(){if(!setupJob||setupJob.state==='completed')return '';const active=['queued','running'].includes(setupJob.state);return `<section id="repository-setup-status" class="panel"><h3>${esc(setupText('title'))}</h3><p role="status">${esc(jobText(setupJob))}</p><p>${esc(setupText('guidance'))}</p>${active?'<button class="button" data-action="publish-setup-cancel">' +esc(setupText('stop'))+'</button>':'<button class="button" data-action="publish-setup-retry">' +esc(setupText('resume'))+'</button>'}</section>`;}
  async function refreshSetup(){
    const context=websiteContext(state),job=(await api('/api/repository-setup/status',{id:setupJob.id})).job;if(context!==websiteContext(state))return;
    setupJob=job;const pane=document.getElementById('repository-setup-status');
    if(job.state==='completed'){repositoryMode='existing';emptyReview=null;await load();state.publishOutcome=setupMessages[job.result?.initialized?'initialized':'created'];render();return;}
    if(pane)pane.outerHTML=setupStatus();if(['queued','running'].includes(job.state))scheduleSetup();else render();
  }
  const deploymentCall=(op,data={})=>api('/api/deployment-jobs/'+op,data,{adopt:false});
  const outcome=()=>{
    const latest=currentDeployment();if(latest&&latest.job.state!=='completed')return jobText(latest.job);
    if(verificationJob?.state==='failed'&&verificationJob.error==='PUBLISH_NOT_LIVE'&&state.publishing?.config.kind==='github'&&state.publishing.config.github.pages!==false&&liveStarted&&Date.now()-liveStarted<=600000)return publicationText('liveRetrying');
    const live=verificationStatus(verificationJob);if(live)return live;
    if(state.publishOutcome)return displayMessage(state.publishOutcome);
    const receipt=state.publishing?.receipt,verification=receipt?.verification;
    if(verification)return publicationText(verification.failed?'liveFailed':verification.files?'liveVerified':'liveManifestOnly',{count:verification.files,removed:verification.removed??0});
    return publicationText(receipt?'livePending':'deploymentsEmpty');
  };
  async function refreshDeployments(){
    clearTimeout(timer);const token=++loadId,context=websiteContext(state),[result,check]=await Promise.all([deploymentCall('list',{cursor}),api('/api/publishing/verification',{}, {adopt:false})]);
    if(token!==loadId||context!==websiteContext(state))return;
    deployments=result;verificationJob=check.job;state.publishing.receipt=check.receipt;for(const item of deployments.items)if(item.id===check.receipt?.deploymentId)item.verification=check.receipt.verification??null;const checkActions=document.getElementById('publish-live-check');if(checkActions)checkActions.innerHTML=verificationActions(verificationJob,esc,state.publishing?.receipt?.verification);const pane=document.getElementById('publishing-deployments');
    if(pane){const focus=document.activeElement,action=focus?.dataset.action,id=focus?.dataset.id;pane.innerHTML=deploymentView();if(action&&id)pane.querySelector('[data-action="'+action+'"][data-id="'+id+'"]')?.focus();}
    const status=document.getElementById('publish-outcome');if(status)status.textContent=outcome();
    scheduleLiveVerification();
    if(result.items.some(item=>['queued','running'].includes(item.job.state))||verificationJob&&['queued','running'].includes(verificationJob.state))timer=setTimeout(()=>{if(state.page==='publishing'&&context===websiteContext(state))refreshDeployments().catch(error=>notify(errorText(error),true));},1000);
  }
  const deploymentView=()=>renderDeployments(deployments,{esc,previous:previous.length});
  async function save(){
    if(pending){await pending;return save();}if(!state.publishing?.dirty)return;
    const edit=version,context=websiteContext(state),config=structuredClone(state.publishing.config);pending=api('/api/publishing/save',{config,etag:state.publishing.etag});
    try{const result=await pending;if(context!==websiteContext(state))return;saved=structuredClone(result);if(edit===version)state.publishing=result;else state.publishing.etag=result.etag;state.preview=null;state.publishOutcome=null;verificationJob=null;deployments=null;const status=document.querySelector('#destination-status');if(status)status.textContent=state.publishing.dirty?publicationText('destinationDirty'):publicationText('destinationSaved');const live=document.getElementById('publish-outcome');if(live)live.textContent=outcome();const actions=document.getElementById('publish-live-check');if(actions)actions.innerHTML='';onChange();}finally{pending=null;}
  }
  function refreshDestination(){
    // Keep the independent token form mounted while saving destination settings.
    if(state.page!=='integrations'||state.publishing?.dirty)return;
    const current=document.querySelector('#destination-status')?.closest('section');if(!current)return;
    const action=current.contains(document.activeElement)?document.activeElement.dataset.action:null;
    const template=document.createElement('template');template.innerHTML=view(true);
    const next=template.content.querySelector('#destination-status')?.closest('section');
    if(next){current.replaceWith(next);if(action)next.querySelector('[data-action="'+action+'"]')?.focus();}
  }
  async function discard(){if(pending)await pending;if(saved)state.publishing=structuredClone(saved);else await load();onChange();}

  function view(configure=false){
    const p=state.publishing;if(!p)return `<p>${text('pubLoading')}</p>`;
    const c=p.config,limits=c.limits?.[c.kind]??{maxFileBytes:0,maxTotalBytes:0};
    if(configure&&setupJob&&['queued','running'].includes(setupJob.state))return `<div class="page-heading"><h2>${text('pubSettingUp')}</h2></div><p>${esc(c.github.owner+'/'+c.github.repository)}</p>${setupStatus()}<p>${text('pubStopHelp')}</p>`;
    if(!configure)return `<div class="page-heading"><h1>${text('pubTitle')}</h1></div><section class="workflow-guide"><ol class="publication-journey"><li><strong>${esc(ux('designStep'))}</strong><button class="button" data-action="website">${esc(ux('compose'))}</button></li><li aria-current="step"><strong>${esc(ux('previewStep'))}</strong><button class="button primary" data-action="preview">${esc(ux('prepareReview'))}</button></li><li><strong>${esc(ux('releaseStep'))}</strong><span>${esc(ux('publishingHelp'))}</span></li></ol><p>${esc(ux('publishingJourney'))}</p></section><section class="panel"><h2>${text('pubDestination')}</h2><p>${p.configured?esc(c.kind==='github'?`${c.github.owner}/${c.github.repository} / ${c.github.branch}${c.github.directory?' / '+c.github.directory:''}`:`${c.ssh.host} / ${c.ssh.directory}`):text('pubNoDestination')}</p>${c.publicUrl?`<p>${esc(c.publicUrl)}</p>`:''}<button class="button" data-action="integrations">${text('pubConfigure')}</button></section>${state.storage?.encrypted?`<section class="panel"><h2>${text('pubEditions')}</h2><p>${text('pubEditionsHelp')}</p><button class="button" data-action="publication-jobs-list">${text('pubPreparations')}</button></section>`:''}<section class="panel"><h2>${text('pubLastOperation')}</h2><p id="publish-outcome" role="status">${esc(outcome())}</p><div id="publish-live-check">${verificationActions(verificationJob,esc,state.publishing?.receipt?.verification)}</div><button class="button" data-action="publish-verify" ${p.configured?'':'disabled'}>${text('pubVerify')}</button></section>${state.storage?.encrypted?`<section id="publishing-deployments">${deploymentView()}</section>`:''}`;

    const input=(scope,key,label,type='text')=>field(esc(label),`<input type="${type}" data-destination="${scope}.${key}" value="${esc(c[scope][key]??'')}" ${type==='number'?'min="1" max="65535"':'maxlength="1000"'} ${scope==='github'&&key==='branch'&&!p.configured&&repositoryMode==='create'?'readonly':''}>`);
    return `<div class="page-heading"><div><h2>${esc(explicitWebsite(state)?t('websiteSites','destination'):msg('pubIntegrations'))}</h2></div></div><div class="settings-grid"><section class="panel"><h2>${text('pubDestination')}</h2>${field(text('pubWith'),`<select id="publisher-kind">${option('github',msg('pubGithub'),c.kind)}${option('ssh',msg('pubSsh'),c.kind)}</select>`)}${c.kind==='github'?`${!p.configured&&state.storage?.encrypted?field(text('pubRepository'),`<select id="publisher-repository-mode">${option('existing',msg('pubExistingRepository'),repositoryMode)}${option('create',msg('pubNewRepository'),repositoryMode)}</select>`):''}${destinations.view()}<div class="form-grid">${input('github','owner',msg('pubOwner'))}${input('github','repository',msg('pubRepositoryName'))}${input('github','branch',msg('pubBranch'))}${input('github','directory',publicationText('websiteFolder'))}</div><p class="muted">${esc(publicationText('websiteFolderHint'))}</p>${!p.configured&&repositoryMode==='create'?field(text('pubVisibility'),`<select id="publisher-repository-visibility">${option('private',msg('pubPrivate'),visibility)}${option('public',msg('pubPublic'),visibility)}</select>`)+ `<p>${text('pubRepositoryHelp')}</p>`:''}${field(text('pubAfterUpload'),`<select id="publisher-pages">${option('upload',msg('pubUploadOnly'),c.github.pages===false?'upload':'pages')}${option('pages',msg('pubConfigurePages'),c.github.pages===false?'upload':'pages')}</select>`)}<p class="muted">${text('pubUploadOnlyHelp')}</p><p class="muted">${esc(publicationText('ownershipHint'))}</p>`:`<div class="form-grid">${input('ssh','host',msg('pubSshHost'))}${input('ssh','port',msg('pubSshPort'),'number')}${input('ssh','user',msg('pubSshUser'))}${input('ssh','directory',msg('pubSshDirectory'))}${input('ssh','identityFile',msg('pubSshIdentity'))}</div><p class="muted">${text('pubSshHelp',{current:'current',releases:'releases'})}</p>`}${field(text('pubUrl'),`<input id="publisher-url" type="url" value="${esc(c.publicUrl)}" placeholder="https://example.org/research/" maxlength="1000">`)}<details class="hosting-limits"><summary>${text('pubHostingLimits')}</summary><p class="muted">${text('pubLimitsHelp')}</p><div class="form-grid">${field(text('pubMaxFile'),`<input data-host-limit="maxFileBytes" type="number" min="0" step="any" value="${limits.maxFileBytes?limits.maxFileBytes/1048576:''}" placeholder="${text('pubNoLimit')}">`)}${field(text('pubMaxSite'),`<input data-host-limit="maxTotalBytes" type="number" min="0" step="any" value="${limits.maxTotalBytes?limits.maxTotalBytes/1048576:''}" placeholder="${text('pubNoLimit')}">`)}</div></details><div class="inline-actions"><button class="button" data-action="publish-discard">${text('pubDiscard')}</button>${!p.configured&&repositoryMode==='create'?`<button class="button primary" data-action="publish-create-repository" ${setupJob&&['queued','running'].includes(setupJob.state)?'disabled':''}>${text('pubCreate')}</button>`:`<button class="button primary" data-action="publish-save">${text('pubSave')}</button>`}<button class="button" data-action="publish-check">${text('pubCheck')}</button></div>${setupStatus()}${initializationReview()}<p id="destination-status" role="status" class="muted">${esc(p.dirty?publicationText('destinationDirty'):p.configured?publicationText('destinationSaved'):msg('pubNotSaved'))}</p></section><aside>${c.kind==='github'?github.view():`<section class="panel"><h2>${text('pubAccess')}</h2><p class="muted">${text('pubSshAccessHelp')}</p></section>`}<section class="panel"><h2>${text('pubLastOperation')}</h2><p id="publish-outcome" role="status">${esc(outcome())}</p><div id="publish-live-check">${verificationActions(verificationJob,esc,state.publishing?.receipt?.verification)}</div><button class="button" data-action="publish-verify">${text('pubVerify')}</button></section></aside></div>`;
  }
  function input(el){
    if(destinations.input(el))return true;
    if(el.id==='publisher-repository-mode'){repositoryMode=el.value;if(repositoryMode==='create')state.publishing.config.github.branch='main';render();return true;}
    if(el.id==='publisher-repository-visibility'){visibility=el.value;return true;}
    if(el.dataset.hostLimit){const config=state.publishing.config;config.limits??={github:{maxFileBytes:0,maxTotalBytes:0},ssh:{maxFileBytes:0,maxTotalBytes:0}};config.limits[config.kind][el.dataset.hostLimit]=Math.round(Number(el.value)*1048576);}
    else if(el.dataset.destination){const [scope,key]=el.dataset.destination.split('.');state.publishing.config[scope][key]=el.type==='number'?Number(el.value):el.value;}
    else if(el.id==='publisher-pages')state.publishing.config.github.pages=el.value==='pages';
    else if(el.id==='publisher-url')state.publishing.config.publicUrl=el.value;
    else if(el.id==='publisher-kind'){state.publishing.config.kind=el.value;state.publishing.dirty=true;version++;onChange();render();return true;}
    else return false;
    if(emptyReview){emptyReview=null;document.querySelector('#repository-initialize-review')?.remove();}state.publishing.dirty=true;version++;onChange();const status=document.querySelector('#destination-status');if(status)status.textContent=publicationText('destinationDirty');return true;
  }
  async function action(button){
    const name=button.dataset.action;
    if(await destinations.action(button))return true;
    if(await github.action(button))return true;
    if(['publish-live-cancel','publish-live-retry'].includes(name)){await api('/api/publishing/verification-'+(name.endsWith('cancel')?'cancel':'retry'),{id:button.dataset.id});state.publishOutcome=null;await load();render();return true;}
    if(name==='publish-legacy-links'){await legacyLinks.action({dataset:{action:'publication-links-open'}});return true;}
    if(await legacyLinks.action(button))return true;
    if(name==='publishing'){if(!state.publishing?.dirty)await load();state.page='publishing';render();return true;}
    if(!name.startsWith('publish-'))return false;
    button.disabled=true;
    try{
      if(name==='publish-initialize-repository'){
        const review=emptyReview,context=websiteContext(state);if(!review||state.publishing.dirty||review.configEtag!==state.publishing.etag)return true;
        const result=await api('/api/repository-setup/initialize',{review:review.id,configEtag:review.configEtag,confirmed:true});
        if(context!==websiteContext(state))return true;setupJob=result.job;emptyReview=null;render();scheduleSetup();return true;
      }
      if(name==='publish-create-repository'){
        if(!state.publishing.connected){notify(msg('pubConnectFirst'),true);return true;}
        const config=structuredClone(state.publishing.config);config.github.branch='main';
        setupJob=(await api('/api/repository-setup/start',{config,etag:state.publishing.etag,visibility,confirmed:true})).job;render();scheduleSetup();return true;
      }
      if(name==='publish-setup-retry'||name==='publish-setup-cancel'){
        setupJob=(await api('/api/repository-setup/'+(name==='publish-setup-retry'?'retry':'cancel'),{id:setupJob.id})).job;render();scheduleSetup();return true;
      }
      if(name==='publish-plan-page'){
        const preview=state.preview,plan=preview?.destinationPlan,kind=button.dataset.kind,context=websiteContext(state),route=location.hash;
        if(!plan)return true;
        let requests=planPageRequests.get(plan);if(!requests){requests=new Map();planPageRequests.set(plan,requests);}const version=(requests.get(kind)??0)+1;requests.set(kind,version);
        const page=await api('/api/publishing/plan-page',{id:plan.id,configEtag:plan.configEtag,kind,offset:Number(button.dataset.offset)},{adopt:false,websitePin:preview.websitePin});
        if(requests.get(kind)===version&&preview===state.preview&&plan===preview.destinationPlan&&context===websiteContext(state)&&route===location.hash){plan[kind]=page.items;plan.windows[kind]={offset:page.offset,next:page.next};const host=document.querySelector(`[data-plan-rows="${kind}"]`);if(host)host.innerHTML=destinationPlanRows(plan,kind,{esc});}
        return true;
      }
      if(['publish-plan-cancel','publish-plan-retry'].includes(name)){
        const preview=state.preview,action=name.endsWith('cancel')?'cancel':'retry',result=await api('/api/publishing/plan-operation',{id:preview.destinationOperation.id,action},{adopt:false,websitePin:preview.websitePin});
        if(state.preview===preview){preview.destinationOperation=result.job;renderPlan();schedulePlan(preview);}return true;
      }
      if(['publish-refresh-plan','publish-replacement-plan','publish-owned-plan'].includes(name)){
        const preview=state.preview,replaceExisting=name==='publish-replacement-plan'||name==='publish-refresh-plan'&&!!preview.destinationPlan?.replacement,archiveBranch=replaceExisting?(name==='publish-replacement-plan'?document.getElementById('replacement-archive-branch')?.value.trim()||null:preview.destinationPlan.replacement.archiveBranch):null;
        await requestPlan(preview,{replaceExisting,archiveBranch});return true;
      }
      if(name==='publish-job-cancel'||name==='publish-job-retry'){await deploymentCall(name==='publish-job-cancel'?'cancel':'retry',{id:button.dataset.id});await refreshDeployments();return true;}
      if(name.startsWith('publish-jobs-')){if(name==='publish-jobs-next'&&deployments?.next){previous.push(cursor);cursor=deployments.next;}if(name==='publish-jobs-previous'&&previous.length)cursor=previous.pop();await refreshDeployments();return true;}
      if(name==='publish-discard'){await discard();render();}
      if(name==='publish-save'){const context=websiteContext(state);await save();if(context!==websiteContext(state))return true;refreshDestination();notify(state.publishing.dirty?publicationText('earlierDestinationSaved'):publicationText('destinationSavedNotice'));}
      if(['publish-check','publish-release','publish-verify'].includes(name)&&pending){const context=websiteContext(state);await pending;if(context!==websiteContext(state))return true;}
      if(['publish-check','publish-release','publish-verify'].includes(name)&&state.publishing?.dirty){notify(msg('pubSaveFirst'),true);return true;}
      if(name==='publish-check'){
        const context=websiteContext(state),etag=state.publishing.etag,route=location.hash;
        const current=()=>context===websiteContext(state)&&etag===state.publishing.etag&&!state.publishing.dirty&&route===location.hash;
        emptyReview=null;
        try{const result=await api('/api/publishing/check',{});if(current()){state.publishOutcome=result.message;render();}}
        catch(error){
          if(error.code!=='PUBLISH_EMPTY_REPO'||!state.storage?.encrypted||!current())throw error;
          const review=await api('/api/repository-setup/review',{configEtag:etag});
          if(current()){emptyReview=review;state.publishOutcome=setupMessages.emptyStatus;render();document.querySelector('#repository-initialize-review')?.scrollIntoView({block:'center'});}
        }
      }
      if(name==='publish-disconnect'){await api('/api/publishing/disconnect',{});await load();render();}
      if(name==='publish-rollback-review'){
        const preview=state.preview,context=websiteContext(state),route=location.hash;
        const result=await api('/api/publication-jobs/rollback-review',{id:preview.id},{adopt:false,websitePin:preview.websitePin});
        if(state.preview===preview&&context===websiteContext(state)&&route===location.hash){state.preview={...result,returnTo:preview.returnTo};render();}
      }
      if(name==='publish-release'){
        if(state.preview.rollback&&!document.querySelector('#rollback-confirm')?.checked){notify(publicationText('rollbackConfirm'),true);return true;}
        requireAnalysisEditionReview(state.preview);
        if(!document.querySelector('#review-confirm')?.checked){notify(msg('pubConfirmWebsite'),true);return true;}
        if(state.preview.destination?.kind==='github'&&!state.preview.destinationPlan){await requestPlan(state.preview,{},true);return true;}
        if(destinationConflictCount(state.preview.destinationPlan)){notify(publicationText('conflictGuidance'),true);return true;}
        const plan=state.preview.destinationPlan,destinationReviewed=!!document.querySelector('#destination-confirm')?.checked;
        if(plan?.requiresReview&&!destinationReviewed){notify(msg('pubConfirmRepository'),true);return true;}
        const result=await api('/api/publishing/deploy',{id:state.preview.id,configEtag:state.preview.configEtag,reviewed:true,...(state.preview.rollback?{rollbackReview:state.preview.rollback.id,rollbackConfirmed:true}:{}),...(plan?{destinationReview:plan.id,destinationReviewed}: {})},{websitePin:state.preview.websitePin});
        state.publishOutcome=result.job?null:result.status==='uploaded-repository-only'?authoringMessages.pubRepositoryUploaded:result.status==='uploaded-remote-verified'?authoringMessages.pubSshUploaded:result.status==='uploaded-pages-setup-required'?authoringMessages.pubPagesFailed:authoringMessages.pubPagesPending;
        state.page='publishing';await load();render();
      }
      if(name==='publish-verify'){try{const result=await api('/api/publishing/verify',{});state.publishOutcome=result.job?null:result.message;}catch(error){state.publishOutcome=errorText(error);await load();render();throw error;}await load();render();}
    }finally{button.disabled=false;}
    return true;
  }
  async function submit(form,data){if(form.id!=='publish-token-form')return false;const token=data.get('token'),context=websiteContext(state);form.querySelector('[name=token]').value='';if(pending)await pending;if(context!==websiteContext(state))return true;const result=await api('/api/publishing/connect',{token});if(context!==websiteContext(state))return true;state.publishing.connected=result.connected;state.publishing.temporaryToken=true;destinations.invalidate();notify(publicationText('connectedNotice'));render();return true;}
  return {view,load,input,action,submit,save,discard,restorePlan};
}
