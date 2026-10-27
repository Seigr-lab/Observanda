import {adoptRecordOwnerMedia} from './record-owner-resources.js';
import {retiredMediaContent} from './project-media-content.js';
import {validDownloadName,validDownloadInfo,downloadInfo} from './web/website-file.js';
import {FileContent,writeContent,serveContent,contentBuffer,describeContent} from './file-content.js';
import {MediaPolicy,defaultMediaPolicy,effectiveMediaPolicy} from './media-policy.js';
import {nativeMediaAdmission} from './native-media-admission.js';
import {diagnosticPhase} from './operational-diagnostics.js';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {PassThrough} from 'node:stream';
import {Workspace} from './storage.js';
import { publicProjection } from './publication.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, lstat, unlink, rmdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';
import { digest, serialize, assertRegular, privateDirectory } from './storage.js';
import { upgradeNotebook } from './model.js';
import { hasPrivateText } from './privacy.js';

const run = promisify(execFile);
const formats = 'png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,wav,mp3,flac,ogg,mov,matroska,webm,avi';
const profiles = {
  image: { extension: 'png', mime: 'image/png', args: ['-map', '0:v:0', '-frames:v', '1', '-c:v', 'png', '-threads', '1', '-f', 'image2pipe'] },
  audio: { extension: 'wav', mime: 'audio/wav', args: ['-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav'] },
  video: { extension: 'mp4', mime: 'video/mp4', args: ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'] }
};
const safeId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export async function mediaCommand(binary, args, timeout = 30000, {signal}={}) {
  signal?.throwIfAborted();
  const release=await nativeMediaAdmission.acquire(64*1024*1024,{signal});let closed=Promise.resolve();
  try{return await diagnosticPhase('probe-media',async()=>{
   signal?.throwIfAborted();timeout=Number.isSafeInteger(timeout)&&timeout>0?Math.min(timeout,2147483647):30000;
   try{
    const running=run(binary,args,{windowsHide:true,timeout,signal,killSignal:'SIGKILL',maxBuffer:2*1024*1024,encoding:'utf8'});
    closed=new Promise(resolve=>running.child.once('close',resolve));return await running;
   }catch(error){signal?.throwIfAborted();throw new AppError(error.code==='ENOENT'?'MEDIA_TOOL':error.killed?'MEDIA_LIMIT':'MEDIA_INVALID');}
  });}finally{await closed;release();}
}

export async function mediaCapabilities() {
  try { await mediaCommand('ffmpeg', ['-version']); await mediaCommand('ffprobe', ['-version']); return { available: true, maxBytes: null }; }
  catch { return { available: false, maxBytes: null }; }
}

// Seekable input over a private, token-protected loopback endpoint; source paths never reach FFmpeg.
async function memoryInput(bytes,operation){
  const token=randomBytes(32).toString('hex');let host;
  const server=http.createServer((req,res)=>{
    if(req.headers.host!==host||req.url!=='/'+token||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
    serveContent(req,res,bytes,'application/octet-stream').catch(()=>{if(!res.headersSent)res.writeHead(422);res.destroy();});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});host='127.0.0.1:'+server.address().port;
  try{return await operation('http://'+host+'/'+token);}finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
}
export async function convertMedia(args,workspace,output,policy,signal,{binary='ffmpeg',input=null,reservationBytes,admission=nativeMediaAdmission,stallMs=300000}={}){
  policy=effectiveMediaPolicy(policy);
  reservationBytes??=Math.max(128*1024*1024,Math.min(Number.MAX_SAFE_INTEGER,policy.maxImagePixels*8));
  const release=await admission.acquire(reservationBytes,{signal});
  try{return await diagnosticPhase('convert-media',()=>convertAdmitted(args,workspace,output,policy,signal,{binary,input,stallMs}));}finally{release();}
}
async function convertAdmitted(args,workspace,output,policy,signal,{binary,input,stallMs}){
  signal?.throwIfAborted();
  const child=spawn(binary,args,{windowsHide:true,stdio:[input?'pipe':'ignore','pipe','pipe']});let timeout,idle,errorBytes=0,timedOut=false,lastActivity=performance.now();
  // Attach a consumer synchronously. Node drains unconsumed child stdio on exit;
  // opening the encrypted destination first can otherwise discard a short result.
  // PassThrough keeps bounded buffering and propagates disk backpressure.
  const captured=new PassThrough({highWaterMark:64*1024}),capturing=pipeline(child.stdout,captured);
  const stop=()=>child.kill('SIGKILL');signal?.addEventListener('abort',stop,{once:true});
  timeout=setTimeout(()=>{timedOut=true;stop();},Math.min(2147483647,policy.processingTimeoutSeconds*1000));
  const activity=()=>{lastActivity=performance.now();};child.stdout.on('data',activity);child.stdin?.on('drain',activity);
  idle=setInterval(()=>{if(child.stdout.isPaused()){activity();return;}if(performance.now()-lastActivity>=stallMs){timedOut=true;stop();}},Math.min(1000,stallMs));
  const closed=new Promise(resolve=>child.once('close',()=>{clearTimeout(timeout);clearInterval(idle);resolve();}));
  child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes>2*1024*1024)stop();});
  const completed=new Promise((resolve,reject)=>{child.once('error',e=>reject(new AppError(e.code==='ENOENT'?'MEDIA_TOOL':'MEDIA_INVALID')));child.once('close',code=>code!==0||timedOut?reject(new AppError(timedOut?'MEDIA_LIMIT':input?({21:'SVG_EXTERNAL',22:'SVG_LIMIT',23:'SVG_STATIC',24:'MEDIA_LIMIT'}[code]??'MEDIA_INVALID'):'MEDIA_INVALID')):resolve());});
  const feeding=input?pipeline(input.stream(),child.stdin):Promise.resolve();
  // A closed stdout is not proof of a successful conversion. Keep the output
  // temporary until the process and both pipelines have completed successfully.
  const writing=writeContent(workspace,output,captured,{maxBytes:policy.maxPreparedBytes,reserveBytes:policy.reserveBytes,signal,beforeCommit:async saved=>{await Promise.all([completed,feeding,capturing]);if(!saved.size)throw new AppError('MEDIA_INVALID');}});
  try{const [result]=await Promise.all([writing,completed,feeding,capturing]);if(!result.size)throw new AppError('MEDIA_INVALID');return result;}
  catch(error){
    stop();captured.destroy();
    const results=await Promise.allSettled([writing,completed,feeding,capturing]);signal?.throwIfAborted();
    // Stopping the stream after a storage/limit failure can reject its pipeline
    // before writeContent finishes cleanup. Report the cause, not that secondary abort.
    const writeError=results[0].status==='rejected'?results[0].reason:null;
    if(writeError&&!['ABORT_ERR','ERR_STREAM_PREMATURE_CLOSE','EPIPE'].includes(writeError.code))throw writeError;
    if(results[1].status==='rejected')throw results[1].reason;
    throw error;
  }
  finally{clearTimeout(timeout);clearInterval(idle);signal?.removeEventListener('abort',stop);await closed;}
}

async function probe(file,policy=defaultMediaPolicy(),signal) {
  const { stdout } = await mediaCommand('ffprobe', ['-v', 'error', '-protocol_whitelist', 'http,tcp', '-format_whitelist', formats, '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file],policy.processingTimeoutSeconds*1000,{signal});
  try { return JSON.parse(stdout); } catch { throw new AppError('MEDIA_INVALID'); }
}

function checkStreams(info, kind,policy=defaultMediaPolicy()) {
  const visual = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const sound = info.streams?.find(stream => stream.codec_type === 'audio');
  if ((kind === 'audio' && !sound) || (kind !== 'audio' && !visual)) throw new AppError('MEDIA_INVALID');
  if (visual && (!Number.isSafeInteger(visual.width)||visual.width<1||!Number.isSafeInteger(visual.height)||visual.height<1||!Number.isSafeInteger(visual.width*visual.height)||visual.width*visual.height>policy.maxImagePixels)) throw new AppError('MEDIA_LIMIT');
  // Animated formats belong in video records: do not silently turn them into a still.
  if (kind === 'image' && (!['png_pipe', 'jpeg_pipe', 'webp_pipe', 'bmp_pipe', 'tiff_pipe'].includes(info.format?.format_name) || Number(visual.nb_frames ?? 1) > 1)) throw new AppError('MEDIA_INVALID');
  if (kind !== 'image' && (!Number.isFinite(Number(info.format?.duration)) || policy.maxDurationSeconds && Number(info.format.duration) > policy.maxDurationSeconds)) throw new AppError('MEDIA_LIMIT');
  if (sound && (!Number.isSafeInteger(sound.channels)||sound.channels<1||sound.channels>policy.maxAudioChannels||!Number.isFinite(Number(sound.sample_rate))||Number(sound.sample_rate)<=0||Number(sound.sample_rate)>policy.maxSampleRate)) throw new AppError('MEDIA_LIMIT');
}

function checkMetadata(info) {
  if (info.chapters?.length) throw new AppError('PRIVACY', [{ field: 'media metadata' }]);
  const allowed = {
    major_brand: /^(isom|mp42|iso5|iso6)$/, minor_version: /^\d+$/, compatible_brands: /^[a-zA-Z0-9 ]+$/,
    language: /^und$/, handler_name: /^(VideoHandler|SoundHandler)$/, vendor_id: /^(\[0\]){4}$/,
    encoder: /^(Lav[fc][0-9. ]*(?: (?:libx264|aac|pcm_s16le|pcm_s24le|pcm_s32le|pcm_f32le))?|Lavc libx264)$/
  };
  for (const record of [info.format, ...(info.streams ?? [])]) {
    for (const [key, value] of Object.entries(record?.tags ?? {})) {
      if (!allowed[key]?.test(value) || hasPrivateText(value)) throw new AppError('PRIVACY', [{ field: 'media metadata' }]);
    }
  }
}

export class MediaStore {
  constructor(root,vault=null) { this.workspace=root instanceof Workspace?root:new Workspace(root,vault); this.root=this.workspace.root; }

  async import(input,kind,{signal,name}={}) {
    const profile=kind==='file'?{extension:'bin'}:profiles[kind];if(!profile||!input||kind==='file'&&!validDownloadName(name))throw new AppError('MEDIA_INVALID');
    const policy=(await new MediaPolicy(this.workspace).read()).policy;
    const canonical=await realpath(this.root),parent=await privateDirectory(canonical,'.observanda/media'),id=randomUUID(),directory=path.join(parent,id);
    await mkdir(directory,{mode:0o700});const original=path.join(directory,'original'),output=path.join(directory,`public.${profile.extension}`);
    try{
      const sourceInfo=await writeContent(this.workspace,original,Buffer.isBuffer(input)?[input]:input,{maxBytes:policy.maxUploadBytes,reserveBytes:policy.reserveBytes,signal});
      if(!sourceInfo.size&&kind!=='file')throw new AppError('MEDIA_INVALID');
      const inputFile=new FileContent(this.workspace,original,sourceInfo.size,sourceInfo.sha256);
      const metadata=kind==='file'?{id,kind,name,extension:'bin',mime:'application/octet-stream',bytes:sourceInfo.size,sha256:sourceInfo.sha256,originalBytes:sourceInfo.size,originalSha256:sourceInfo.sha256}:await this.prepare(inputFile,kind,id,output,{policy,signal});
      if(kind==='file')await inputFile.verify({signal});
      await this.workspace.writeFile(path.join(directory,'asset.json'),serialize(metadata));return {id,kind,...(kind==='file'?downloadInfo(metadata):{})};
    }catch(error){for(const name of ['original',`public.${profile.extension}`,'asset.json'])await unlink(path.join(directory,name)).catch(()=>{});await rmdir(directory).catch(()=>{});throw error;}
  }

  // Shared conversion path for immediate imports and durable worker attempts.
  async prepare(inputFile,kind,id,output,{policy,signal,progress=async()=>{}}={}) {
    const profile=profiles[kind];if(!profile)throw new AppError('MEDIA_INVALID');
    policy=effectiveMediaPolicy(policy??(await new MediaPolicy(this.workspace).read()).policy);
    const sourceInfo={size:inputFile.size,sha256:inputFile.sha256};
    await progress({stage:'Converting a display copy',done:0,total:1});
      const header=[];if(kind==='image')for await(const chunk of inputFile.stream(0,255))header.push(chunk);
      const prefix=Buffer.concat(header),svg=kind==='image'&&(/^[\s\uFEFF]*</.test(prefix.toString('utf8'))||prefix[0]===255&&prefix[1]===254||prefix[0]===254&&prefix[1]===255);
      if(svg&&sourceInfo.size>32*1024*1024)throw new AppError('SVG_LIMIT');
      const {source,copy}=svg?{source:null,copy:await convertMedia(
        [fileURLToPath(new URL('./svg-renderer.js',import.meta.url)),String(policy.maxImagePixels)],
        this.workspace,output,{...policy,processingTimeoutSeconds:policy.processingTimeoutSeconds||60},signal,
        {binary:process.execPath,input:inputFile}
      )}:await memoryInput(inputFile,async url=>{
        const source=await probe(url,policy,signal);checkStreams(source,kind,policy);
        const args=[...profile.args];
        if(kind==='audio'){
          const stream=source.streams.find(s=>s.codec_type==='audio'),bits=Number(stream.bits_per_raw_sample||stream.bits_per_sample||16);
          args[args.indexOf('pcm_s16le')]=stream.sample_fmt?.startsWith('flt')?'pcm_f32le':bits>24?'pcm_s32le':bits>16?'pcm_s24le':'pcm_s16le';args.push('-rf64','auto');
        }
        const visual=source.streams.find(stream=>stream.codec_type==='video'&&!stream.disposition?.attached_pic),pixels=visual?visual.width*visual.height:0,reservationBytes=Math.max(128*1024*1024,pixels*8);
        const copy=await convertMedia(['-v','error','-nostdin','-threads','1','-filter_threads','1','-protocol_whitelist','http,tcp','-format_whitelist',formats,'-i',url,'-map_metadata','-1','-map_metadata:s','-1','-map_chapters','-1','-fflags','+bitexact','-flags:v','+bitexact','-flags:a','+bitexact',...args,'-threads','1','pipe:1'],this.workspace,output,policy,signal,{reservationBytes});
        return {source,copy};
      });
      await progress({stage:'Verifying the display copy',done:0,total:1});
      const preparedFile=new FileContent(this.workspace,output,copy.size,copy.sha256);
      const prepared=svg?null:await memoryInput(preparedFile,url=>probe(url,policy,signal));if(prepared){checkStreams(prepared,kind,policy);checkMetadata(prepared);}
      if(kind!=='image'&&Math.abs(Number(source.format.duration)-Number(prepared.format.duration))>0.5)throw new AppError('MEDIA_INVALID');
      return {id,kind,extension:profile.extension,mime:profile.mime,bytes:copy.size,sha256:copy.sha256,originalBytes:sourceInfo.size,originalSha256:sourceInfo.sha256};
  }

  async metadata(id) {
    if (!safeId(id)) throw new AppError('INVALID');
    const indexed=await this.workspace.readMetadata('.observanda/media-assets/'+id+'.json',4096);
    let directory = this.root;
    for (const part of ['.observanda', 'media', id]) { directory = path.join(directory, part); await assertRegular(directory, { directory: true, missing: indexed!==null }); }
    const metadataFile = path.join(directory, 'asset.json');
    if(indexed===null){const stat=await assertRegular(metadataFile);if(stat.size>4096)throw new AppError('MEDIA_INVALID');}
    const metadata=JSON.parse(indexed??(await contentBuffer(await describeContent(this.workspace,metadataFile))).toString('utf8'));
    if(metadata.storageId!==undefined&&!safeId(metadata.storageId))throw new AppError('MEDIA_INVALID');
    const profile = metadata.kind==='file'?{extension:'bin',mime:'application/octet-stream'}:profiles[metadata.kind];
    if (!profile || metadata.id !== id || metadata.extension !== profile.extension || metadata.mime !== profile.mime || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 0 || metadata.bytes===0&&metadata.kind!=='file' || metadata.kind==='file'&&(!validDownloadInfo(downloadInfo(metadata))||metadata.originalBytes!==metadata.bytes||metadata.originalSha256!==metadata.sha256)) throw new AppError('MEDIA_INVALID');
    await adoptRecordOwnerMedia(this.workspace,id,metadata);return {directory,metadata};
  }

  async originalContent(id,known=null) {
    const {directory,metadata}=known??await this.metadata(id);
    if(metadata.storageId){const {MediaImports}=await import('./media-imports.js'),original=await new MediaImports(this.workspace).original(id);if(original.session.source.size!==metadata.originalBytes||original.session.source.sha256!==metadata.originalSha256)throw new AppError('MEDIA_INVALID');return original.content;}
    const file=path.join(directory,'original'),relative=path.relative(this.root,file).split(path.sep).join('/');
    const retired=await retiredMediaContent(this.workspace,relative,metadata.originalBytes,metadata.originalSha256);if(retired)return retired;
    await assertRegular(file);return new FileContent(this.workspace,file,metadata.originalBytes,metadata.originalSha256);
  }

  async get(id,{streamed=false,signal,includeHeader=true}={}) {
    signal?.throwIfAborted();
    const {directory,metadata}=await this.metadata(id),profile=profiles[metadata.kind];
    const file = path.join(directory,metadata.kind==='file'?metadata.storageId?metadata.storageId+'.original':'original':`${metadata.storageId?metadata.storageId+'.':''}public.${profile.extension}`);
    const relative=path.relative(this.root,file).split(path.sep).join('/');let content=await retiredMediaContent(this.workspace,relative,metadata.bytes,metadata.sha256);
    if(!content){await assertRegular(file);content=new FileContent(this.workspace,file,metadata.bytes,metadata.sha256);}
    await content.verify({signal});
    if(includeHeader&&metadata.kind!=='file'){const header=[];for await(const chunk of content.read(0,11,{signal}))header.push(chunk);content.header=Buffer.concat(header);}
    const bytes=streamed?content:await contentBuffer(content);
    return { id, kind: metadata.kind, extension: metadata.extension, mime: metadata.mime, bytes,...(metadata.kind==='file'?downloadInfo(metadata):{}) };
  }

  async publicFiles(source,{signal,streamed=false,designPageId=null,designTarget=null,workspaceContent=false}={}) {
    const book = upgradeNotebook(source), files = new Map();
    const context = publicProjection(book,{designPageId,designTarget,workspaceContent});
    for(const entry of context.entries)for(const attachment of entry.attachments){
      signal?.throwIfAborted();
      if(files.has(attachment.id))continue;
      const file=await this.get(attachment.id,{streamed});
      if(file.kind!==attachment.kind)throw new AppError('MEDIA_INVALID');
      files.set(attachment.id,file);
    }
    for(const asset of context.website.assets){signal?.throwIfAborted();if(files.has(asset.id))continue;const file=await this.get(asset.id,{streamed});if(file.kind!==asset.kind)throw new AppError('MEDIA_INVALID');files.set(asset.id,file);}
    for (const id of [context.website, ...context.projects, ...context.notebooks, ...context.pages, ...context.entries].flatMap(item => item.logos.map(logo => logo.id))) {
      signal?.throwIfAborted();const file = await this.get(id,{streamed});
      if (file.kind !== 'image') throw new AppError('MEDIA_INVALID');
      if (!files.has(id)) { files.set(id, file); }
    }
    return files;
  }
}
