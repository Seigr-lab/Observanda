import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {workDirectory} from '../scripts/work-directory.js';
import {ownerWorkspaceRoot} from '../src/owner-postgres.js';
import {CATALOGUE_ACTIVATION,CATALOGUE_FILE,workspaceCatalogueBinding} from '../src/postgres-activation.js';
import {PROJECT_ARCHIVE_IDENTITY} from '../src/project-archive.js';
import {LAB_BOOK_ARCHIVE_IDENTITY} from '../src/lab-book-archive.js';

const put=async(root,relative,value)=>{await mkdir(path.join(root,'.observanda'),{recursive:true});await writeFile(path.join(root,relative),JSON.stringify(value));};
const activation=root=>put(root,CATALOGUE_ACTIVATION,{format:'observanda-postgresql-activation',version:1,id:randomUUID()});

// A workspace restored from its archive verifies records retired into its
// projects before its binding is published: those projects must find it.
test('parts find their workspace while it is bound or activating from its archive, never a part in archive form',async()=>{
 const work=await workDirectory('test-work'),directory=await mkdtemp(path.join(work,'owner-workspace-root-'));
 try{
  const workspace=path.join(directory,'Workspace'),project=path.join(workspace,'Project'),book=path.join(project,'Lab book');
  await mkdir(book,{recursive:true});
  await assert.rejects(ownerWorkspaceRoot(book),{code:'DATABASE_LOCATION'});

  // Activating workspace; the project and lab book are still archives with their own activation in progress.
  await activation(workspace);await activation(project);await activation(book);
  await put(project,PROJECT_ARCHIVE_IDENTITY,{});await put(book,LAB_BOOK_ARCHIVE_IDENTITY,{});
  assert.equal(await ownerWorkspaceRoot(project),workspace);
  assert.equal(await ownerWorkspaceRoot(book),workspace);

  // A project in archive form outside any workspace is not a workspace.
  const loose=path.join(directory,'Loose project'),looseBook=path.join(loose,'Lab book');await mkdir(looseBook,{recursive:true});
  await activation(loose);await put(loose,PROJECT_ARCHIVE_IDENTITY,{});
  await assert.rejects(ownerWorkspaceRoot(looseBook),{code:'DATABASE_LOCATION'});

  // Once published, the workspace binding locates it as before.
  await rm(path.join(workspace,CATALOGUE_ACTIVATION));
  await assert.rejects(ownerWorkspaceRoot(project),{code:'DATABASE_LOCATION'});
  await put(workspace,CATALOGUE_FILE,workspaceCatalogueBinding(randomUUID(),randomUUID()));
  assert.equal(await ownerWorkspaceRoot(project),workspace);
  assert.equal(await ownerWorkspaceRoot(book),workspace);
 }finally{
  if(path.dirname(directory)!==work||!path.basename(directory).startsWith('owner-workspace-root-'))throw Error('Invalid test directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
