import {githubPlanReader,githubReviewKinds,githubRemovedPaths} from './github-plan-index.js';
import {contentHash} from './file-content.js';
import {verifyPublicationCandidate} from './retained-publication-files.js';
import {publicationWorkspace} from './publication-pin.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
import {deploymentInventory,recordDeploymentInventory,prepareDeploymentInventory,assertDeploymentInventory,deploymentInventoryPaths,verifyLiveFiles,LiveVerificationError} from './publication-live.js';
import {publicationText} from './web/publication-messages.js';
import {deploymentUncertain} from './publication-deployment-state.js';
import {indexedGithubFilePlan,githubPlanReview,admitGithubPlan,githubDirectory,githubPagesProtection,githubArchiveBranch,readGithubOwnership,writeGithubOwnership} from './github-publication-plan.js';
import {githubTreeRecords} from './github-trees.js';
import {deployGithub} from './github-deployment.js';
import {contentSize} from './file-content.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import { Workspace, digest, serialize } from './storage.js';
import { AppError } from './errors.js';
import { SSHHost } from './ssh-host.js';

export const defaultPublishing = () => ({ kind: 'github', github: { owner: '', repository: '', branch: 'main', pages: false, directory: '' }, ssh: { host: '', port: 22, user: '', directory: '', identityFile: '' }, publicUrl: '' });
export const pagesSource = pages => pages ? {build_type:pages.build_type,branch:pages.source?.branch??null,path:pages.source?.path??null,cname:pages.cname??null} : null;
const keys = (v, list) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === list.length && list.every(k => Object.hasOwn(v, k));
const string = (s, n = 500) => typeof s === 'string' && s.length <= n && !/[\x00-\x1f]/.test(s);
const part = s => string(s, 100) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s) && !['.', '..'].includes(s);
export function validatePublishing(c) {
  if(c?.limits){if(!keys(c.limits,['github','ssh'])||!Object.values(c.limits).every(v=>keys(v,['maxFileBytes','maxTotalBytes'])&&Object.values(v).every(n=>Number.isSafeInteger(n)&&n>=0)))throw new AppError('PUBLISH_CONFIG');}
  if (!keys(c.limits?Object.fromEntries(Object.entries(c).filter(([key])=>key!=='limits')):c, ['kind', 'github', 'ssh', 'publicUrl']) || !['github', 'ssh'].includes(c.kind) || !c.github || !['owner','repository','branch'].every(k=>Object.hasOwn(c.github,k)) || Object.keys(c.github).some(k=>!['owner','repository','branch','pages','directory'].includes(k)) || Object.hasOwn(c.github,'pages')&&typeof c.github.pages!=='boolean' || Object.hasOwn(c.github,'directory')&&!githubDirectory(c.github.directory) || !keys(c.ssh, ['host', 'port', 'user', 'directory', 'identityFile']) || !['owner','repository','branch'].every(k => string(c.github[k], 100)) || !['host', 'user', 'directory', 'identityFile'].every(k => string(c.ssh[k], 1000)) || !Number.isInteger(c.ssh.port) || c.ssh.port < 1 || c.ssh.port > 65535 || !string(c.publicUrl, 1000)) throw new AppError('PUBLISH_CONFIG');
  if (c.kind === 'github' && (!part(c.github.owner) || !part(c.github.repository) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(c.github.branch))) throw new AppError('PUBLISH_CONFIG');
  if (c.kind === 'ssh' && (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(c.ssh.host) || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(c.ssh.user) || !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(c.ssh.directory) || c.ssh.directory.split('/').some(p => p === '.' || p === '..') || (c.ssh.identityFile && !path.isAbsolute(c.ssh.identityFile)))) throw new AppError('PUBLISH_CONFIG');
  if (c.publicUrl) {
    let url; try { url = new URL(c.publicUrl); } catch { throw new AppError('PUBLISH_CONFIG'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new AppError('PUBLISH_CONFIG');
  }
  return c;
}

export class Publisher {
  constructor(root, { request = fetch, ssh = new SSHHost(), connection=null, workspace=null } = {}, vault = null) {
    this.workspace = workspace??new Workspace(root,vault); this.request = request; this.ssh = ssh; this.token = null; this.connection=connection;
    this.settingsFile = path.join(root, '.observanda', 'publishing.json');
    this.receiptsFile = path.join(root, '.observanda', 'publishing-receipts.json');
  }
  async readFile(file, fallback, limit=1024*1024) {
    try {
      const raw=await this.workspace.readMetadata(path.relative(this.workspace.root,file).split(path.sep).join('/'),limit);
      return raw===null?fallback:JSON.parse(raw);
    } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  }
  async read() {
    const config = await this.readFile(this.settingsFile, null);
    if (config) validatePublishing(config);
    const receipts=await this.readFile(this.receiptsFile,{}),receipt=config?receipts[this.destinationKey(config)]??null:null,etag=config?digest(serialize(config)):'new';
    // A check of one public URL/configuration cannot verify a later one. Keep
    // the historical receipt on disk, but do not present it as current proof.
    if(receipt?.verification?.configEtag!==etag&&receipt)delete receipt.verification;
    const account=this.connection?await this.connection.summary():null;
    return { receipt, config: config ?? defaultPublishing(), etag, destinationKey:config?this.destinationKey(config):null, configured: !!config, connected: !!this.token||!!account?.connected, temporaryToken:!!this.token, account:account?.selected??null };
  }
  async save(config, etag) {
    validatePublishing(config);
    return this.workspace.withLock(async () => {
      const current=await this.read();if(current.etag!==etag)throw new AppError('PUBLISH_STALE');
      if(current.configured){
        const active=await this.workspace.readMetadata('.observanda/deployment-active/'+this.destinationKey(current.config)+'.json',4096);
        if(active){const {id}=JSON.parse(active);if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('JOB_DAMAGED');
          const deployment=JSON.parse(await this.workspace.readMetadata('.observanda/deployments/'+id+'.json',16*1024*1024)),job=JSON.parse(await this.workspace.readMetadata('.observanda/jobs/'+id+'.json',1048576));
          if(['queued','running'].includes(job.state)||deploymentUncertain(deployment.journal,deployment.intent.config.kind)&&this.destinationKey(config)===this.destinationKey(current.config))throw new AppError('PUBLISH_PENDING');
        }
      }
      await this.workspace.writeMetadata('.observanda/publishing.json', serialize(config)); return this.read();
    });
  }
  async github(route, method = 'GET', data, allowMissing = false, signal) {
    const token=this.token??await this.connection?.token();if (!token) throw new AppError('PUBLISH_AUTH');
    let response;
    try { response = await this.request('https://api.github.com' + route, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Observanda', ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), redirect: 'error', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); } catch { signal?.throwIfAborted(); throw new AppError('PUBLISH_REMOTE'); }
    if(response.status===401&&!this.token){await this.connection?.reject();throw new AppError('GITHUB_RECONNECT');}
    if(response.status===403)throw new AppError(response.headers.get('X-GitHub-SSO')?.includes('required')?'GITHUB_ORGANIZATION_AUTH':response.headers.get('X-RateLimit-Remaining')==='0'?'GITHUB_RATE_LIMIT':'GITHUB_PERMISSION');
    if (response.status === 404 && allowMissing) return null;
    if (response.status === 409 && method === 'GET' && route.includes('/git/ref/heads/')) {
      const detail=await response.json().catch(()=>null);
      if(detail?.message==='Git Repository is empty.')throw new AppError('PUBLISH_EMPTY_REPO');
    }
    if (!response.ok) throw new AppError(response.status === 401 ? 'PUBLISH_AUTH' : 'PUBLISH_REMOTE');
    if (response.status === 204) return {};
    return response.json();
  }
  async connect(token) {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_]{20,255}$/.test(token)) throw new AppError('PUBLISH_AUTH');
    this.token = token;
    try { const user = await this.github('/user'); return { connected: true, account: user.login }; }
    catch (e) { this.token = null; throw e; }
  }
  async buildDestinationPlan(candidate, configEtag, {signal,replaceExisting=false,archiveBranch=null,onProgress=async()=>{},write}={}) {
    if(typeof replaceExisting!=='boolean'||archiveBranch!==null&&(!replaceExisting||!githubArchiveBranch(archiveBranch)))throw new AppError('INVALID');
    signal?.throwIfAborted();
    const remote=(route,missing=false)=>{signal?.throwIfAborted();return this.github(route,'GET',undefined,missing,signal);};
    await verifyPublicationCandidate(candidate);
    const saved=await this.read();
    if(!saved.configured||saved.etag!==configEtag||saved.config.kind!=='github')throw new AppError('PUBLISH_STALE');
    const c=saved.config.github,base=`/repos/${c.owner}/${c.repository}`,repo=await remote(base);
    if(!repo.permissions?.push||!Number.isSafeInteger(repo.id))throw new AppError('PUBLISH_REMOTE');
    const ref=await remote(base+'/git/ref/heads/'+c.branch,true),head=ref?.object?.sha??null;
    let files=[],baseTree=null;
    if(head){
      const commit=await remote(base+'/git/commits/'+head);baseTree=commit.tree?.sha;
      files=githubTreeRecords(route=>remote(base+route),baseTree,{signal});
    }else{
      const initial=await remote(base+'/git/ref/heads/'+encodeURIComponent(repo.default_branch),true);
      if(!initial)throw new AppError('PUBLISH_EMPTY_REPO');
    }
    if(archiveBranch&&(!head||archiveBranch===c.branch||await remote(base+'/git/ref/heads/'+archiveBranch,true)))throw new AppError('PUBLISH_ARCHIVE_BRANCH');
    const remotePages=c.pages===false?null:await remote(base+'/pages',true),pages=pagesSource(remotePages);
    const previous=(await this.readFile(this.receiptsFile,{}))[this.destinationKey(saved.config)];
    const setup=await this.readFile(path.join(this.workspace.root,'.observanda/repository-setup.json'),null);
    let initialized=false;
    if(setup&&/^[a-f0-9-]{36}$/.test(setup.id)){
      const operation=await this.readFile(path.join(this.workspace.root,'.observanda/repository-setups/'+setup.id+'.json'),null),job=await this.readFile(path.join(this.workspace.root,'.observanda/jobs/'+setup.id+'.json'),null);
      initialized=job?.state==='completed'&&operation?.journal.repositoryId===repo.id&&operation?.journal.initialHead===head;
    }
    const ownership=await readGithubOwnership(this,saved.config,previous);
    if(ownership&&ownership.repositoryId!==repo.id)throw new AppError('PUBLISH_OWNERSHIP');
    const changes=await indexedGithubFilePlan(this.workspace,candidate,files,ownership,c.directory??'',{signal,replaceExisting,onProgress,write});
    return admitGithubPlan({version:replaceExisting?3:2,...(replaceExisting?{replacement:{policy:1,directory:c.directory??'',archiveBranch},pagesProtection:githubPagesProtection(remotePages)}:{}),id:randomUUID(),releaseId:candidate.id,configEtag,repositoryId:repo.id,baseTree,head,pages,requiresReview:replaceExisting||!!head&&head!==previous?.commit&&!initialized||!!pages&&(pages.build_type!=='legacy'||pages.branch!==c.branch||pages.path!=='/')||changes.counts.conflicts>0||changes.counts.removed>0,...changes});
  }
  async reviewDestination(candidate,configEtag,{signal,replaceExisting=false,archiveBranch=null,onProgress=async()=>{},beforeCommit=async()=>{},write}={}){
    const plan=await this.buildDestinationPlan(candidate,configEtag,{signal,replaceExisting,archiveBranch,onProgress,write}),saved=await this.read();
    await (write??(operation=>this.workspace.withLock(operation)))(async()=>{
      signal?.throwIfAborted();
      if((await this.read()).etag!==configEtag)throw new AppError('PUBLISH_STALE');
      signal?.throwIfAborted();
      await beforeCommit();
      await this.workspace.writeMetadata('.observanda/publishing-plan/'+this.destinationKey(saved.config)+'.json',serialize(plan));
    });
    return githubPlanReview(this.workspace,plan);
  }
  async readDestinationPlan(candidate,configEtag,{destinationReview,destinationReviewed}={}) {
    if(destinationReview===undefined)return null;
    const saved=await this.read(),plan=await this.readFile(path.join(this.workspace.root,'.observanda/publishing-plan/'+this.destinationKey(saved.config)+'.json'),null,16*1024*1024);
    if(!plan||![1,2,3].includes(plan.version)||plan.version===1&&(!Array.isArray(plan.entries)||!Array.isArray(plan.preservedEntries))||plan.id!==destinationReview||plan.configEtag!==configEtag||saved.etag!==configEtag||plan.releaseId!==candidate.id||plan.requiresReview&&destinationReviewed!==true)throw new AppError('PUBLISH_STALE');
    if(plan.version===3&&(plan.replacement.directory!==(saved.config.github.directory??'')||destinationReviewed!==true))throw new AppError('PUBLISH_STALE');
    if(githubPlanReader(this.workspace,plan).count('conflicts'))throw new AppError('PUBLISH_CONFLICT');
    return admitGithubPlan(plan);
  }
  async destinationPlanPage({id,configEtag,kind,offset=0}){
    if(!githubReviewKinds.includes(kind))throw new AppError('INVALID');
    const saved=await this.read(),plan=await this.readFile(path.join(this.workspace.root,'.observanda/publishing-plan/'+this.destinationKey(saved.config)+'.json'),null,16*1024*1024);
    if(!plan||plan.id!==id||saved.etag!==configEtag||plan.configEtag!==configEtag)throw new AppError('PUBLISH_STALE');
    const page=await githubPlanReader(this.workspace,admitGithubPlan(plan)).page(kind,{offset});return {...page,items:page.items.map(row=>row.path)};
  }
  async check({plan=null,reviewExisting=false}={}) {
    const saved = await this.read(); if (!saved.configured) throw new AppError('PUBLISH_CONFIG');
    const c = saved.config;
    if (c.kind === 'ssh') { await this.ssh.check(c.ssh); return { message: 'SSH authentication and required server tools verified. Upload has not started.' }; }
    const base = `/repos/${c.github.owner}/${c.github.repository}`;
    const repo = await this.github(base);
    const ref = await this.github(`${base}/git/ref/heads/${c.github.branch}`, 'GET', undefined, true);
    const receipts = await this.readFile(this.receiptsFile, {}), previous = receipts[this.destinationKey(c)];
    if (plan && ((ref?.object?.sha??null)!==plan.head||repo.id!==plan.repositoryId)) throw new AppError('PUBLISH_STALE');
    if (ref && ref.object?.sha !== previous?.commit && !plan && !reviewExisting) throw new AppError('PUBLISH_OWNERSHIP');
    if (!repo.permissions?.push) throw new AppError('PUBLISH_REMOTE');
    // Git's reference API cannot initialize a repository with no commits.
    if (!ref) { const initial = await this.github(`${base}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`, 'GET', undefined, true); if (!initial) throw new AppError('PUBLISH_EMPTY_REPO'); }
    const pages = c.github.pages===false ? null : await this.github(`${base}/pages`, 'GET', undefined, true);
    if(plan?.replacement?.archiveBranch&&(plan.replacement.archiveBranch===c.github.branch||await this.github(base+'/git/ref/heads/'+plan.replacement.archiveBranch,'GET',undefined,true)))throw new AppError('PUBLISH_ARCHIVE_BRANCH');
    if(plan?.version===3&&JSON.stringify(githubPagesProtection(pages))!==JSON.stringify(plan.pagesProtection))throw new AppError('PUBLISH_STALE');
    if (plan && JSON.stringify(pagesSource(pages))!==JSON.stringify(plan.pages)) throw new AppError('PUBLISH_STALE');
    const pagesChange=pages&&(pages.build_type!=='legacy'||pages.source?.branch!==c.github.branch||pages.source?.path!=='/');
    if(pagesChange&&!plan&&!reviewExisting)throw new AppError('PUBLISH_PAGES');
    return { message: `${repo.private ? 'Private' : 'Public'} repository verified. ${ref ? ref.object.sha===previous?.commit?'Publication branch verified.':'Existing branch files will be reviewed before the first upload.' : 'The selected branch will be created.'} ${c.github.pages===false ? 'Upload only; Pages settings will not be changed.' : pagesChange ? 'Review the Pages source change before publishing.' : pages ? 'Pages source verified.' : 'Pages will be enabled on publication.'}` };
  }
  async verifyLive({configEtag,commit,deploymentId,signal,progress,beforeCommit=async()=>{}}={}) {
    const saved = await this.read(); if (!saved.configured) throw new AppError('PUBLISH_CONFIG');
    const receipts = await this.readFile(this.receiptsFile, {}), receipt = receipts[this.destinationKey(saved.config)];
    if (!receipt) throw new AppError('PUBLISH_REMOTE');
    if(configEtag!==undefined&&configEtag!==saved.etag||commit!==undefined&&commit!==receipt.commit)throw new AppError('PUBLISH_STALE');
    const c = saved.config, base = c.publicUrl || (c.kind === 'github' ? `https://${c.github.owner}.github.io/${c.github.repository.toLowerCase() === c.github.owner.toLowerCase() + '.github.io' ? '' : c.github.repository + '/'}${c.github.directory?c.github.directory+'/':''}` : '');
    if (!base) throw new AppError('PUBLISH_CONFIG');
    const key=this.destinationKey(c),inventory=await deploymentInventory(this.workspace,key);
    if(inventory&&(inventory.commit!==receipt.commit||inventory.releaseId!==receipt.releaseId))throw new AppError('PUBLISH_STALE');
    const store=async verification=>this.workspace.withLock(async()=>{
      signal?.throwIfAborted();await beforeCommit();
      const current=await this.read(),latest=await this.readFile(this.receiptsFile,{});
      if(current.etag!==saved.etag||latest[key]?.commit!==receipt.commit||latest[key]?.releaseId!==receipt.releaseId||deploymentId!==undefined&&(latest[key]?.deploymentId??null)!==deploymentId)throw new AppError('PUBLISH_STALE');
      verification.configEtag=saved.etag;latest[key]={...latest[key],verification};await this.workspace.writeMetadata('.observanda/publishing-receipts.json',serialize(latest));
      if(/^[a-f0-9-]{36}$/.test(receipt.deploymentId??''))await this.workspace.writeMetadata('.observanda/deployment-verifications/'+receipt.deploymentId+'.json',serialize(verification));
    });
    try{
      const verification=await verifyLiveFiles(this.request,base,receipt,{removed:deploymentInventoryPaths(this.workspace,inventory,'removed'),signal,progress});
      await store(verification);return {verification,message:publicationText('liveVerified',{count:verification.files,removed:verification.removed})};
    }catch(error){
      if(!(error instanceof LiveVerificationError))throw error;
      await store({at:new Date().toISOString(),failed:true,issue:error.issue});
      throw new AppError('PUBLISH_NOT_LIVE',[error.issue]);
    }
  }

  destinationKey(config) {
    const destination=config.kind==='github'?Object.fromEntries(Object.entries(config.github).filter(([key,value])=>key!=='pages'&&(key!=='directory'||value!==''))):config.ssh;
    return digest(serialize({kind:config.kind,destination}));
  }
  async deploy(candidate, expectedConfigEtag, workspaceId, review={}) {
    await verifyPublicationCandidate(candidate);
    const saved = await this.read();
    if (!saved.configured || saved.etag !== expectedConfigEtag) throw new AppError('PUBLISH_STALE');
    const config = saved.config;
    let plan=await this.readDestinationPlan(candidate,expectedConfigEtag,review);
    if(!plan&&config.kind==='github'){plan=await this.buildDestinationPlan(candidate,expectedConfigEtag);if(plan.requiresReview)throw new AppError('PUBLISH_OWNERSHIP');}
    await enforcePublishingLimits(candidate,config);
    const inventoryKey=this.destinationKey(config),preparedInventory=await prepareDeploymentInventory(this.workspace,inventoryKey,candidate.files.keys(),{removed:githubRemovedPaths(this.workspace,plan,config.github?.directory)});
    // Hold the workspace lock through publication so another writer cannot invalidate the review.
    return this.workspace.withLock(async () => {
      await publicationWorkspace(this.workspace).lockWebsite();
      if (!await publicationRevisionCurrent(this.workspace,candidate)) throw new AppError('STALE');
      if ((await this.read()).etag !== expectedConfigEtag) throw new AppError('PUBLISH_STALE');
      await assertDeploymentInventory(this.workspace,inventoryKey,preparedInventory);
      const receipts = await this.readFile(this.receiptsFile, {}), key = this.destinationKey(config);
      let receipt;
      if (config.kind === 'ssh') receipt = await this.ssh.deploy(config.ssh, candidate, this.workspace.websiteId??workspaceId);
      else {
        receipt=await deployGithub(this,candidate,config,{plan,journal:{},save:async()=>{},guard:async()=>{},pushed:async (value,journal)=>{await writeGithubOwnership(this.workspace,key,journal);await recordDeploymentInventory(this.workspace,key,value,preparedInventory);receipts[key]=value;await this.workspace.writeMetadata('.observanda/publishing-receipts.json',serialize(receipts));}});
      }
      receipt.manifestHash = contentHash(await candidate.files.get('publication.json'));
      await recordDeploymentInventory(this.workspace,key,receipt,preparedInventory);
      receipts[key] = receipt; await this.workspace.writeMetadata('.observanda/publishing-receipts.json', serialize(receipts));
      return receipt;
    });
  }
}

export function enforcePublishingLimits(candidate,config){
 const policy=config.limits?.[config.kind]??{maxFileBytes:0,maxTotalBytes:0};let total=0;
 const check=content=>{const size=contentSize(content);total+=size;if(policy.maxFileBytes&&size>policy.maxFileBytes)throw new AppError('PUBLISH_POLICY');if(config.kind==='github'&&size>100*1024*1024)throw new AppError('PUBLISH_SIZE');};
 const finish=()=>{if(policy.maxTotalBytes&&total>policy.maxTotalBytes)throw new AppError('PUBLISH_POLICY');if(config.kind==='github'&&total>1000000000)throw new AppError('PUBLISH_SIZE');};
 const values=candidate.files.values();if(typeof values[Symbol.iterator]==='function'){for(const content of values)check(content);return finish();}
 return (async()=>{for await(const content of values)check(content);finish();})();
}
