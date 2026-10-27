import {t} from './i18n/index.js';

export async function openDiagnostics({api,esc,showDialog}){
 const report=await api('/api/diagnostics'),json=JSON.stringify(report,null,2);
 showDialog(`<h2 id="dialog-title">${esc(t('preferences','diagnostics'))}</h2><p>${esc(t('preferences','diagnosticsSummary'))}</p><p role="status">${esc(t('preferences',report.status.available?'diagnosticsAvailable':'diagnosticsUnavailable'))}</p><details><summary>${esc(t('preferences','diagnosticsContents'))}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto" data-diagnostic-content></pre></details><div class="dialog-actions"><button class="button" data-diagnostic-download>${esc(t('preferences','diagnosticsDownload'))}</button><button class="button" data-action="close-dialog">${esc(t('preferences','diagnosticsClose'))}</button></div>`);
 const root=document.querySelector('#dialog');root.querySelector('[data-diagnostic-content]').textContent=json;
 root.querySelector('[data-diagnostic-download]').addEventListener('click',event=>{
  event.stopPropagation();const url=URL.createObjectURL(new Blob([json+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='observanda-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
