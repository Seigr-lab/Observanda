# Candidate release qualification

Packages produced by the build are candidates. A successful build or source suite does not qualify an installed release. Windows x64 and Ubuntu x64 are the current qualification targets; macOS is deferred.

Before declaring a candidate qualified, run:

```sh
npm run qualify:release -- <installer> <evidence.json> <payload.json>
```

The verifier hashes the actual installer, payload manifest and every retained report. Results must name the same candidate hash, payload hash and source commit. Missing, failed, skipped, duplicated, stale or mismatched requirements fail the command. Reports must remain inside the evidence directory. Do not put private workspace data, credentials, personal paths or diagnostics in public release evidence.

The requirements, responsible component roles and expected procedures are exported as `releaseRequirements` from `scripts/release-contract.js`. They cover correctness, scientific integrity, capacity, dependency/security review, parser boundaries, storage recovery, backup restoration, artifact integrity, installation, licenses/provenance and usability. Network storage and live hosting add requirements when included in the declared profile. A profile restriction must also appear in release notes and support documentation; it cannot be used to hide a failing required workflow.

Evidence format 1 has `candidate`, `profile` and `results` objects. The candidate records version, full commit, platform (`win32` or `linux`), architecture (`x64`), installer `sha256` and `payloadSha256`. The profile declares platform, hardware, storage configuration, concurrency, limitations, `storage` (`local` or `network`), `liveHosting`, and `limits.powerLossQualified: false`. No current platform has completed power-loss qualification.

Each result records `requirement`, `result: pass`, candidate/payload hashes, commit, owner, reproducible procedure, fixture identity, environment, elapsed milliseconds, UTC completion time, limitations and reports with relative filenames and SHA-256 hashes. Results expire after seven days and cannot be future-dated. Refresh advisory reviews and affected acceptance after a candidate change; never relabel old results with a new hash.

The `foreground-capacity` result also records measurements for `startup`, `record-save`, `record-reopen` and `website-preview`. Each has raw `elapsedMs` samples and explicitly declared `p95BudgetMs` and `p99BudgetMs`. The verifier computes nearest-rank percentiles and rejects exceeded budgets. It requires at least 20 samples, reports no confidence interval, and does not invent universal latency targets. Select targets for the declared hardware/storage/concurrency profile, retain observed competing load, and use more samples for meaningful tail characterization.

This command verifies evidence completeness and binding. It does not make a receipt true, perform the acceptance procedures, authenticate a publisher, or certify a third-party standard. Release reviewers must inspect the reports and their provenance. Artifact-integrity evidence must include independent publisher/signature and hardening verification; a claimed `pass` is not a substitute for that procedure. There is no exception mechanism for unresolved mandatory gates. Unqualified packages remain alpha or explicitly restricted candidates.
