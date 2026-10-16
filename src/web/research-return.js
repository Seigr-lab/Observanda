import {recordBrowse} from './record-query.js';

// Return state contains navigation identities only. Editable module work stays
// in its owner's encrypted checkpoint, identified by a separate return token.
export function researchReturn(state){
 return {bookReading:!!state.bookReading,page:state.page,project:state.project,notebook:state.notebook,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book.id,owner:structuredClone(state.projectOwner??null),...(state.page==='module'?{moduleId:state.moduleId,modulePath:state.modulePath}:{})};
}

// Navigation can change while an owner opens or an encrypted draft is read.
// Each asynchronous participant receives the same lifetime as the Back action.
export function researchReturnNavigation({state,enterOwner,readyModule,restoreModule,render}){
 let generation=0;
 const view=()=>JSON.stringify([state.page,state.moduleId,state.modulePath]);
 return {
  invalidate(){generation++;},
  async back(){
   const request=++generation,context=state.storage?.contextId,returned=state.recordReturn;
   let expectedView=view(),assigned=false;
   const current=()=>request===generation&&context===state.storage?.contextId&&!state.access?.locked&&state.recordReturn===returned&&view()===expectedView;
   try{
    if(!current())return false;
    if(returned){
     const {owner,moduleReturn,...origin}=structuredClone(returned);
     if(owner!==undefined)await enterOwner(owner?.projectId??null,owner?.labBookId??null);
     if(!current())return false;
     Object.assign(state,origin);expectedView=view();assigned=true;
     if(state.page==='module'){
      await readyModule(state.moduleId);
      if(!current())return false;
      if(moduleReturn)await restoreModule(moduleReturn,{current});
      if(!current())return false;
     }
    }else{
     Object.assign(state,{page:'entries',search:'',filter:'all',recordBrowse:null});expectedView=view();
    }
    render();return true;
   }catch(error){
    if(!current()||error?.name==='AbortError')return false;
    // A current recovery failure must leave the displayed route consistent
    // with its owner. Its original checkpoint remains available for retry.
    if(assigned)render();
    throw error;
   }
  }
 };
}
