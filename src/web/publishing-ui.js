import {websiteContext} from './website-context.js';
import {githubConnectionUI} from './github-connection-ui.js';
import {verificationStatus,verificationActions} from './publication-verification-view.js';
import {deploymentView as renderDeployments} from './deployment-view.js';
import {publicationLinksUI} from './publication-links-ui.js';
import {t} from './i18n/index.js';
import {publicationText} from './publication-review.js';
import {requireAnalysisEditionReview} from './analysis-review-ui.js';
export function publishingUI({state,api,esc,field,option,render,notify,showDialog,onChange}) {
  const legacyLinks=publicationLinksUI({state,api,esc,field,showDialog});
  const github=githubConnectionUI({state,api,esc,field,notify});
  let verificationJob=null;
  let saved=null,version=0,pending=null,deployments=null,cursor=null,previous=[],timer=null,loadId=0,workspaceContext=null,repositoryMode='existing',visibility='private',setupJob=null,setupTimer=null;
  const setupText=(key,values)=>t('repositorySetup',key,values);
  let emptyReview=null;
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
    if(Date.now()-liveStarted>600000){state.publishOutcome='The live edition is still unavailable after ten minutes. Use Verify live website to retry.';const status=document.getElementById('publish-outcome');if(status)status.textContent=outcome();return;}
    liveTimer=setTimeout(async()=>{
      if(liveBusy||context!==websiteContext(state)||state.page!=='publishing'||state.publishing.etag!==p.etag||state.publishing.dirty)return;
      liveBusy=true;
      try{
        state.publishOutcome='Checking the live website. GitHub Pages may still be building.';const status=document.getElementById('publish-outcome');if(status)status.textContent=outcome();
        const result=await api('/api/publishing/verify',{configEtag:p.etag,commit:latest.commit});
        if(context!==websiteContext(state)||state.page!=='publishing'||state.publishing.etag!==p.etag)return;
        state.publishOutcome=result.job?null:result.message;await load();render();
      }catch(error){
        if(context!==websiteContext(state)||state.page!=='publishing'||state.publishing.etag!==p.etag)return;
        state.publishOutcome=error.code==='PUBLISH_NOT_LIVE'?publicationText('liveRetrying'):error.message;
        if(error.code==='PUBLISH_NOT_LIVE')await refreshDeployments();
        const status=document.getElementById('publish-outcome');if(status)status.textContent=outcome();
        if(error.code==='PUBLISH_NOT_LIVE')scheduleLiveVerification();
      }finally{liveBusy=false;}
    },5000);
  }
  async function load(){if(workspaceContext!==websiteContext(state)){workspaceContext=websiteContext(state);verificationJob=null;emptyReview=null;cursor=null;previous=[];deployments=null;state.publishOutcome=null;setupJob=null;repositoryMode='existing';clearTimeout(setupTimer);}state.publishing=await api('/api/publishing');await github.refresh();saved=structuredClone(state.publishing);if(state.storage?.encrypted){await refreshDeployments();setupJob=(await api('/api/repository-setup/current',{})).job;if(setupJob&&['queued','running'].includes(setupJob.state))scheduleSetup();}onChange();}
  function scheduleSetup(){clearTimeout(setupTimer);const context=websiteContext(state);setupTimer=setTimeout(()=>{if(context===websiteContext(state)&&document.getElementById('repository-setup-status'))refreshSetup().catch(error=>notify(error.message,true));},750);}
  function setupStatus(){if(!setupJob||setupJob.state==='completed')return '';const active=['queued','running'].includes(setupJob.state);return `<section id="repository-setup-status" class="panel"><h3>${esc(setupText('title'))}</h3><p role="status">${esc(setupJob.message??setupJob.progress.stage)}</p><p>${esc(setupText('guidance'))}</p>${active?'<button class="button" data-action="publish-setup-cancel">' +esc(setupText('stop'))+'</button>':'<button class="button" data-action="publish-setup-retry">' +esc(setupText('resume'))+'</button>'}</section>`;}
  async function refreshSetup(){
    const context=websiteContext(state),job=(await api('/api/repository-setup/status',{id:setupJob.id})).job;if(context!==websiteContext(state))return;
    setupJob=job;const pane=document.getElementById('repository-setup-status');
    if(job.state==='completed'){repositoryMode='existing';emptyReview=null;await load();state.publishOutcome=setupText(job.result?.initialized?'initialized':'created');render();return;}
    if(pane)pane.outerHTML=setupStatus();if(['queued','running'].includes(job.state))scheduleSetup();else render();
  }
  const deploymentCall=(op,data={})=>api('/api/deployment-jobs/'+op,data,{adopt:false});
  const outcome=()=>{
    const latest=currentDeployment();if(latest&&latest.job.state!=='completed')return latest.job.message??latest.job.progress.stage??latest.job.state;
    if(verificationJob?.state==='failed'&&verificationJob.error==='PUBLISH_NOT_LIVE'&&state.publishing?.config.kind==='github'&&state.publishing.config.github.pages!==false&&liveStarted&&Date.now()-liveStarted<=600000)return publicationText('liveRetrying');
    const live=verificationStatus(verificationJob);if(live)return live;
    if(state.publishOutcome)return state.publishOutcome;
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
    if(result.items.some(item=>['queued','running'].includes(item.job.state))||verificationJob&&['queued','running'].includes(verificationJob.state))timer=setTimeout(()=>{if(state.page==='publishing'&&context===websiteContext(state))refreshDeployments().catch(error=>notify(error.message,true));},1000);
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
    const p=state.publishing;if(!p)return '<p>Loading publishing settings...</p>';
    const c=p.config,limits=c.limits?.[c.kind]??{maxFileBytes:0,maxTotalBytes:0};
    if(configure&&setupJob&&['queued','running'].includes(setupJob.state))return `<div class="page-heading"><h2>Setting up website publishing</h2></div><p>${esc(c.github.owner+'/'+c.github.repository)}</p>${setupStatus()}<p>Stopping setup does not delete a repository already created.</p>`;
    if(!configure)return `<div class="page-heading"><h1>Publishing</h1><button class="button primary" data-action="preview">Review website</button></div><section class="panel"><h2>Destination</h2><p>${p.configured?esc(c.kind==='github'?`${c.github.owner}/${c.github.repository} / ${c.github.branch}${c.github.directory?' / '+c.github.directory:''}`:`${c.ssh.host} / ${c.ssh.directory}`):'No destination configured.'}</p>${c.publicUrl?`<p>${esc(c.publicUrl)}</p>`:''}<button class="button" data-action="integrations">Configure destination</button></section>${state.storage?.encrypted?'<section class="panel"><h2>Prepared editions</h2><p>Reopen an edition or resume its preparation after restarting.</p><button class="button" data-action="publication-jobs-list">Website preparations</button></section>':''}<section class="panel"><h2>Last operation</h2><p id="publish-outcome" role="status">${esc(outcome())}</p><div id="publish-live-check">${verificationActions(verificationJob,esc,state.publishing?.receipt?.verification)}</div><button class="button" data-action="publish-verify" ${p.configured?'':'disabled'}>Verify live website</button></section>${state.storage?.encrypted?`<section id="publishing-deployments">${deploymentView()}</section>`:''}`;

    const input=(scope,key,label,type='text')=>field(label,`<input type="${type}" data-destination="${scope}.${key}" value="${esc(c[scope][key]??'')}" ${type==='number'?'min="1" max="65535"':'maxlength="1000"'} ${scope==='github'&&key==='branch'&&!p.configured&&repositoryMode==='create'?'readonly':''}>`);
    return `<div class="page-heading"><div><h2>Integrations</h2></div></div><div class="settings-grid"><section class="panel"><h2>Destination</h2>${field('Publish with',`<select id="publisher-kind">${option('github','GitHub repository',c.kind)}${option('ssh','SFTP / SSH hosting',c.kind)}</select>`)}${c.kind==='github'?`${!p.configured&&state.storage?.encrypted?field('Repository',`<select id="publisher-repository-mode">${option('existing','Use an existing repository',repositoryMode)}${option('create','Create a new repository',repositoryMode)}</select>`):''}<div class="form-grid">${input('github','owner','GitHub owner / organization')}${input('github','repository','Repository name')}${input('github','branch','Publication branch')}${input('github','directory',esc(publicationText('websiteFolder')))}</div><p class="muted">${esc(publicationText('websiteFolderHint'))}</p>${!p.configured&&repositoryMode==='create'?field('Repository visibility',`<select id="publisher-repository-visibility">${option('private','Private',visibility)}${option('public','Public',visibility)}</select>`)+ '<p>Choose a name for the new website repository. Public repositories can be read by anyone. Connect GitHub with permission to create repositories in the selected account or organization.</p>':''}${field('After upload',`<select id="publisher-pages">${option('upload','Upload files only',c.github.pages===false?'upload':'pages')}${option('pages','Configure GitHub Pages',c.github.pages===false?'upload':'pages')}</select>`)}<p class="muted">Upload files only leaves Pages settings unchanged. An existing site or workflow can still run when its branch is updated.</p><p class="muted">${esc(publicationText('ownershipHint'))}</p>`:`<div class="form-grid">${input('ssh','host','SSH hostname')}${input('ssh','port','SSH port','number')}${input('ssh','user','SSH user')}${input('ssh','directory','Dedicated hosting directory')}${input('ssh','identityFile','SSH identity file (optional)')}</div><p class="muted">Uses your OpenSSH key or agent and verified known-host entry. Requires local ssh/sftp and a server with a POSIX shell, find, sha256sum, and GNU coreutils. Serve the <code>current</code> subdirectory of this hosting directory. Each verified release is retained under <code>releases</code>.</p>`}${field('Public website URL (HTTPS)',`<input id="publisher-url" type="url" value="${esc(c.publicUrl)}" placeholder="https://example.org/research/" maxlength="1000">`)}<details class="hosting-limits"><summary>Hosting limits</summary><p class="muted">Blank fields impose no additional limit. Your hosting provider may enforce its own limits.</p><div class="form-grid">${field('Maximum hosted file (MiB)',`<input data-host-limit="maxFileBytes" type="number" min="0" step="any" value="${limits.maxFileBytes?limits.maxFileBytes/1048576:''}" placeholder="No additional limit">`)}${field('Maximum website size (MiB)',`<input data-host-limit="maxTotalBytes" type="number" min="0" step="any" value="${limits.maxTotalBytes?limits.maxTotalBytes/1048576:''}" placeholder="No additional limit">`)}</div></details><div class="inline-actions"><button class="button" data-action="publish-discard">Discard changes</button>${!p.configured&&repositoryMode==='create'?`<button class="button primary" data-action="publish-create-repository" ${setupJob&&['queued','running'].includes(setupJob.state)?'disabled':''}>Create repository</button>`:'<button class="button primary" data-action="publish-save">Save destination</button>'}<button class="button" data-action="publish-check">Check connection</button></div>${setupStatus()}${initializationReview()}<p id="destination-status" role="status" class="muted">${esc(p.dirty?publicationText('destinationDirty'):p.configured?publicationText('destinationSaved'):'No destination saved yet.')}</p></section><aside>${c.kind==='github'?github.view():'<section class="panel"><h2>Access</h2><p class="muted">SSH keys remain in your SSH installation. Observanda does not copy private keys or store passwords. Establish and verify the host key using your SSH client before connecting here.</p></section>'}<section class="panel"><h2>Last operation</h2><p id="publish-outcome" role="status">${esc(outcome())}</p><div id="publish-live-check">${verificationActions(verificationJob,esc,state.publishing?.receipt?.verification)}</div><button class="button" data-action="publish-verify">Verify live website</button></section></aside></div>`;
  }
  function input(el){
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
        if(!state.publishing.connected){notify('Connect GitHub before creating the repository.',true);return true;}
        const config=structuredClone(state.publishing.config);config.github.branch='main';
        setupJob=(await api('/api/repository-setup/start',{config,etag:state.publishing.etag,visibility,confirmed:true})).job;render();scheduleSetup();return true;
      }
      if(name==='publish-setup-retry'||name==='publish-setup-cancel'){
        setupJob=(await api('/api/repository-setup/'+(name==='publish-setup-retry'?'retry':'cancel'),{id:setupJob.id})).job;render();scheduleSetup();return true;
      }
      if(name==='publish-refresh-plan'){
        const preview=state.preview,plan=await api('/api/publishing/plan',{id:preview.id,configEtag:preview.configEtag,...(preview.rollback?{rollbackReview:preview.rollback.id}:{})});
        if(state.preview===preview){preview.destinationPlan=plan;render();}return true;
      }
      if(name==='publish-job-cancel'||name==='publish-job-retry'){await deploymentCall(name==='publish-job-cancel'?'cancel':'retry',{id:button.dataset.id});await refreshDeployments();return true;}
      if(name.startsWith('publish-jobs-')){if(name==='publish-jobs-next'&&deployments?.next){previous.push(cursor);cursor=deployments.next;}if(name==='publish-jobs-previous'&&previous.length)cursor=previous.pop();await refreshDeployments();return true;}
      if(name==='publish-discard'){await discard();render();}
      if(name==='publish-save'){const context=websiteContext(state);await save();if(context!==websiteContext(state))return true;refreshDestination();notify(state.publishing.dirty?publicationText('earlierDestinationSaved'):publicationText('destinationSavedNotice'));}
      if(['publish-check','publish-release','publish-verify'].includes(name)&&pending){const context=websiteContext(state);await pending;if(context!==websiteContext(state))return true;}
      if(['publish-check','publish-release','publish-verify'].includes(name)&&state.publishing?.dirty){notify('Save the destination before continuing.',true);return true;}
      if(name==='publish-check'){
        const context=websiteContext(state),etag=state.publishing.etag,route=location.hash;
        const current=()=>context===websiteContext(state)&&etag===state.publishing.etag&&!state.publishing.dirty&&route===location.hash;
        emptyReview=null;
        try{const result=await api('/api/publishing/check',{});if(current()){state.publishOutcome=result.message;render();}}
        catch(error){
          if(error.code!=='PUBLISH_EMPTY_REPO'||!state.storage?.encrypted||!current())throw error;
          const review=await api('/api/repository-setup/review',{configEtag:etag});
          if(current()){emptyReview=review;state.publishOutcome=setupText('emptyStatus');render();document.querySelector('#repository-initialize-review')?.scrollIntoView({block:'center'});}
        }
      }
      if(name==='publish-disconnect'){await api('/api/publishing/disconnect',{});await load();render();}
      if(name==='publish-rollback-review'){
        const preview=state.preview,context=websiteContext(state),route=location.hash;
        const result=await api('/api/publication-jobs/rollback-review',{id:preview.id},{adopt:false});
        if(state.preview===preview&&context===websiteContext(state)&&route===location.hash){state.preview={...result,returnTo:preview.returnTo};render();}
      }
      if(name==='publish-release'){
        if(state.preview.rollback&&!document.querySelector('#rollback-confirm')?.checked){notify(publicationText('rollbackConfirm'),true);return true;}
        requireAnalysisEditionReview(state.preview);
        if(!document.querySelector('#review-confirm')?.checked){notify('Review the website and confirm it is ready to share.',true);return true;}
        if(state.preview.destination?.kind==='github'&&!state.preview.destinationPlan){
          const preview=state.preview,plan=await api('/api/publishing/plan',{id:preview.id,configEtag:preview.configEtag,...(preview.rollback?{rollbackReview:preview.rollback.id}:{})});
          if(state.preview!==preview)return true;
          preview.destinationPlan=plan;
          if(plan.requiresReview){render();document.querySelector('#review-confirm').checked=true;if(preview.rollback)document.querySelector('#rollback-confirm').checked=true;document.querySelector('#destination-review')?.scrollIntoView({block:'center'});return true;}
        }
        if(state.preview.destinationPlan?.conflicts.length){notify(publicationText('conflictGuidance'),true);return true;}
        const plan=state.preview.destinationPlan,destinationReviewed=!!document.querySelector('#destination-confirm')?.checked;
        if(plan?.requiresReview&&!destinationReviewed){notify('Review and confirm the changes to this website repository.',true);return true;}
        const result=await api('/api/publishing/deploy',{id:state.preview.id,configEtag:state.preview.configEtag,reviewed:true,...(state.preview.rollback?{rollbackReview:state.preview.rollback.id,rollbackConfirmed:true}:{}),...(plan?{destinationReview:plan.id,destinationReviewed}: {})});
        state.publishOutcome=result.job?null:result.status==='uploaded-repository-only'?'Repository files uploaded and verified. Pages settings were left unchanged.':result.status==='uploaded-remote-verified'?'Uploaded and verified on the SSH server. Check the live manifest to verify the web server.':result.status==='uploaded-pages-setup-required'?'Files uploaded and verified. GitHub Pages setup failed; check Pages permissions/settings before retrying.':'Files uploaded and verified. GitHub Pages deployment is pending; check the live manifest after deployment.';
        state.page='publishing';await load();render();
      }
      if(name==='publish-verify'){try{const result=await api('/api/publishing/verify',{});state.publishOutcome=result.job?null:result.message;}catch(error){state.publishOutcome=error.message;await load();render();throw error;}await load();render();}
    }finally{button.disabled=false;}
    return true;
  }
  async function submit(form,data){if(form.id!=='publish-token-form')return false;const token=data.get('token'),context=websiteContext(state);form.querySelector('[name=token]').value='';if(pending)await pending;if(context!==websiteContext(state))return true;const result=await api('/api/publishing/connect',{token});if(context!==websiteContext(state))return true;state.publishing.connected=result.connected;state.publishing.temporaryToken=true;notify(publicationText('connectedNotice'));render();return true;}
  return {view,load,input,action,submit,save,discard};
}
