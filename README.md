# Bridge Report

In-house inspection report writer for Bridge Home Inspections — a replacement for HomeGauge.

## Run it (Windows)

1. Install **Node.js LTS** from https://nodejs.org (one time).
2. Double-click **`Start Bridge Report.bat`**. The first run installs what it needs (a few minutes); after that it opens in seconds.

Your data lives in `Documents\BridgeReport Data`:

| Folder | What's in it |
|---|---|
| `Templates\` | Templates (`Larry Template 1.json` is your HomeGauge template, converted) |
| `Reports\<id>\` | One folder per job: `report.json`, the report photos, `originals\` (untouched copies for "Revert") and `report.bak.json` |
| `Library\` | Drawings / CYA illustrations shared across reports |

## What works today

- **Reports list** — search, sort, open, delete (moves to `.deleted`, never erased)
- **Import from HomeGauge** — report folders (`AppData\Local\HomeGauge\Reports\000000xx`), upload `.zip` files, and `.ht5` templates
- **New report** from a template
- **Editor** — section tree with progress, rating grid (IN/NI/NP/RR/X), multiple comments per item, rich text, Summary flag, Find Unanswered
- **Comment picker** — each item's own comments, the whole library by category, search, Insert Itemized / As One, add/edit/reorder/remove comments (saved back to the template)
- **Smart Text** — fills `*DEFECT(...)*`-style blanks from your pick lists, pick several to combine, save new choices to the list
- **Styles & Materials** with quick-add, **Overview** (section intro/footer), **General Info**
- **Components** — exclude sections, add duplicates (Main Roof / Garage Roof…), rename, reorder, add/delete sections, add/rename/delete/reorder items
- **Photos** — pick the job folder, subfolders, hide used, thumbnails, drag onto an item or double-click; photos are resized for the report
- **Photo editor** — arrow, circle, box, line, text, crop, rotate, brightness/contrast, undo, revert to original
- **Drawings / CYA library** — import your HomeGauge `Drawings` folder, add your own
- **Preview & PDF**, including summary only
- Autosave plus a rolling backup

## Not built yet (next phases)

Upload/download to the office (cloud), publish to client/agent with a web link, agreements & e-signature, payments, scheduling, repair request builder, invoices, comment usage counts, multi-photo layouts and cover-page designer, installer (.exe).

## For developers

```
npm install
npm run app        # build + launch
npm run dev        # Vite dev server, then in another terminal: npm run app:dev
```

- `electron/main.js` — window, file storage, image protocols, PDF
- `electron/importer.js` — HomeGauge `.ht5` / `.hr5` → Bridge format
- `src/` — React UI
- `tools/hg_convert.py` — standalone converter + template audit
