![Observanda](observanda_banner.png)

# Observanda

[![Hippocratic License HL3-FULL](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-FULL&labelColor=5e2751&color=bc8c3d)](LICENSE.md)
[![Sponsor Observanda](https://img.shields.io/badge/Sponsor-Observanda-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Seigr-lab)

**A local authoring workspace for documenting projects, keeping evidence and publishing selected work.**

Observanda brings together structured writing, original files, measurements, project tools, PDFs and static websites. Use it to document an engineering project, keep a research or field notebook, develop teaching material, maintain a studio journal or record a personal undertaking. Start with a few notes and photographs, or connect methods, repeated trials, datasets, reviews and results as the work develops.

The same authoring tools can serve an individual hobby, a classroom, a workshop or work within a laboratory or industrial organization. The amount of structure is your choice; a formal experiment is not required to write a useful record.

## Your machine, your data

Observanda is designed to run on your own computer, with workspaces in storage locations you choose. **Everyday authoring requires no Observanda cloud account, subscription or externally hosted server.** Your working copy stays in your chosen storage; sharing and publishing are explicit actions.

- **Work locally and offline.** Write, organize records, retain evidence and use the included tools after installation without an internet connection.
- **Keep the application infrastructure local.** The packaged desktop app includes its application service and database runtime and manages them on your machine. You do not need to administer a separate database server or subscribe to another product for ordinary authoring.
- **Control access.** Protect workspaces with encryption, password or authorized-device access, and separately configured recovery options.
- **Keep portable copies.** Back up and restore workspaces, move or copy individual projects and lab books, and retrieve retained original files. PDF and static website exports can be read without Observanda.
- **Choose what leaves your workspace.** Select material for a shared copy, document or website. Connecting a publishing destination is optional; private authoring does not require one.

This is the practical basis of data sovereignty in Observanda: you control where the working data lives, access to it, its backups and the material you release. You also remain responsible for protecting your computer and keeping recoverable backups.

Network features need only the connections you choose to use, such as a remote publishing destination, an external calendar source or collaboration with another installation. Building from source and obtaining application dependencies can require downloads. Local operation does not mean that every optional integration works offline.

## Alpha release

**Observanda is currently an Alpha release. It still needs more testing, and some features and workflows are not yet fully implemented.** Bugs and changes in behaviour should be expected; this is not a stable release.

Testing remains incomplete across operating systems, network storage, larger workloads and publishing destinations. Shared authoring also has unfinished workflows.

Use copies of important work when evaluating the Alpha, keep independent backups, and check exported or published material before sharing it.

## Organize work around your projects

**Workspace → Projects → Lab books → Records**

Keep separate workspaces for personal work, a studio, a laboratory or an organization. Projects can contain subprojects and several lab books, each following its own subject or activity.

A lab book is a collection of related records. It can be a design notebook, field diary, course journal, maintenance log or collection of recipes; the name does not restrict it to laboratory work.

Start with a blank book, choose a starter template or define your own record types and fields. Books in the same project can use different structures. Enable only the templates and tools you need.

Projects and lab books can be moved or copied individually with the records, revision history and original evidence they own. You do not need to transport an entire workspace to take one project with you.

Links to work outside the copy remain references and may require access to their source. Active cross-project stock reservations and pending inventory operations involving the selected work must be settled before copying.

## Write, read and connect

- **Compose rich documents.** Combine formatted writing, headings, tables, equations, code blocks, citations, images and figures.
- **Adapt the structure.** Add custom fields, tags and reusable record templates for the information you need to capture.
- **Link precise content.** Connect records, methods, runs and results, or reference a particular heading, table, equation or figure. Choose a current reference or an exact saved revision.
- **Follow the history.** Inspect earlier revisions and see how writing, evidence and interpretations developed.
- **Read across a book.** Browse full records without entering the editor, search and filter your material, and follow related work and incoming references.

A journal can remain a journal. Hypotheses, formal criteria and pass/fail outcomes are optional.

## Keep evidence connected to the work

Retain original images, recordings, instrument output, source documents and other files alongside the observations and interpretations they support.

Document preparations, methods, conditions, repeated attempts, events and assessments. Link assessments to the preparation and evidence they use, including unsuccessful, partial or inconclusive attempts.

Data tools let you:

- Import tabular data and describe columns, units, numeric representations and missing values.
- Keep original values and source references while creating revised schemas, calculations, grouped summaries and comparisons.
- Retain external analyses with their methods, inputs and outputs.
- Inspect a measurement's supporting data and, where a source mapping exists, follow it to the original bytes or fields.
- Create figures with panels, annotations, intervals and boundaries, while retaining the data and interpretation behind them.

### Work with measurements and derived data

Keep the original file, the interpreted dataset and the conclusions as distinct, connected material. Supported numeric representations preserve large integers and explicit-base values without silently converting them to ordinary floating-point numbers. Units, missing values, exclusions, calibration references and time meanings can be declared alongside the data.

Built-in dataset workflows include:

- Derived columns, conditional calculations and joins between retained datasets.
- Reusable calculation recipes and calculation graphs, with saved input revisions.
- Grouped summaries, quantiles, covariance, Pearson correlation and linear or weighted affine fits.
- Fourier spectra and cumulative-sum (CUSUM) analyses under explicit input and calculation policies.
- Declared coordinate frames and affine transformations, clock synchronization models and first-order statistical uncertainty propagation.
- Comparisons of retained results, including missing, excluded, unresolved and mismatched observations.

Calculations retain their methods and applicable precision policies. Some operations are exact; others require explicit approximation. Plot coordinates can be approximate even when the underlying values are retained exactly. A calculation, matching file hash or signed review does not by itself establish scientific correctness.

### Bring existing work into a project

Attach source files directly, import supported tabular data, or use the reviewed external-logbook import workflow. That workflow inspects a declared source inventory, stages originals privately, lets you map content and relationships, and applies the reviewed result with its provenance. It requires a compatible source declaration; it is not a universal importer for arbitrary folders or websites.

For recurring work, local intake proposals can attach preparation material, new evidence, external analysis results or record amendments to a specified saved record. Preview, staging and application are separate actions, with saved receipts and resumable jobs. An optional local command-line interface and authenticated local API support this workflow; a folder watcher reports proposals without applying them automatically.

External analysis programs remain outside Observanda. Their inputs, outputs, tool versions and declared methods can be retained without executing imported scripts. Manual writing and ordinary file attachments require no integration or automation.

## Tools for everyday work

Enable the tools you need alongside your books.

| Tool | What it supports |
| --- | --- |
| Scientific calculator | Expressions, units, statistics and exact integer and fractional base conversion. |
| Stoichiometry | Molar masses, solutions, limiting reagents and reaction yields. |
| Spreadsheet | Tables, formulas and delimited-file imports with original values retained. |
| Chemical structures | SMILES structures and supported molecular fragments from CDXML drawings, with original files preserved. |
| Sample analysis | Sample registers, analysis results and result sheets. |
| Inventory | Materials, equipment, software, stock movements, reservations and bills of materials. |
| Calendar and planning | Calendars, events, tasks, prerequisites and equipment bookings. |
| Timeline | Chronological views combining selected projects and lab books. |

For example, connect a prototype's bill of materials to its components, keep assembly observations in a lab book, reserve equipment for a test, and retain the resulting measurements with that experiment.

## Create PDFs and printed documents

Create independent documents in the PDF editor, combining authored text with selected research from projects and lab books. Include observations, tables, figures and images, and keep saved editions as the document develops.

Edit page dimensions, margins, columns, fonts, headers and footers. Arrange images with captions and alternative text, add section notes and endnotes, and reuse saved layouts. Preview and export PDFs in the desktop app for sharing or printing.

Choose a private or public edition and include or omit individual sections. Public output requires review of the exact included content; later content or document-setting changes require a new review. Retained PDF exports remain available to download after further edits.

The desktop PDF workflow also supports:

- Layout checks for measured overflow, image resolution and link destinations.
- PDF/A-2u archival output, checked with the bundled validator when that capability is available in the installation.
- PDF/UA-1 automated accessibility checks, with human accessibility review still required.
- Trim and bleed settings, crop marks, decorative backgrounds extending into bleed, and retained printer ICC colour profiles.

Commercial-print PDF/X export is not implemented. Physical printing and assistive-technology testing remain incomplete.

## Create independent websites

Use the visual website editor for a personal site, portfolio, field guide, project journal, teaching resource or documentation website. Build entirely from custom pages, include selected material from several lab books and projects, or combine both.

Create multiple independent websites, each with its own pages, design, public content selection and publishing destination. Choose its content independently of the lab-book hierarchy.

- Compose pages and arrange text, images, galleries and selected research content.
- Choose fonts and colours, and customize shared or page-specific headers, sidebars and footers.
- Select the records, sections, attachments, figures and supporting data that belong in each public edition.
- Browse a draft at desktop or phone width, then prepare and review a separate edition before publishing.
- Publish to GitHub Pages, deploy to an SSH host or export static files for another host.
- Review changes before updating a GitHub repository. To replace an existing website or application, review the complete replacement and optionally preserve the previous files in a separate branch. Existing `CNAME` and license files are kept; conflicting output is blocked.
- Retain prepared editions for later review and republication.

Publication permissions belong to the lab books, records and writing sections; each website's selection must respect them. An edition can omit preparation inputs, attempt details, linked-record information, contributor credits and result statements without changing the original record.

Website design is separate from the app's appearance. Publishing selected work does not publish the whole workspace, and website visitors do not need Observanda installed.

## Share work and request reviews

Exchange encrypted shared copies for offline collaboration. Collaborators with editing permission can edit the included records and return their changes; the owner reviews changes and conflicts before accepting them.

Request digitally signed reviews of specific saved record revisions. A review identifies what was examined, and later changes remain distinguishable from the reviewed version.

Organizations and teams provide membership, invitations and administration. Membership is separate from permission to open research: joining a team does not automatically grant access to its workspaces or lab books.

The source also includes direct live-connection workflows between installations for authorized research access and editing operations. Shared authoring remains unfinished in this Alpha; do not assume complete simultaneous editing or automatic synchronization of independent workspace copies.

Revoking access controls future permitted operations; it cannot erase files or plaintext that a recipient already holds.

## Make it fit your work

Starter templates cover research and development, analytical and quality-control work, education, clinical and forensic documentation, biosafety, environmental and agricultural work, computing, physical prototyping, audio software, creative practice and beekeeping. Adapt them or create your own.

A template provides record structure; it does not provide specialist analysis, clinical governance or regulatory validation.

## Examples: from a first notebook to a larger project

These examples combine the available tools into different working practices. Each can start with one project and one book, using only the features that help document the work.

| Project | What you could document | What you could make from it |
| --- | --- | --- |
| Engineering prototype | Design decisions, component inventory, bills of materials, assembly photographs, firmware sources, test conditions and repeated measurements. | A test report, an assembly guide or a website showing selected development stages. |
| Laboratory method development | Sample identities, preparation steps, instrument exports, calibration references, unsuccessful attempts and comparisons between retained results. | A method document with traceable figures and a review of a specific saved revision. |
| Industrial process investigation | Equipment and material records, observed deviations, supplied acceptance criteria, maintenance observations and evidence from repeated trials. | An internal investigation report that distinguishes observations, assessments and proposed changes. |
| Field ecology or an apiary | Seasonal observations, site visits, hive inspections, photographs, recordings and environmental measurements. | A field notebook, a seasonal PDF summary or a public nature journal with a selected subset of evidence. |
| Teaching or independent study | Reading notes, citations, worked examples, practical activities, datasets and reflections on what changed between attempts. | Course notes, a student project book or a static teaching resource. |
| Art, design or music | Material studies, sketches, drafts, recording takes, critiques, equipment settings and references to earlier versions. | A process journal, an illustrated PDF or a portfolio website, with private working notes kept separate. |
| Software or instrument development | Requirements, design alternatives, source snapshots, test logs, binary captures and externally generated analysis results. | Technical documentation connecting an observation to the retained source and test evidence behind it. |
| Home workshop or personal hobby | Repair steps, parts, recipes, fermentation batches, garden observations or night-sky notes. | A searchable personal reference, a printable procedure or a small project website. |

For example, a sensor-building project might use a design book for circuit choices, a construction book for assembly and parts, and a test book for recordings and measurements. A test record can reference the exact saved method and retain the original instrument export. Later, a PDF can explain the build while a website presents only the results and images chosen for publication.

A smaller project can stay simple: record a repair, attach before-and-after photographs, note the replacement part and write what worked. Add fields, inventory links or a reusable template only when they become useful.

## Start with one useful record

1. **Create a workspace** in a folder you control, choose its access protection and configure recovery separately.
2. **Create a project and a lab book.** Choose an available template or start with a blank book.
3. **Write one record.** Describe what you are doing, what you observed and what remains uncertain. Attach original files when they help.
4. **Connect the next piece of work.** Link a related record, a saved method, a dataset or a figure. Add more structure as the project needs it.
5. **Back up and share deliberately.** Verify a separate backup. When useful, prepare a PDF, reviewed website edition or encrypted shared copy containing the intended material.

The offline guide under **Preferences → Help** explains individual workflows, their source requirements and their limitations.

## Back up and recover

Encrypted backup and restore are available. Keep independent backups and recovery material separately from the working copy. Let backup verification finish, then test restoration into a separate location and retrieve representative records, earlier revisions and original evidence.

Configure recovery before it is needed. Resetting application preferences cannot decrypt a workspace whose access credentials are lost. Encryption protects stored content; protecting an unlocked computer remains part of protecting the work.

## Reading and interface preferences

Adjust interface language, text size and spacing independently of your published designs. Translations are incomplete; untranslated interface and Help text falls back to English.

## Support Observanda's development

You can help further Observanda's development by [becoming a sponsor on GitHub](https://github.com/sponsors/Seigr-lab). Contributions support development time, testing and documentation, including improvements to authoring, project portability, and PDF and website publishing.

## Help and feedback

Search the offline guide under **Preferences → Help**. Report bugs or suggest improvements through [GitHub Issues](https://github.com/Seigr-lab/Observanda/issues), using examples that do not contain private work or credentials.

Submitting a suggestion or reporting a bug does not guarantee a response, investigation, implementation, fix or delivery date. At the moment, there is no support contract or service-level commitment.

## License

Observanda is available under the **Hippocratic License 3.0, full version (HL3-FULL)**, which includes ethical conditions on use and distribution. See [LICENSE.md](LICENSE.md) for the complete terms.

**The software is provided as is, without warranty or guarantees**, as set out in the license.
