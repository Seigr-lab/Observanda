import { randomUUID } from 'node:crypto';
import { upgradeNotebook, validateNotebook } from './model.js';
import { logosFor } from './web/branding.js';
import {deleteLabBook} from './lab-books.js';
import {selectToolProjects} from './web/project-tools.js';
import { AppError } from './errors.js';

const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;

export function reorganizeWorkspace(source, change) {return validateResult(applyReorganization(upgradeNotebook(source),change));}
const validateResult=result=>({...result,book:validateNotebook(result.book)});

// These transformations operate on a private draft. The document adapter or
// indexed command adapter validates and persists the result atomically.
function applyReorganization(book, change) {
  if (!exact(change, ['workspaceTitle','workspaceDescription','projectId','copyLogos']) || !name(change.workspaceTitle) || typeof change.workspaceDescription !== 'string' || typeof change.copyLogos !== 'boolean') throw new AppError('INVALID');
  let project = book.projects.find(p => p.id === change.projectId);
  if (!project && change.projectId !== 'new') throw new AppError('INVALID');
  const created = !project, previousTitle = project?.title ?? null;
  if (created) {
    project = { id: randomUUID(), title: book.title, description: book.description, share: false, logoId: null };
    book.projects.push(project);
  } else {
    project.title = book.title; project.description = book.description;
  }
  if (change.copyLogos) {
    const logos = structuredClone(logosFor(book, 'home'));
    book.branding = book.branding.filter(b => b.target !== 'project:' + project.id);
    book.branding.push({ target:'project:' + project.id, logos });
  }
  book.title = change.workspaceTitle.trim(); book.description = change.workspaceDescription;
  const notebooks = book.notebooks.filter(n => n.projectId === project.id);
  const records = book.entries.filter(e => notebooks.some(n => n.id === e.notebookId));
  return { book, projectId: project.id, summary: { workspaceTitle:book.title, projectTitle:project.title, previousTitle, created, notebooks:notebooks.length, records:records.length, copyLogos:change.copyLogos } };
}

export function editNotebook(source, change) {return validateResult(applyNotebookEdit(upgradeNotebook(source),change));}
function applyNotebookEdit(book, change) {
  if (!exact(change, ['id','title','projectId']) || !name(change.title)) throw new AppError('INVALID');
  const notebook = book.notebooks.find(n => n.id === change.id);
  if (!notebook || !book.projects.some(p => p.id === change.projectId)) throw new AppError('INVALID');
  const moved = notebook.projectId !== change.projectId;
  return {...applyStructure(book,{kind:'notebook',value:{...notebook,title:change.title.trim(),projectId:change.projectId}}),moved};
}

// Structural edits are isolated from record editing and guarded by the workspace etag.
export function saveStructure(source,change){return validateResult(applyStructure(upgradeNotebook(source),change));}
function applyStructure(book,change){
 if(!exact(change,['kind','value'])||!['project','notebook','project-tools','delete-notebook'].includes(change.kind)||!change.value||typeof change.value!=='object'||Array.isArray(change.value))throw new AppError('INVALID');
 if(change.kind==='delete-notebook')return {book:deleteLabBook(book,change.value)};
 if(change.kind==='project-tools'){
  if(!exact(change.value,['moduleId','projectIds']))throw new AppError('INVALID');
  try{selectToolProjects(book,change.value.moduleId,change.value.projectIds);}catch{throw new AppError('INVALID');}
  return {book};
 }
 const collection=change.kind==='project'?book.projects:book.notebooks;
 const value=structuredClone(change.value),index=collection.findIndex(e=>e.id===value.id);
 const previous=collection[index];
 if(change.kind==='project'&&previous?.parentId!==value.parentId)value.share=false;
 if(change.kind==='notebook'&&previous&&previous.projectId!==value.projectId)
  for(const record of book.entries.filter(e=>e.notebookId===value.id))record.share=false;
 if(index<0)collection.push(value);else collection[index]=value;
 return {book};
}

// Partial drafts contain every affected record and complete workspace metadata;
// unrelated bodies stay in the catalogue. Callers must validate before commit.
export function transformStructure(source,kind,change){
 const book=structuredClone(source);
 if(kind==='structure')return applyStructure(book,change);
 if(kind==='notebook')return applyNotebookEdit(book,change);
 if(kind==='reorganize')return applyReorganization(book,change);
 throw new AppError('INVALID');
}
