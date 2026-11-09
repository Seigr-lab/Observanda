# Website acceptance

A website feature is complete only when an author can use it from the ordinary website editor, save and reopen the result, and publish an independent copy that a separate browser reads correctly. This document defines the representative tasks, the release rubric and the evidence that each task must leave behind. It complements `docs/release-qualification.md`, which binds the evidence to an exact installer.

## Evidence rules

- Start every task from the website editor that a person opens from the workspace. Fixtures may be created through the website store or import, but every claimed interaction must use the normal controls.
- Inspect the saved files and the published output, not only the editor. A screenshot supplements the published bytes; it never replaces them.
- Record the starting fixture, each action, any assistance, the saved revision, the published release identity and the files that changed.
- Repeat the keyboard path for each task. Every control used in the task must be reachable and operable without a pointer.
- Run each task once in English and once in another supported language. Authored content must remain unchanged by the interface language.
- Record narrow-window behaviour (640 CSS pixels) and the large-document profile from `docs/website-workloads.md`.
- A feature fails acceptance if it is reachable only through an unused route, if a test bypasses its normal interface, or if combining it with another completed feature breaks the task.

## Representative tasks

### Hobby project

- **Goal:** publish a small illustrated site about a personal project.
- **Fixture:** a new website with no research material.
- **Actions:** add two pages, an image gallery with descriptions, a grid section and a colour theme; save, undo and redo one change; publish to a folder; open the folder copy in a separate browser at phone and desktop widths.
- **Expected output:** every page, picture rendition and stylesheet is present; responsive picture candidates load from the folder only; nothing references the workspace.
- **Integrity and privacy:** no private draft page or editor-only markup is published.

### Field notebook

- **Goal:** publish dated field observations with photographs and a results table.
- **Fixture:** a website with one permitted research entry and one photograph whose source access can be withdrawn.
- **Actions:** place the entry and photograph, frame the photograph without altering the original, edit table headers, publish, then withdraw the photograph's source and review the release view.
- **Expected output:** the release view lists the photograph renditions that the next update removes; the update removes them; the original evidence file remains unchanged in the lab book.
- **Integrity and privacy:** withdrawn material is absent from the next publication and from every preview, comment and review summary.

### Scientific report

- **Goal:** publish a bilingual report with figures, numbered tables, references and search metadata.
- **Fixture:** an English report page and a Catalan translation in a folder of the site.
- **Actions:** repair a broken reference using the target picker; run the rendered accessibility check at two widths and fix each automatic finding; link the translation; set the public address; publish to a folder that represents a subdirectory deployment.
- **Expected output:** canonical and language alternative declarations use the public address; the sitemap lists only public pages; social preview fields describe the page; no editor request reaches the public address.
- **Integrity and privacy:** exact numeric strings and units in tables are unchanged; private drafts are absent from pages, sitemap and manifest.

### Multi-author lab

- **Goal:** publish a lab website only after another member approves the exact edition.
- **Fixture:** a workspace with access control and two identified members.
- **Actions:** require approval; the author requests review; the reviewer comments on a figure caption; the author corrects it; the reviewer approves the corrected edition; the author publishes; a later edit makes the approval stale; the author withdraws the publication.
- **Expected output:** publishing is refused until approval of the current edition; the approval names the edition it covers; withdrawal remains possible without approval.
- **Integrity and privacy:** comments store only the reviewer's words and an element address; context is read from the current page.

## Release rubric

| Area | Pass condition |
|---|---|
| Discoverability | The task's controls are found from the website editor tool groups without documentation. |
| Error recovery | Every refused action explains the cause and the next step; no draft or reviewed work is lost. |
| Typography and density | Panels fit at 640 CSS pixels without horizontal scrolling of the page; headings and labels are distinct. |
| Focus and selection | Opening a panel moves focus to its heading; returning to editing restores the canvas selection where one existed. |
| Keyboard | Each task completes with the keyboard alone. |
| Localization | Interface text follows the selected language; authored text never changes with it. |
| Large documents | The workload profile budgets in `docs/website-workloads.md` hold for the declared machine. |
| Output | Published bytes, file names and release identities match the reviewed edition. |

## Automated journeys

The browser journeys below exercise these tasks through the normal interface and inspect the published files. They run with `node scripts/test.js --browser <file>`.

| Journey | Covers |
|---|---|
| `test/browser/website-component-gallery.spec.js` | Gallery authoring, responsive renditions and a working published viewer on nested pages. |
| `test/browser/website-source-gallery-workflow.spec.js` | Research photographs, non-destructive framing, rendition selection at two widths and densities, withdrawal and regrant. |
| `test/browser/website-access-review.spec.js` | Rendered accessibility review, repairs without HTML and keyboard reading of the exported report. |
| `test/browser/website-site-review.spec.js` | Reference integrity, the target picker and following the published reference. |
| `test/browser/website-laboratory-tables.spec.js` | Grouped laboratory tables with merged headers, units and a permitted retained result. |
| `test/browser/website-releases.spec.js` | Release view, outstanding changes, reviewed withdrawal and reopening a released version. |
| `test/browser/website-discovery.spec.js` | Public address, language versions, sitemap and social declarations with no editor network request. |
| `test/browser/website-review.spec.js` | Required approval, element comments, stale approvals and publication after approval. |
| `test/browser/website-journey.spec.js` | The complete design, reuse, inclusion, recovery and independent output journey (J3). |

An unfamiliar-user trial is recorded separately with completion rate, assistance, missteps and lost-work incidents. Automated journeys do not substitute for it.
