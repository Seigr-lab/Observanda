// Keep startup recovery independent of the application's module graph.
window.addEventListener('error',event=>{
 if(event.target?.id!=='application-module')return;
 const show=()=>{
  const host=document.getElementById('app');if(!host)return;
  const main=document.createElement('main');main.id='main';main.className='loading';
  const heading=document.createElement('h1');heading.textContent=messages.moduleFailed;
  const message=document.createElement('p');message.textContent=messages.moduleMessage;
  const retry=document.createElement('button');retry.type='button';retry.className='button primary';retry.textContent=messages.reload;retry.addEventListener('click',()=>location.reload());
  main.append(heading,message,retry);host.replaceChildren(main);heading.tabIndex=-1;heading.focus();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();
},true);
