import {hasPrivateText} from './privacy-text.js';
import {hasPrivateTextStream} from './privacy-text-stream.js';
export {hasPrivateText} from './privacy-text.js';
import {isDownloadPath} from './web/website-file.js';
import {PUBLIC_POPUPS_SCRIPT} from './publication-popups.js';
import {PUBLIC_GALLERY_SCRIPT} from './publication-gallery.js';
import {FileContent,contentBuffer} from './file-content.js';
import {legacyPagePath} from './web/publication-links-model.js';
import {knownPublicBookScript} from './publication-scripts.js';
import {PUBLIC_FEEDS_SCRIPT,feedFilePath} from './publication-feeds.js';
import { isBundledFont } from './fonts.js';
import { AppError } from './errors.js';
import {inspectFont} from './font-inspector.js';
import {createHash} from 'node:crypto';
const uuid = '[0-9a-f-]{36}';
const textName = new RegExp(`^(?:index\\.html|styles\\.css|publication\\.json|\\.nojekyll|figures/${uuid}(?:-${uuid})?\\.(?:svg|csv)|(?:projects|notebooks|entries|pages)/${uuid}\\.html)$`);
const mediaName = new RegExp(`^media/${uuid}\\.(png|wav|mp4)$`);
const publicTextFile=name=>name==='browse.html'||feedFilePath(name)||textName.test(name)||legacyPagePath(name);
const checkedFonts=new Map();
const retainedChecks=new WeakMap();
const retainedIdentity=(name,file,blockedValues)=>JSON.stringify([name,file.file,file.size,file.sha256,blockedValues]);
// Buffered and retained outputs share the exact byte decoding and public policy.
export function assertPublicFileBytes(name,bytes,{type,blockedValues=[]}){
  if(!Buffer.isBuffer(bytes)||!['text','binary'].includes(type))throw new AppError('UNSAFE');
  const content=type==='text'?bytes.toString('utf8'):bytes;
  if(type==='text'&&!Buffer.from(content).equals(bytes))throw new AppError('UNSAFE');
  assertPublicFiles(new Map([[name,content]]),blockedValues);
}
// Validate one retained output at a time, then keep only its authenticated file
// handle. This admission is never deserialized from a candidate manifest.
export async function admitRetainedPublicFile(name,file,{type,blockedValues=[]}){
  if(!(file instanceof FileContent)||!['text','binary'].includes(type))throw new AppError('UNSAFE');
  if(type==='binary'&&isDownloadPath(name)){await file.verify();assertPublicFiles(new Map([[name,file]]),blockedValues);return file;}
  if(type==='text'&&publicTextFile(name)){
    const vault=file.workspace.vault;
    if(await hasPrivateTextStream(()=>file.stream(),blockedValues))throw new AppError('PRIVACY',[{field:'generated output'}]);
    await file.workspace.requireStorageKey();if(vault?.id&&(file.workspace.vault!==vault||!vault.key))throw new AppError('ACCESS_LOCKED');
  }else assertPublicFileBytes(name,await contentBuffer(file),{type,blockedValues});
  retainedChecks.set(file,{workspace:file.workspace,identity:retainedIdentity(name,file,blockedValues)});
  return file;
}
function assertCustomFont(name,bytes,blockedValues){
  const match=/^fonts\/custom-([a-f0-9]{64})\.(ttf|otf|woff|woff2)$/.exec(name);
  if(!match||!Buffer.isBuffer(bytes)||createHash('sha256').update(bytes).digest('hex')!==match[1])throw new AppError('UNSAFE');
  let info=checkedFonts.get(match[1]);if(!info){try{info=inspectFont(bytes);}catch{throw new AppError('FONT_INVALID');}if(checkedFonts.size>=64)checkedFonts.delete(checkedFonts.keys().next().value);checkedFonts.set(match[1],info);}
  if(info.extension!==match[2]||info.restricted)throw new AppError('FONT_EMBED');
  // Font names may contain build-machine paths. Optional private/XML/SVG metadata
  // has no role in the website edition; reject it rather than silently publishing it.
  if(info.extraMetadata||hasPrivateText(info.metadata,blockedValues))throw new AppError('PRIVACY',[{field:'font metadata'}]);
}

export function assertPublicFields(fields, blockedValues = []) {
  // Inspect authored values, not JSON escapes introduced by serialization (for
  // example a TeX command is not a UNC path). Keys can also contain private text.
  const privateValue=value=>typeof value==='string'?hasPrivateText(value,blockedValues):Array.isArray(value)?value.some(privateValue):value&&typeof value==='object'?Object.entries(value).some(([key,item])=>privateValue(key)||privateValue(item)):false;
  const issues = fields.filter(field => privateValue(field.value)).map(({ field, recordId }) => ({ field, ...(recordId ? { recordId } : {}) }));
  if (issues.length) throw new AppError('PRIVACY', issues.slice(0, 30));
}

export function assertPublicFiles(files, blockedValues = []) {
  for (const [name, value] of files) {
    const checked=retainedChecks.get(value);
    if(checked&&checked.workspace===value.workspace&&checked.identity===retainedIdentity(name,value,blockedValues))continue;
    const content=value instanceof FileContent?value.header:value;
    if(value instanceof FileContent&&!mediaName.test(name)&&!isDownloadPath(name))throw new AppError('UNSAFE');
    if(isDownloadPath(name)){
      if(!(Buffer.isBuffer(value)||value instanceof FileContent))throw new AppError('UNSAFE');
    } else if (name.startsWith('fonts/')) {
      if (!isBundledFont(name, content)) assertCustomFont(name,content,blockedValues);
    } else if(name==='public-book.js'){
      if(!knownPublicBookScript(content))throw new AppError('UNSAFE');
    } else if(name==='public-popups.js'){
      if(content!==PUBLIC_POPUPS_SCRIPT)throw new AppError('UNSAFE');
    } else if(name==='public-gallery.js'){
      if(content!==PUBLIC_GALLERY_SCRIPT)throw new AppError('UNSAFE');
    } else if(name==='public-feeds.js'){
      if(content!==PUBLIC_FEEDS_SCRIPT)throw new AppError('UNSAFE');
    } else if (publicTextFile(name)) {
      if (typeof content !== 'string') throw new AppError('UNSAFE');
      if (hasPrivateText(content, blockedValues)) throw new AppError('PRIVACY', [{ field: 'generated output' }]);
    } else {
      const match = mediaName.exec(name);
      if (!match || !Buffer.isBuffer(content)) throw new AppError('UNSAFE');
      const valid = match[1] === 'png' ? content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'wav' ? ['RIFF','RF64'].includes(content.toString('ascii', 0, 4)) && content.toString('ascii', 8, 12) === 'WAVE' : content.toString('ascii', 4, 8) === 'ftyp';
      if (!valid) throw new AppError('MEDIA_INVALID');
    }
  }
}
