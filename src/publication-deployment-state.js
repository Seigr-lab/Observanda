// SSH, SFTP and FTP claim the destination first; GitHub only by its push.
export const deploymentUncertain=(journal,kind)=>['ssh','sftp','ftp'].includes(kind)?journal.lockAttempted&&!journal.released:journal.pushAttempted&&!journal.receipt;
