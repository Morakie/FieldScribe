# Bridge Report — Handoff / Pick-up-tomorrow notes

_Last updated: 2026-10-18 (code moved to GitHub repo Morakie/FieldScribe with dev/main branches; Merge Report — section A; HG office reference in H-ref)_

Bridge Report is Bridge Home Inspections' in-house replacement for HomeGauge (HG). It's an offline desktop report writer now; a cloud office backend comes later.
The per-menu parity checklist is in **ROADMAP.md**. This file is the full picture: status, how to run it, how it's built, and the to-do list.

---

## 1. Where things stand

**Working today (desktop, offline):**
- **Reports list:** reports can be imported from HG. Sources are a Reports folder, a single report, a .zip or a template. Import has a Newest 10/50/All choice.
- **Start page / New Report:** fills services and inspector from settings.
- **Editor:**
  - tree: Customer / Report Info / Misc / General Info / sections / Summary
  - resizable panels, Back/Next, status bar
  - Go menu finders: unanswered, S&M, flagged, photos
- **Items:**
  - columns: IN/NI/NP/RR, **F** flag, **X** exclude
  - numbered comments with a rich-text editor and a font-color picker
  - comment picker, Smart Text fill (multi-pick chips), summary toggle
- **Styles & Materials:** add, edit, delete, move, ABC sort and exclude.
- **Photos:**
  - drag/drop and folder browser; the photo folder is remembered
  - auto-open the editor on add
  - Edit All Photos queue
  - photo editor: arrows, text, ZO zoom-out callout, shapes, border/fill, rotation, grid, crop
  - markup can be re-edited from the original
  - sizes S/M/L/XL
  - kept at high res, then compressed **once** for upload
- **General Info:** intro, single cover-photo slot, general items.
- **Misc:** Inspector Info, Attachments (appended to the PDF), Invoice (tax, payment method/status/note).
- **Preview + PDF:**
  - HG "Clean Narrative" look: cover, TOC with real page numbers, Results at a Glance, sections, summary, invoice, attachments
  - "Summary only" option
- **Report Fills:** saved starting answers.
- **Merge Report Into This Report** (10/18) — see section A.
- **Spell check:**
  - underline, with right-click suggestions and add to dictionary
  - Spell Check Report list
- **Template tools:** Edit Column Headers, All Comments manager, Save Template As, export/import comments CSV.
- **Contacts:** about 5,850 imported from HG people4.csv, with a manager and CSV export. Export Report Info & Customers.
- **Settings and prefs:** Company Settings (logo), Inspector Profile, Photo Settings, dark/light theme.
- **Utilities:** Display Report Data Sizes, Photo Locker, Open Data Folder.

**Not built yet:** everything still open in section 5 below, and the whole cloud/office side.

---

## 2. How to run it (Tyler's PC)

- **Code now lives in `Documents\GitHub\FieldScribe`** (GitHub: `Morakie/FieldScribe`, private). Double-click **`Start Bridge Report.bat`** in that folder.
  - It refreshes PATH, runs `npm install` only when package.json changed (the first run there takes a few minutes), then builds and launches.
  - The old `Documents\BridgeReport` folder is the pre-git copy; keep it as a fallback until the new folder is confirmed working, then it can be deleted.
- From PowerShell, use `npm.cmd run app`. Plain `npm` is blocked by the execution policy.
- Data lives in **`Documents\BridgeReport Data`** (unchanged, not in git):
  - `Templates\*.json`
  - `Reports\<id>\`: report.json, `backups\`, photos, `originals\`, `attachments\`
  - `Library\` (Drawings/CYA), `Branding\logo.*`, `Fills\`
  - `settings.json`, `contacts.json`
  - `.thumbs\`, `.deleted\` (deleted reports go here, not to the trash)
- The data folder (2.9 GB, 244 reports on 10/18) is still not backed up anywhere — needs OneDrive/external backup until the cloud phase.

## 3. How updates get deployed (for Claude) — git workflow since 10/18

- Repo: `https://github.com/Morakie/FieldScribe` (Claude GitHub App has push access). Branches: **`dev`** (every change lands here first) and **`main`** (only what Tyler has tested). Tyler approved Claude pushing/merging to main.
- **Fresh cloud session:** `add_repo Morakie/FieldScribe` (push), clone it, `npm ci --ignore-scripts && node node_modules/electron/install.js` for testing. Commit as Tyler Perna <Tyler@bridgehomeinspections.com> with the Claude co-author trailer.
1. Commit on `dev`, push to `origin dev`.
2. On the PC (device_bash, Documents folder access + delete permission so git can clear its lock files):
   `cd "$HOME/mnt/Documents/GitHub/FieldScribe" && git fetch -q origin && git checkout -q dev && git merge -q --ff-only origin/dev && git log --oneline -1`
   The PC VM can reach github.com for fetch (no credentials needed — read only). It cannot push; Tyler can push from GitHub Desktop if ever needed.
3. Tyler restarts the app with the .bat to pick up changes. After he confirms, fast-forward `main` to `dev` and push.
4. Don't copy node_modules across the device mount (546 MB of small files times out) — the .bat installs it.

**Testing:** Playwright `_electron` under xvfb-run (`/opt/npm-tools/node_modules/playwright`, pass `executablePath: <app>/node_modules/electron/dist/electron`).
- Scripts: `/tmp/claude-0/e2e/*.js` (e.g. `merge.js`)
- Env vars: `BRIDGE_DATA_DIR=<tmp>` and `LOCALAPPDATA=/tmp/claude-0/e2e/fakelocal`
- Real test reports can be copied read-only from `BridgeReport Data\Reports` (tar on the PC into a scratch folder → device_stage_files).

## 4. How it's built

**Stack:**
- Electron 44 (main process in CommonJS: `electron/main.js`, `preload.js`, `importer.js`, `settings.js`)
- React 19, Vite 7, TypeScript 5.9
- Libraries: @xmldom/xmldom (HG XML), jszip, pdfjs-dist (finds TOC page numbers), pdf-lib (appends attachments)

**Image protocols:**
- `brimg://f/?p=<path>[&m=<px>]` serves a file, optionally downsampled with a cache.
- `brthumb://` serves cached thumbnails.

**HG formats:**
- `.ht5` template: com, st (smart text), cat, ii, sm, secC/sec, colHead, genInfo, sum.
- `.hr5` report: ClientData, ReportInfo, Person, Service, an embedded template, and per-section SecA / SecAI / SecAII (comments + photo labels) / SMA (S&M) / GA.
- `importer.js` converts both into our JSON.

**Report model (`bridge-report/v1`, see `src/types.ts`):**
- a template snapshot
- `sections[]`, each with instances
- each instance holds items and materials:
  - items: ratings[], excluded, flagged, entries[] (each entry has html, summary, photos[])
  - materials: selected[], extraInfo, excluded
- photos: `{file, caption, src, size, edit}` (edit = re-editable markup)
- clients, people, services, invoice, misc, attachments, coverPhoto
- `importedFrom`, `reinspectionOf`, `published`

**Key UI files (`src/components/`):**
- Editor, ItemsView, MaterialsView, PhotoEditor, PhotoPanel
- PreviewModal and `src/preview.ts` (the HTML/PDF layout)
- EditorTools (Fills, Spell, Column Headers, Comments manager, Save Template As)
- MergeModal + `src/merge.ts`
- ReportsList, StartPage, InfoView, MiscView, GeneralInfoView, ContactsManager

**Security note:**
- HG's `Settings.xml` holds a stored HomeGauge password (SHGIPassword). It is never read or copied. Only inspector tags are read.
- The HG license key is not stored anywhere in Bridge Report.

---

## 5. TO-DO list

### A. Report merging & reassigning — DONE 10/18
- [x] **File → Merge Report Into This Report…** (also under the Report menu). Open the report to merge INTO, then pick the other one. Code: `src/merge.ts` (pure logic), `src/components/MergeModal.tsx`, IPC `mergeFiles` in `electron/main.js`.
  - Step 1 picker: search all reports; reports at the **same address** are listed first with a badge.
  - Step 2 review: per-section checkboxes (multi-inspector: tick only the sections you want), expandable per-item detail (new item, ratings added, comments, photos, "already here", "on summary"), counts of sections that already match / are empty, warnings.
  - Sections match by name (group + name, then name; "Pool & Spa" = "Pool / Spa"). Unmatched sections are added after the last section of the same group. Repeat instances match by name; extra ones are added.
  - Items match by id then title; new items get their template def copied in (id gets `-m1` if the id means something else in this template); every instance stays aligned with `itemIds`.
  - Ratings are combined (orange badge when this report already had a different rating). Flags OR'd. Comments with the same text aren't duplicated (their photos and summary tick still carry over). Empty placeholder entries are replaced.
  - S&M selections combined, Extra Info appended if different. General Info text kept unless empty or "Replace" is ticked. Cover photo only if this report has none. Attachments copied by name.
  - Template-default section intro/closing text does **not** count as findings; an excluded section only comes back if something is actually added to it.
  - Office info (customer & agents / services, price & invoice / date, time & address) is **off by default**. That covers the reassign case: the office's prefilled report keeps its own.
  - Photos are copied under new names (both reports start at i1). A photo that's **byte-for-byte already in this report is not copied again** (SHA-1). The preview uses a dry run of the same check, so its counts are right.
  - A forced backup of this report is made right before merging (undo via gear → Open Backup). Optional "move the other report to Deleted afterwards".
- Tested end to end on copies of real reports (Calico Ridge + a blank 10/17 report + a "second inspector" copy): 1 new comment + 1 photo copied, 40 duplicates skipped; the blank report added only its 2 photos and no sections were wrongly re-included.
- Possible follow-ups: "Merge into…" from the reports-list gear menu without opening; show which inspector each merged section came from.

### B. Reports list (Open Report screen, HG style) — DONE 10/17
- [x] Columns: Date, Name1, Address, City, Zip, Report ID, Agent, Published, Paid, Reinspection; sorting; search by column with Match case; details pane + cover photo; multi-select (Ctrl/Shift), arrow keys, Enter, Delete key.
- [x] Refresh Database (rebuilds every index.json; the list also upgrades old index files on its own).
- [x] Gear menu: Create Reinspection (keeps summary + RR items with their summary comments and photos, ratings cleared, everything else excluded, number ends in -R, links to original, services/pay status reset), Create a Copy (-Copy), Open Backup (restore & open; current version is backed up first), Open Report Folder, Delete Selected Report(s) → `.deleted`.
- [x] Backups: `Reports\<id>\backups\report-YYYYMMDD-HHMMSS.json`, at most one per 5 min, last 10 kept. Old `report.bak.json` still listed. (Settings page for N/interval is still in E.)
- Paid = invoice pay status contains "paid" (not unpaid/partial/due). Published = `report.published` (set in the cloud phase). Reinspection = `reinspectionOf` or Report ID ending in -R.
- Launch fix: single-instance lock (a second launch focuses the open window), Chromium cache moved to `%LOCALAPPDATA%\BridgeReport\Session`, GPU shader disk cache off. These caused the "Unable to move the cache: Access is denied" lines.

### B2. Start page & fixes — DONE 10/17 (afternoon)
- [x] **Start page** (HG style), shown at launch and by File → Start Page / New Report: left side Customer, Report Info, Misc, Select Report Template; center shows recent reports. What's typed is kept as a draft (localStorage) until a template is picked; `createFromDraft` builds the report from the template and keeps the draft's customer/info/misc/attachments (same id).
- [x] Select Report Template lists Bridge templates and the **HomeGauge templates found in AppData\Local\HomeGauge\Templates**, with Import / Re-import / Import all new. `T.source` records where a template came from.
- [x] File → Import HomeGauge Settings (prices, pay lists, inspector name/license) re-reads them from HG. They were already seeded on first run.
- [x] General Info: **✨ Comments** button opens the comment picker on the template's General Information list (or the whole library), with Smart Text fill.
- [x] Fix: new reports only auto-insert General Info comments marked auto in HG (was inserting all 12).
- [x] Window size/position/maximized remembered in `BridgeReport Data\.window.json` (falls back if the monitor is gone).
- File → Open Report (Ctrl+O) goes to the reports list; the list has ← Start Page. The old New Report dialog is gone.

### C. Preview options — web view reference received 10/18 (NEXT)
- [ ] Preview as a **PDF view** or an **online (web) view**. The online view becomes the published client page in the cloud phase.
- Reference: Tyler's screenshots of HG's web report (`homegauge.com/report/<id>/FullReportForUploadorPrintWithPictures.html`, Huckleberry Oak / King) plus the matching PDFs (King 35 pp, Neidlinger 43 pp). What the web view has that the PDF doesn't:
  - **Top bar:** Back · company name centered · Reports · Email · PDF (download).
  - **Clickable TOC:** each entry is a full-width grey bar with a ›, jumps to the section; hover lightens the bar. No page numbers.
  - **"Table of Contents" side tab** pinned to the left edge (vertical text) that opens the index from anywhere while scrolling.
  - **Results at a Glance cards** (Items Inspected / Summary Comments / Videos / Photos) are interactive (hover highlight); likely jump/filter to those items.
  - **Photos:** rounded cards with a 🔍 zoom badge; click opens a large view (lightbox). Grid is 3 across.
  - **Videos play online.** The PDF shows a "Video available online only" placeholder instead.
  - Same content order as the PDF: cover, intro/report info box, glance, sections (Description, Styles & Materials, Items with rating label + numbered comments, green house icon on summary comments, section closing italic text), invoice.
- Build plan: reuse `src/preview.ts` content with a `mode: 'web'` (no page breaks/headers/footers, sticky TOC tab, lightbox JS, anchor links). Export as one self-contained .html (photos embedded) for now; becomes the hosted page in phase H. Videos depend on video support (not built yet).

### D. Quality checks before finishing — Options → Navigation
- [ ] Skip excluded sections on Back/Next.
- [ ] "Find Unanswered" also checks (each one on/off):
  - cover page picture missing
  - an excluded item that still has content
  - flagged items
  - picture placeholders
  - `*Smart Text*` not replaced
  - spreadsheet values not replaced
  - empty itemized items
  - voice recordings not marked done
  - missing S&M Extra Info
  - **missing photo labels**
  - **sections or items with no text**
- [ ] Edit All Photos includes Form photos (option).
- [ ] A **Finish check** report: one list of every problem above, plus spelling, before publishing.

### E. Options screens to build (from HG screenshots)
**General Options**
- [ ] Update Welcome Page
- [ ] Allow editing while the publishing preview is open
- [ ] Double-click to exclude ignores populated items
- [ ] Allow text wrap for item names
- [ ] Display backup reminders
- [ ] Auto-copy included photos to Photo Locker
- [ ] Include Photo Locker in cloud transfers
- [ ] Use FLIR editor for IR images
- [ ] Prompt before erasing itemized items
- [ ] Preferred video quality (240p)

**Autosave & Backups**
- [ ] Autosave the open report: on/off and every N minutes (HG default 15). We currently save on every change.
- [ ] Keep N backup copies of the report (HG default 10). We keep 10, at most one per 5 min — make these settings.

**Comments Options**
- [ ] Add a paragraph when comment(s) are inserted
- [ ] Prompt for category on comment quick-add
- [ ] Prompt before erasing comments
- [ ] Check for `*SmartText*` on template open / auto-fill
- [ ] Itemize multiple comments during report start and merge
- [ ] Double-click to insert a comment inserts itemized
- [ ] Comments that auto-include images use the description as the caption
- [ ] Ctrl+A shortcut for Autocomment selection
- [ ] Collapse to the last category in the Local list category filter

**Text Size Options**
- [ ] On-screen text size (+/−) for comment editors, with a sample text box
- [ ] Separate on-screen size (+/−) for lists such as Styles & Materials
- Both affect the screen only, not the PDF.

**Spell Check Options**
- [ ] Turn off interactive (as-you-type) checking
- [ ] Filters: ignore UPPERCASE, ignore URLs, ignore words with numbers, fix DOuble CApitals
- [ ] Language: English, or English + Spanish
- [ ] Edit the user dictionary; edit the auto-replace list (e.g. "teh" → "the")

**Form Options** (only if we do Forms)
- [ ] Up to 2 logo "form signatures", picked from the company logos
- [ ] Secure PDF forms (locked) vs fillable forms

**Picture Edit Defaults** (extend Options → Photo Settings)
- [ ] Default display width per use: Finding = Large, Cover = X-Large, Overview = Large
- [ ] Pixel widths: S 200, M 320, L 400, XL 500
- [ ] Actual sizes: normal picture 640, cover 1280, Photo Locker 2048
- [ ] Default arrow style: line color, border width, fill on/off, fill color, arrow length
- [ ] The same kind of defaults for text, ZO, boxes and circles

**Inspector & License**
- [x] Inspector name, company, contact lines and state license already exist in Inspector Profile.
- [ ] Add **Radon, Pest and Other license** fields so they print on the report.
- No license key is needed: Bridge Report is ours.

**Other Options pages**
- [ ] Cities / States / Zip Codes autocomplete lists
- [ ] Map options
- [ ] Advanced Folder Options (move the data folder)
- [ ] Estimates

### F. Photos
- [ ] **FLIR infrared photos.**
  - Step 1 (easy): show and mark up FLIR JPEGs like normal photos. They are normal JPEGs on the outside.
  - Step 2 (harder): read the hidden thermal data in the FLIR file to show spot temperatures, min/max, and a palette change.
  - This is doable but it's its own project. Tyler can send a couple of sample IR photos when ready.
- [ ] Photo Locker options: auto-copy included photos, and include it in cloud transfers.
- [ ] **Videos** in reports (HG reports show "Video available online only" in the PDF and play them on the web page).

### G. Earlier to-dos still open (from ROADMAP.md)
- [ ] Edit All Comments From Start / Current (Go menu)
- [ ] Replace All Smart Text (step through every unfilled `*SMART*`)
- [ ] Template managers: All Smart Text, All Connectors, All Attachments, Estimate List, Template Options
- [ ] **Edit Report Docs:**
  - cover page and agreements (e.g. the 4-Point agreement) with merge fields like `*client.fullnames*`
  - import HG's html5 agreement files
- [ ] Office: Report Stats; Business Report (revenue by inspector, agent and lead source)
- [ ] Toolbars / customize
- [ ] Contacts: find and merge duplicates
- [ ] Voice notes (would enable "Find Voice Recording")
- [ ] Backup / Restore user settings (locally)

### H. Cloud / office phase (the HG Services menu)
- [ ] Inspector logins
- [ ] Send Report To Cloud / Get Report From Cloud: the upload list, where each upload makes a new entry
- [ ] Publish with Preview First: web link for client and agent, with Allow / Sent / Viewed status
- [ ] Online agreements with e-signature; Stripe payments (Published / Paid columns)
- [ ] Online scheduling (view and download appointments)
- [ ] Template and settings sync for all 10–12 inspectors
- [ ] Office dashboard
- [ ] Auto-update for inspectors (Check For Updates)
- **Proposed stack:** Supabase (database, logins, photo storage) + Vercel (website) + Stripe. About $25–75/month.

#### H-ref. HG web office reference — screenshots received 10/18
Source: "HomeGauge ONE — Inspector Dashboard" (`homegauge.com/inspector/shgi/index.html`), logged in as the company owner account. Screens seen: All Reports, Payment Status, Edit Report Emails, Calendar (week), New Appointment.

**Left nav (full menu):**
- Reports → All Reports, Agreement Status, Payment Status, TRM, Cloud Transfers, Other PDF Uploads, Edit Report Emails, Upload / Email Options
- Classic Scheduler (old; skip)
- Appointments → Calendar, Unscheduled, New Appointment, Search, Calendar Sharing, Inspector Settings, Company Settings, ScheduleNow Settings (public booking), Inspection Services, Notification Templates, Agreement Templates
- Business Insights, Contacts, HomeGauge Payments, HomeGauge Protect, More Tools, Website, Settings
- Top bar: logged-in user + company, account menu.

**All Reports:**
- Paged list (~44,800 reports total), filter by **User** (inspector) dropdown, **Hide Inactive**, Expanded/Collapse view.
- Report card header: **Report ID** = `YYYYMMDD-<house#>-<Street-Name>` (e.g. 20261016-12571-Huckleberry-Oak-Ave), "1 of N".
- Card body: cover photo thumbnail, full address; **Send Emails:** Inspection Report / Agreement links; status badges ✔ **Agreement Signed** | ✔ **Paid $475.00**; Manage TRM; Restore Deleted Documents; BuildFax Report (permits) button.
- Then one block **per document**: Inspection Agreement NV, Inspection Report, Inspection Summary.
  - Each: icon, title, upload timestamp, **History**, **View Document**; the report also has **CRL** (repair request list).
  - Tabs: Overview / Manage ▾ / Viewing ▾. Buttons: +User, −User, Edit.
  - Recipient rows (customer icon vs agent icon, name, username link) with **Allow / Sent / Viewed** check columns. Not-yet-viewed shows a red **[?]** cell.
- Right panel "Report Tools": New Appointment, calendar button with count, stats **Past 7 / Past 30 / YTD / Reports Displayed**, Search by Address / City / Zip, More Search Options.

**Payment Status:**
- Date range picker + Filter Invoices, **Exclude Paid** checkbox.
- Line like "238 invoices over 30 days"; big totals **Paid (count): $** and **Unpaid (count): $**.
- Sortable table: Paid? (✔ / red ✖), Address (link to report), Amount, **Pay to View** (✔), Created, Inspection Date, Customer.

**Edit Report Emails (email templates):**
- "Templates for" dropdown (e.g. Report Notification for Customer/Seller — sent when the report is ready); pick an existing template or Start New.
- Template Name, Subject (with codes), rich-text Message editor (fonts, colors, links, tables, Source view), **Use as Default Message**, Save Template / Delete.
- Merge codes use `${...}`: report address `${RPT_ADDRESS} ${RPT_CITY} ${RPT_STATE} ${RPT_ZIP} ${RPT_COUNTY} ${RPT_MLS}`; inspector `${INSP_MEMBERNAME} ${INSP_NAME} ${INSP_ADDRESS} ${INSP_CITY}…`; recipient `${RECIP_FNAME}`; login `${MEMBERNAME} ${PASSWORD}` (body only).
- Default buyer message: report is uploaded → sign in with username/password → must **e-sign the agreement and pay before the report is viewable**.

**Calendar:**
- Day / Week / Month, date picker, Today, ◀ ▶; "Switch to Daily View"; New Appointment; Help. Grid ~7 AM–6 PM, today column highlighted.
- Appointment blocks colored **per inspector**: time range, inspector name, address. Icons for status.
- Inspector selector (All Inspectors / one) with **Appointment Color** and **Text Color**, Reset to Default.
- Legend: Pending, Requested, Public Request (from online booking), Time Off.

**New Appointment form** (sections, with a right-side jump menu: Date & Time, Location, Details, Services, Agreements, Inspectors, Customers, REPs, Actions):
- **Date and Time:** date, start–end time, **Set as Time Off**, auto-update end time from the services' durations.
- **Property Location:** Address 1/2, City, State (default NV), ZIP, County, Country (US), Directions, Driving Distance.
- **Appointment Details:** Report ID (**auto-generate from date + address if blank**), Referral (lead source dropdown), Inspector Comments, Pet Instructions, Year Built, Square Footage, Bedrooms, Full Baths, Half Baths, Occupied/Vacant, MLS #, Utilities on (Water/Electricity/Gas), Who will be present (Buyer, Buyer Agent, Seller, Seller Agent, Owner), Custom Fields.
- **Services:** Add/Update Services; Request Payment, **Require Payment to View Documents**, Allow REP to Pay for Inspection.
- **Agreements:** Available → Selected dual list (Commercial Building, Inspection Agreement NV / UT, Manufactured Home, Meth Testing, …).
- **Inspectors:** Available → Selected dual list (more than one allowed).
- **Customers:** search existing or Add Customer Account; columns Name, Email, Customer is, Remove.
- **Real Estate Professionals:** search or Add REP Account; Name, Email, Represents, Remove.
- Actions: **Schedule Appointment** / Save Changes Only / Cancel.

**What this means for our design (draft):**
- Tables: `appointments` (date/time, location, details, flags, status pending/requested/public/time-off), `appointment_inspectors`, `appointment_contacts` (role: customer / buyer agent / seller agent…), `services` (with duration + price), `agreement_templates` / `agreements` (signed at), `invoices` (amount, paid, pay-to-view), `documents` per report (agreement / report / summary / other PDF), `document_recipients` (allow, sent_at, viewed_at), `email_templates` (type, subject, html, is_default), `inspectors` (color, text color).
- The appointment is the parent; the desktop app "Get Report From Cloud" pulls a prefilled report (customer, agent, services, price) from it — Merge (A) then moves an inspector's findings into it.
- Gate: client can view the report only after agreement signed + paid (when "Require Payment to View" is on).
- Our Report ID can use the same `YYYYMMDD-<house#>-<Street>` format so IDs match HG history.
- Still not seen: Agreement Status, TRM, Cloud Transfers, Other PDF Uploads, Upload/Email Options, Unscheduled, ScheduleNow (public booking page), Inspection Services, Notification Templates, Agreement Templates, Business Insights, Contacts (web), Settings.

---

## 6. Open questions for Tyler
1. Still useful screenshots: Agreement Status, ScheduleNow / public booking, Agreement Templates, Inspection Services, Business Insights, TRM.
2. Do you already have a **Stripe** account, or something else for payments? (HG currently takes payments through HomeGauge Payments.)
3. A higher-res **logo PNG** (1000px+ wide) for crisp PDFs.
4. Do you use **Radon Tests** or **Forms** in HG? If not, we skip them.
5. What does the HG **Overlay** feature do for you?
6. ~~GitHub repo~~ — done 10/18 (`Morakie/FieldScribe`). Still open: a backup plan for `BridgeReport Data`, and confirm the repo is **Private**.
7. When ready: a couple of **FLIR IR sample photos**.
8. Which HG web extras does the office use, and how often: **TRM / CRL**, **HomeGauge Protect**, **BuildFax**, public **ScheduleNow** booking? (Tyler is asking the office.)

## 7. Suggested order for next session
1. ~~Reports list upgrade~~, ~~Create Reinspection~~ (10/17), ~~Merge Report~~ (10/18) — done.
2. ~~Folder move + GitHub repo~~ — done 10/18.
3. **Web view** of the report (section C) — reference material in hand.
4. Finish check (unanswered options, missing labels, missing text) + spell check options.
5. The Options screens (General, Autosave, Comments, Text Size, Picture Defaults).
6. Then start the cloud phase — office reference in section H-ref.
