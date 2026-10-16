import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

export const PRIVATE_MARKER = '/home/imaginary-researcher/PRIVATE_MEDIA_SOURCE';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function mediaFixtures(root) {
  const result = {};
  for (const [kind, extension, args] of [
    ['image', 'png', ['-f', 'lavfi', '-i', 'color=c=green:s=96x64', '-frames:v', '1']],
    ['audio', 'wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-metadata', `comment=${PRIVATE_MARKER}`]],
    ['video', 'mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=96x64:d=0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-metadata', `comment=${PRIVATE_MARKER}`]]
  ]) {
    const file = path.join(root, `fixture.${extension}`);
    try { execFileSync('ffmpeg', ['-v', 'error', '-n', ...args, file], { windowsHide: true, stdio: 'pipe', timeout: 30000 }); }
    catch { throw new Error('Synthetic media fixture generation failed.'); }
    let bytes = await readFile(file);
    if (kind === 'image') {
      const data = Buffer.concat([Buffer.from('Comment\0\0'), deflateSync(PRIVATE_MARKER)]);
      const chunk = Buffer.alloc(data.length + 12);
      chunk.writeUInt32BE(data.length); chunk.write('zTXt', 4); data.copy(chunk, 8);
      chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
      bytes = Buffer.concat([bytes.subarray(0, bytes.length - 12), chunk, bytes.subarray(bytes.length - 12)]);
      await writeFile(file, bytes);
    }
    result[kind] = { file, bytes, name: `fixture.${extension}`, mimeType: { image: 'image/png', audio: 'audio/wav', video: 'video/mp4' }[kind] };
  }
  return result;
}
