// Serialize account changes with requests that enqueue or perform publication.
// Once a job is queued, the durable queue supplies the longer-lived guard.
const serialized=new Set([
 '/api/github-connection/start','/api/github-connection/choose','/api/github-connection/disconnect',
 '/api/publishing/connect','/api/publishing/disconnect'
]);
export const githubSerializedRequest=(method,pathname)=>method==='POST'&&serialized.has(pathname);
