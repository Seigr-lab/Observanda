import {taskStarters,taskStarterDescription,createTaskRecord} from './task-starters.js';
import {LANGUAGES,messageLanguage} from './i18n/index.js';

export function taskStartersUI({state,esc,tr,dialog,frame,openRecordDraft,openBook,chooseDestination,selectedNotebook}) {
  let query='', kind='', selected=null;
  const description=starter=>taskStarterDescription(starter,tr);
  const fold=value=>value.toLocaleLowerCase(messageLanguage('recordStarters')).normalize('NFKD').replace(/\p{M}/gu,'');
  function results() {
    const terms=fold(query).trim().split(/\s+/u).filter(Boolean);
    const matches=taskStarters.filter(starter=>{
      if(kind&&starter.kind!==kind)return false;
      const {name,description:purpose,sections}=description(starter);
      const text=fold([name,purpose,tr(starter.kind==='book'?'taskBook':'taskRecord'),...sections.flatMap(section=>[section.label,...section.fields.map(field=>field.label)])].join(' '));
      return terms.every(word=>text.includes(word));
    });
    return matches.length ? '<div class="record-type-grid">'+matches.map(starter=>{
      const {name,description:purpose}=description(starter);
      return '<button type="button" class="record-type-option" data-action="starter-task-preview" data-task="'+starter.id+
        '" aria-labelledby="starter-name-'+starter.id+'" aria-describedby="starter-detail-'+starter.id+'"><strong id="starter-name-'+starter.id+'">'+esc(name)+
        '</strong><span id="starter-detail-'+starter.id+'">'+esc(purpose)+'</span></button>';
    }).join('')+'</div>' : '<p role="status">'+esc(tr('taskNoResults'))+'</p>';
  }
  function library() {
    selected=null;
    return '<section aria-labelledby="task-starters-title"><h3 id="task-starters-title">'+esc(tr('taskLibrary'))+'</h3>'+
      '<div class="inline-actions"><label class="field">'+esc(tr('taskSearch'))+'<input type="search" data-task-search maxlength="160" value="'+esc(query)+'"></label>'+
      '<label class="field">'+esc(tr('taskOutput'))+'<select data-task-kind>'+[['','taskAll'],['record','taskRecord'],['book','taskBook']].map(([value,label])=>
        '<option value="'+value+'"'+(value===kind?' selected':'')+'>'+esc(tr(label))+'</option>').join('')+'</select></label></div>'+
      '<div data-task-results>'+results()+'</div></section>';
  }
  function bind() {
    const input=dialog().querySelector('[data-task-search]'),filter=dialog().querySelector('[data-task-kind]');
    const update=()=>{query=input.value;kind=filter.value;dialog().querySelector('[data-task-results]').innerHTML=results();};
    input?.addEventListener('input',update);filter?.addEventListener('change',update);
  }
  function preview(id) {
    selected=taskStarters.find(starter=>starter.id===id);
    if(!selected)return;
    const book=selected.kind==='book', {name,description:purpose,sections}=description(selected);
    const locale=messageLanguage(selected.languageNamespace),language=LANGUAGES.find(item=>item.id===locale)?.name??locale;
    const destinations=book?state.book.projects:state.book.notebooks;
    const preferred=book?state.project: selectedNotebook();
    const destination=destinations.some(item=>item.id===preferred)?preferred:destinations.length===1?destinations[0].id:null;
    const choices=destinations.map(item=>'<option value="'+esc(item.id)+'"'+(item.id===destination?' selected':'')+'>'+esc(item.title)+'</option>').join('');
    const rows=sections.map(({key,label,fields})=>'<li><label><input name="section" type="checkbox" value="'+key+'" checked> '+esc(label)+'</label>'+
      (fields.length?'<p>'+esc(fields.map(field=>field.label).join(' · '))+'</p>':'')+'</li>').join('');
    frame(name,'<form id="starter-task-form" data-no-draft><p>'+esc(purpose)+'</p><p>'+esc(tr(book?'taskBookCopy':'taskRecordCopy'))+'</p>'+
      '<label class="field">'+esc(tr(book?'taskBookTitle':'title'))+'<input name="title" maxlength="'+(book?160:180)+'" pattern=".*\\S.*" required value="'+esc(name)+'"></label>'+
      '<label class="field">'+esc(tr(book?'taskProject':'book'))+'<select name="destination" required><option value="">'+esc(tr(book?'taskProject':'book'))+'</option>'+choices+
      '<option value="browse"'+(destinations.length?'':' selected')+'>'+esc(tr(book?'taskBrowseProjects':'taskBrowseBooks'))+'</option></select></label>'+
      (rows?'<fieldset><legend>'+esc(tr(book?'taskTypes':'taskSections'))+'</legend><ul class="task-starter-sections">'+rows+'</ul></fieldset>':'')+
      '<details><summary>'+esc(tr('taskDetails'))+'</summary><p>'+esc(tr('taskEdition',{version:selected.version,language}))+'</p><p>'+
      esc(tr('taskCopyPolicy'))+'</p><p>'+esc(tr(book?'taskBookCapability':'taskRecordCapability'))+'</p><p>'+esc(tr('taskKeyboard'))+'</p></details>'+
      (destinations.length?'':'<p role="status">'+esc(tr(book?'taskNeedsProject':'taskNeedsBook'))+'</p>')+
      '<div class="dialog-actions"><button type="button" class="button" data-action="starter-list">'+esc(tr('back'))+'</button><button class="button primary" type="submit">'+esc(tr(book?'taskBookSetup':'taskCreateRecord'))+'</button></div></form>');
  }
  async function submit(form) {
    if(form.id!=='starter-task-form')return false;
    if(!selected||!form.reportValidity())return true;
    const data=new FormData(form),title=String(data.get('title')??'').trim(),destination=String(data.get('destination')??'');
    if(!title){form.elements.title.focus();return true;}
    const starter=selected,sections=description(starter).sections.filter(section=>data.getAll('section').includes(section.key)),book=starter.kind==='book';
    const start=async id=>{
      if(book){
        if(!state.book.projects.some(project=>project.id===id))throw Error(tr('reopen'));
        await openBook(id,{title,sections,starterId:starter.id});return;
      }
      if(!state.book.notebooks.some(item=>item.id===id))throw Error(tr('reopen'));
      const record=createTaskRecord(starter,{title,sections,notebookId:id,now:new Date().toISOString(),uuid:()=>crypto.randomUUID()});
      if(dialog().open)dialog().close();await openRecordDraft(record);
    };
    if(destination==='browse')chooseDestination(book,start);else await start(destination);
    return true;
  }
  return {library,bind,preview,submit,reset(){query=kind='';selected=null;}};
}
