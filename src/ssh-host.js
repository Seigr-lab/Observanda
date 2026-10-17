import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {deploySSH} from './ssh-deployment.js';
import { execFile, spawn } from 'node:child_process';
import { AppError } from './errors.js';

function execute(program, args, { input = '', cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    if(program==='sftp'){const child=spawn(program,args,{cwd,signal,timeout:180000,windowsHide:true,stdio:['pipe','ignore','pipe']});child.stderr.resume();child.on('error',()=>reject(new AppError('PUBLISH_SSH')));child.on('close',code=>code?reject(new AppError('PUBLISH_SSH')):resolve(''));child.stdin.on('error',()=>{});child.stdin.end(input);return;}
    const child = execFile(program, args, { cwd, signal, windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(new AppError('PUBLISH_SSH')) : resolve(stdout));
    child.stdin.on('error', () => {});
    if(input&&typeof input[Symbol.asyncIterator]==='function')pipeline(Readable.from(input),child.stdin).catch(()=>{child.kill();reject(new AppError('PUBLISH_SSH'));});
    else child.stdin.end(input);
  });
}
const guard = c => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(c.host) || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(c.user) || !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(c.directory) || c.directory.split('/').some(p => p === '.' || p === '..') || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new AppError('PUBLISH_CONFIG');
};
export class SSHHost {
  constructor(run = execute) { this.run = run; }
  args(c) { return ['-F', 'none', '-oBatchMode=yes', '-oStrictHostKeyChecking=yes', '-oConnectTimeout=15', '-oServerAliveInterval=30', '-oServerAliveCountMax=3', '-oForwardAgent=no', '-oClearAllForwardings=yes', ...(c.identityFile ? ['-i', c.identityFile] : [])]; }
  async command(c, script, input = '',{signal}={}) { guard(c); return this.run('ssh', [...this.args(c), '-p', String(c.port), `${c.user}@${c.host}`, script], { input,signal }); }
  async check(c,{signal}={}) {
    const output = await this.command(c, 'set -eu; for tool in sha256sum find readlink chmod tr wc mkdir ls cat rm; do command -v $tool >/dev/null; done; mv --version >/dev/null; ln --version >/dev/null; printf observanda-ssh-ready','',{signal});
    if (output.trim() !== 'observanda-ssh-ready') throw new AppError('PUBLISH_SSH');
  }
  deploy(c,candidate,owner,options){guard(c);return deploySSH(this,c,candidate,owner,options);}
}
