import {expect, test} from '@playwright/test';
import {mock} from 'node:test';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../../src/storage.js';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {testServer} from '../device-fixture.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {encryptedFixture} from './encrypted-fixture.js';

const revisedHeading = 'Salinity calibration protocol';
const card = `<section id="sampling-card"><h2>Salinity calibration</h2>
 <p>Compare the instrument with the field standard.</p>
 <table><caption>Reference measurements</caption>
 <thead><tr><th scope="col">Station</th><th scope="col">Salinity (PSU)</th></tr></thead>
 <tbody><tr><td>Estuary inlet</td><td>32.4</td></tr></tbody></table>
 <p><a href="method.html">Read the sampling method</a></p></section>`;

function authoredPage(title, body, style = 'style.css') {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
 <link rel="stylesheet" href="${style}"></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}
const authoredFiles = new Map([
 ['index.html', authoredPage('Coastal research handbook', card)],
 ['field/stations.html', authoredPage('Station observations', '<p>Record each site at high tide.</p>', '../style.css')],
 ['method.html', authoredPage('Sampling method', '<p>Rinse the probe before calibration.</p>')],
 ['style.css', `body{font:17px/1.55 system-ui;color:#173b3c;background:#f7f9f6;margin:0}
 main{max-width:45rem;margin:2rem auto;padding:0 1.5rem}h1,h2{line-height:1.2}
 section{padding:1.4rem;border:1px solid #88aaa1;border-radius:.7rem;background:white}
 table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bccfc9;padding:.3rem .55rem;text-align:left}
 caption{text-align:left;font-weight:bold}a{color:#176456}`]
]);


async function servePublishedFiles(output) {
 const published = new Map();
 for (const name of authoredFiles.keys()) {
  published.set('/' + name, await readFile(path.join(output, ...name.split('/'))));
 }
 const server = createServer((req, res) => {
  if (!published.has(req.url)) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
   'Content-Type': req.url.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8',
   'Content-Security-Policy': "default-src 'none'; style-src 'self'"
  }).end(published.get(req.url));
 });
 await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
 return server;
}

test('an authored component is placed, edited once and published on two independent pages through the files-only editor', async ({page, context}) => {
 test.setTimeout(120000);
 const directory = await mkdtemp(path.join(os.tmpdir(), 'observanda-reusable-pages-'));
 const output = path.join(directory, 'Field handbook');
 const operations = [], errors = [];
 let fixture, app, publicServer, catalogue;
 try {
  fixture = await encryptedFixture(directory, createNotebook('Field studies'));
  await mkdir(output);
  await new WebsiteFileStore(fixture.workspace).importFiles(randomUUID(), {name:'Coastal handbook', files:authoredFiles});
  catalogue = mock.method(Workspace.prototype, 'openCatalogue', () => { throw Error('Unexpected research catalogue access'); });
  app = await testServer({
   root:fixture.workspace.root, deviceStore:fixture.deviceStore,
   preferencesFile:path.join(directory, 'preferences.json'), port:0
  });
  const url = new URL(app.origin);url.hash=app.launchToken;
  url.searchParams.set('view', 'website');
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => {
   const {pathname} = new URL(req.url());
   if (pathname.startsWith('/api/')) operations.push(pathname);
  });
  await page.setViewportSize({width:1440, height:1000});
  await page.goto(url.href);

  const canvas = page.frameLocator('#website-files-canvas');
  const library = page.locator('[data-website-components]');
  const choosePage = page.locator('[data-website-file-page]');
  const instance = canvas.locator('[data-website-instance]');
  await expect.poll(async()=>errors.length?errors.join('\n'):await canvas.getByRole('heading', {name:'Coastal research handbook'}).count(),{timeout:15000}).toBe(1);
  const originalCanvas=await page.locator('#website-files-canvas').elementHandle();
  await page.getByRole('button', {name:'Reusable library',exact:true}).click();
  await expect(library.getByText('Your library is empty.',{exact:false})).toBeVisible();
  expect(await originalCanvas.evaluate(node=>node.isConnected)).toBe(true);
  await canvas.locator('#sampling-card').click({position:{x:9, y:9}});
  await library.getByLabel('Component name', {exact:true}).fill('Calibration panel');
  await library.getByRole('button', {name:'Create from selected block'}).click();
  await expect(instance).toHaveCount(1);
  await expect(instance.getByRole('table', {name:'Reference measurements'})).toBeVisible();
  const savedCanvas=await page.locator('#website-files-canvas').elementHandle();
  await library.getByLabel('Search component names').fill('unmatched');
  await expect(library.getByText('No matching components.')).toBeVisible();
  await library.getByLabel('Search component names').fill('Calib');
  await expect(library.getByText('Placements 1 · Pages 1')).toBeVisible();
  expect(await savedCanvas.evaluate(node=>node.isConnected)).toBe(true);

  await choosePage.selectOption('field/stations.html');
  await expect(canvas.getByRole('heading', {name:'Station observations'})).toBeVisible();
  await expect(library.getByLabel('Search component names')).toHaveValue('Calib');
  await library.locator('[data-component-field="position"]').selectOption('end');
  await library.getByRole('button', {name:'Insert instance'}).click();
  await expect(instance.getByRole('link')).toHaveAttribute('href', '../method.html');
  await expect(library.getByText('Placements 2 · Pages 2')).toBeVisible();
  await library.getByRole('button',{name:'Where used'}).click();
  if(process.env.OBSERVANDA_COMPONENT_SCREENSHOT){
   await expect(library.locator('[data-instance]')).toHaveCount(2);await expect(library.getByRole('button',{name:'Where used'})).toBeEnabled();
   await library.locator('[data-instance]').last().scrollIntoViewIfNeeded();await page.screenshot({path:process.env.OBSERVANDA_COMPONENT_SCREENSHOT});
  }
  await library.locator('[data-instance]').filter({hasText:'index.html'}).click();
  await expect(choosePage).toHaveValue('index.html');

  await library.getByRole('button', {name:'Edit main component'}).click();
  const dialog = page.getByRole('dialog', {name:'Edit main component'});
  const main = dialog.frameLocator('[data-main-canvas]');
  await main.getByRole('heading', {name:'Salinity calibration'}).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' protocol');
  await expect(main.getByRole('heading', {name:revisedHeading})).toBeVisible();
  await dialog.getByRole('button', {name:'Review component changes'}).click();
  await dialog.getByRole('button', {name:'Update all instances'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(instance.getByRole('heading', {name:revisedHeading})).toBeVisible();
  await expect(page.getByRole('button', {name:'Save website', exact:true})).toBeDisabled();

  await page.reload();
  await expect(instance.getByRole('heading', {name:revisedHeading})).toBeVisible();
  await expect(instance.getByRole('link')).toHaveAttribute('href', 'method.html');
  await choosePage.selectOption('field/stations.html');
  await expect(instance.getByRole('heading', {name:revisedHeading})).toBeVisible();
  await expect(instance.getByRole('link')).toHaveAttribute('href', '../method.html');

  await page.getByRole('button', {name:'Publish to folder', exact:true}).click();
  await page.getByLabel('Destination folder', {exact:true}).fill(output);
  await page.getByRole('button', {name:'Review file changes'}).click();
  await page.locator('[data-website-file-folder-confirm]').check();
  await page.getByRole('button', {name:'Write reviewed files'}).click();
  await expect(page.getByText('Edition written and verified.', {exact:true})).toBeVisible();

  publicServer = await servePublishedFiles(output);
  const origin = 'http://127.0.0.1:' + publicServer.address().port;
  const viewer = await context.newPage();
  const instanceIds = new Set();
  for (const [file, title, href] of [
   ['index.html', 'Coastal research handbook', 'method.html'],
   ['field/stations.html', 'Station observations', '../method.html']
  ]) {
   await viewer.goto(origin + '/' + file);
   await expect(viewer.getByRole('heading', {name:title})).toBeVisible();
   const linked = viewer.locator('[data-website-instance]');
   await expect(linked).toHaveCount(1);
   instanceIds.add(await linked.getAttribute('data-website-instance'));
   await expect(linked.getByRole('heading')).toHaveText(revisedHeading);
   await expect(linked.getByRole('cell', {name:'32.4'})).toBeVisible();
   const anchor = linked.getByRole('link');
   await expect(anchor).toHaveAttribute('href', href);
   await anchor.click();
   await expect(viewer).toHaveURL(origin + '/method.html');
   await expect(viewer.getByRole('heading', {name:'Sampling method'})).toBeVisible();
  }
  expect(instanceIds.size).toBe(2);
  expect(operations.filter(p => p.endsWith('/components/update'))).toHaveLength(1);
  expect(errors).toEqual([]);
  expect(catalogue.mock.callCount()).toBe(0);
  const sessionRoutes = new Set(['/api/session', '/api/access/status', '/api/language', '/api/interface']);
  expect(operations.filter(p => !p.startsWith('/api/website-files/') && !sessionRoutes.has(p))).toEqual([]);
 } finally {
  if (publicServer) await new Promise(resolve => publicServer.close(resolve));
  try { await app?.close(); } finally {
   catalogue?.mock.restore();
   await closeIdleMutationFiles();
   if (fixture) await clearVault(fixture.vault);
   if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('observanda-reusable-pages-')) throw Error('Unexpected component fixture');
   await rm(directory, {recursive:true, force:true, maxRetries:12, retryDelay:150});
  }
 }
});
