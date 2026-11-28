import {recordDraftList} from './record-draft-list.js';
// Record checkpoints waiting for review: the banner that announces them and the list that recovers them.
export function recordDraftsUI({api,esc,onChange,onReset,recoverWriting,recoverValue,recoverDocument,notify,openDraft}){
  const list=recordDraftList({api,esc,onChange,recoverWriting,recoverValue,recoverDocument,notify,openDraft});
  async function start(workspaceId){
    onReset?.();
    await list.reset(workspaceId??null);
  }
  const banner=()=>list.banner();
  function update(){
    const bannerElement=document.querySelector('#record-draft-banner');
    if(bannerElement){
      const focused=bannerElement.contains(document.activeElement);bannerElement.outerHTML=banner();
      if(focused)document.querySelector('[data-record-drafts]')?.focus({preventScroll:true});
    }
  }
  return {start,banner,update,show:list.show,refresh:list.refresh,isRecovering:list.isBusy,close(){list.close();void start(null);}};
}
