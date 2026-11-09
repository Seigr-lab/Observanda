# Website workloads

This document defines the website workload profiles, how they are measured, the proposed budgets and the most recent measurements. The values are evidence for a specific machine and build. They are not a scale claim for other hardware, network storage or the installed desktop application.

## Profiles

Each profile is generated through the website store and the ordinary save path. Pictures enter one save at a time, components are created from a section and inserted through the component service, and the large page is opened in the website editor.

| Profile | Pages | Pictures | Sections on the large page | Sections on other pages | Component placements | Results tables |
|---|---|---|---|---|---|---|
| Hobby | 6 | 12 | 120 | 30 | 0 | 0 |
| Team | 40 | 60 | 400 | 40 | 100 | 4 × 80 rows × 12 columns |
| Lab | 200 | 300 | 1,500 | 40 | 100 | 20 × 200 rows × 12 columns |

## Measurements

| Measurement | Definition |
|---|---|
| Edit | One key press in a paragraph of the large page until the editor document renders two frames after it. Includes Playwright round trips. |
| Select | A click on a section heading in the canvas until the selection trail names that section. |
| Save | The Save website command after a one-character edit, until the editor reports that the website is saved. |
| Export | Opening the complete edition and verifying every file, including privacy scanning of text files. This is the work a reviewed delivery repeats before writing. |
| Overview | The Releases panel request, which compares the edition with the delivered inventory. |
| Component | Updating the main component and propagating it to every placement in one saved revision. |
| Cancel | Time from abort to the release of a running full verification. |
| Delivery | One reviewed folder delivery of the complete site (single sample). |

Each run records raw samples, p50, p95 and maximum, peak renderer JavaScript heap, peak service resident memory, file-system operation counts and the machine profile. Results are attached to the test as `website-workload-<profile>.json` and written to `OBSERVANDA_WEBSITE_REPORT` when that variable is set.

Run a profile with explicit budgets:

```sh
OBSERVANDA_WEBSITE_BENCHMARK=1 OBSERVANDA_WEBSITE_PROFILE=team \
OBSERVANDA_WEBSITE_EDIT_P95_MS=100 OBSERVANDA_WEBSITE_SELECT_P95_MS=250 \
OBSERVANDA_WEBSITE_SAVE_P95_MS=1000 OBSERVANDA_WEBSITE_EXPORT_P95_MS=2000 \
OBSERVANDA_WEBSITE_OVERVIEW_P95_MS=500 OBSERVANDA_WEBSITE_COMPONENT_P95_MS=1500 \
node scripts/test.js --browser test/browser/website-workload.benchmark.spec.js
```

`OBSERVANDA_WEBSITE_SAMPLES` selects 20 to 200 samples per measurement (default 20). The test fails when a measured p95 exceeds its declared budget. No budget is assumed when a variable is missing.

## Proposed budgets

These budgets are proposals for adoption by the release owner. They become release criteria only when they are declared for an agreed machine profile.

| Measurement | Hobby | Team | Lab |
|---|---|---|---|
| Edit p95 | 100 ms | 100 ms | 100 ms |
| Select p95 | 250 ms | 250 ms | 250 ms |
| Save p95 | 1,000 ms | 1,000 ms | 1,500 ms |
| Export p95 | 1,000 ms | 2,000 ms | 6,000 ms |
| Overview p95 | 500 ms | 500 ms | 500 ms |
| Component p95 | — | 1,500 ms | 3,000 ms |

Reviewed deliveries report progress and can be cancelled through the operation progress interface; the measured cancel time shows how quickly a running verification stops.

## Results

Measured on 9 November 2026 with commit series ending in the team review change: Linux x64, two Intel Xeon vCPUs at 2.1 GHz, 8 GB memory, local disk, Node 24.22.1, headless Chromium from Playwright 1.63, in-process service. Values are p50 / p95 / maximum in milliseconds over 20 samples.

| Profile | Edit | Select | Save | Export | Overview | Component | Cancel | Delivery |
|---|---|---|---|---|---|---|---|---|
| Hobby | 49 / 53 / 53 | 81 / 118 / 158 | 295 / 393 / 421 | 148 / 208 / 415 | 28 / 38 / 42 | — | 7 / 14 / 14 | 0.6 s |
| Team | 50 / 53 / 75 | 89 / 103 / 126 | 313 / 411 / 560 | 717 / 842 / 1,006 | 31 / 44 / 53 | 640 / 730 / 764 | 6 / 11 / 17 | 1.7 s |
| Lab | 54 / 83 / 104 | 112 / 189 / 195 | 385 / 693 / 940 | 3,914 / 4,183 / 4,381 | 46 / 86 / 140 | 2,183 / 2,335 / 2,408 | 8 / 26 / 90 | 12.4 s |

Peak renderer heap was 24 MB (hobby), 30 MB (team) and 30 MB (lab). Peak resident memory of the process that hosts the service and the test runner was 551 MB, 556 MB and 598 MB. Opening the editor on the large page took 2.3 s, 2.2 s and 2.5 s.

All proposed budgets hold on this machine. Interaction cost stays nearly flat as the site grows because the outline, page lists and source searches remain windowed and canvas edits update only affected outline rows. Export, component propagation and delivery grow with the number of files and placements; deliveries run as cancellable operations with progress, and component propagation is one saved revision.

## Not yet measured

- Sustained editing while research sources are granted, updated or withdrawn.
- Network storage, Windows and macOS, and the installed desktop application.
- Remote delivery to GitHub or SSH destinations.
- Pages beyond the profiles above; raising any profile is a separate measured change.
