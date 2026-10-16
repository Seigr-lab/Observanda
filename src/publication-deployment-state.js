export const deploymentUncertain=(journal,kind)=>kind==='ssh'?journal.lockAttempted&&!journal.released:journal.pushAttempted&&!journal.receipt;
