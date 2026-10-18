#!/usr/bin/env python3
"""
HomeGauge -> open JSON converter.

Reads HomeGauge template files (.ht5) and report files (.hr5) and writes
clean, self-describing JSON that a new report-writing app can load directly.
Also produces an audit of the template (duplicates, broken links, unused
content, machine-specific file paths).

Usage:
  python hg_convert.py template <file.ht5> <out_dir>
  python hg_convert.py report   <report.hr5> <out_dir>   (photos stay beside report.hr5)
"""
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from difflib import SequenceMatcher

SMART_RE = re.compile(r"\*([A-Z]+)\(([^)]*)\)\*")


# ---------- helpers ----------
def txt(el, tag, default=""):
    e = el.find(tag)
    return (e.text or "") if e is not None and e.text is not None else default


def unescape_html(s):
    """HomeGauge stores rich text as escaped HTML, sometimes escaped twice."""
    prev = None
    while s and prev != s and ("&lt;" in s or "&amp;" in s):
        prev, s = s, html.unescape(s)
    return s


def html_to_text(s):
    s = unescape_html(s or "")
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" ?\n ?", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def bits(s):
    return [x.strip() == "1" for x in (s or "").split(",")] if s else []


def columns_from(parent, tag):
    cols = []
    for c in parent.findall(tag):
        cols.append({
            "short": txt(c, "colsName"),
            "label": txt(c, "collName"),
            "sendsToSummary": txt(c, "colsendToSum") == "1",
            "removesFromSummary": txt(c, "colundoSum") == "1",
            "isExclude": txt(c, "colex") == "1",
            "visible": txt(c, "colshow", "1") == "1",
            "color": txt(c, "colcolor") or None,
        })
    return cols


# ---------- template ----------
def parse_template(t):
    """t = <template> element (root of .ht5, or embedded in a .hr5)."""
    smart = {}
    for st in t.findall("st"):
        smart[txt(st, "stKey")] = [v.text or "" for v in st.findall("stVal")]

    comments = {}
    for c in t.findall("com"):
        raw = txt(c, "comText")
        comments[c.get("id")] = {
            "id": c.get("id"),
            "name": txt(c, "comName"),
            "html": unescape_html(raw),
            "text": html_to_text(raw),
            "smartFields": sorted({f"{k}({v})" for k, v in SMART_RE.findall(html_to_text(raw))}),
            "autoInsert": txt(c, "comAuto") == "1",
            "defaultPhotos": [{"path": txt(p, "atFN"), "caption": txt(p, "atDesc")} for p in c.findall("comDefPic")],
            "defaultAttachments": [{"path": txt(p, "atFN"), "caption": txt(p, "atDesc")} for p in c.findall("comDefAt")],
            "updated": txt(c, "comTS"),
        }

    def cat_tree(el):
        return {
            "name": txt(el, "catName"),
            "commentIds": [x.text for x in el.findall("catCID")],
            "children": [cat_tree(ch) for ch in el.findall("cat")],
        }

    items = {}
    for ii in t.findall("ii"):
        items[ii.get("id")] = {
            "id": ii.get("id"),
            "title": txt(ii, "iiText"),
            "helpHtml": unescape_html(txt(ii, "iiHelp")),
            "commentIds": [x.text for x in ii.findall("iiCID")],
            "excludedByDefault": txt(ii, "iiEx") == "1",
            "hidden": txt(ii, "iiHide") == "1",
        }

    materials = {}
    for sm in t.findall("sm"):
        materials[sm.get("id")] = {
            "id": sm.get("id"),
            "name": txt(sm, "smName"),
            "options": [txt(o, "smVal") for o in sm.findall("smOpt")],
            "extraInfoLabel": txt(sm, "smInfoName") or None,
            "linkedItemId": txt(sm, "smIIID") or None,
            "excludedByDefault": txt(sm, "smEx") == "1",
        }

    groups = []
    for g in t.findall("secC"):
        secs = []
        for s in g.findall("sec"):
            secs.append({
                "name": s.get("name"),
                "excludedByDefault": txt(s, "secEx") == "1",
                "repeatable": txt(s, "secRe") == "1",
                "repeatNames": [x.text for x in s.findall("secReName")],
                "introCommentIds": [x.text for x in s.findall("secIntroID")],
                "footerCommentIds": [x.text for x in s.findall("secFooterID")],
                "itemIds": [x.text for x in s.findall("secIIID")],
                "materialIds": [x.text for x in s.findall("iiSMID")],
                "ratingColumns": columns_from(s, "colHeadOR") or None,
                "singleRatingOnly": txt(s, "colsingleSelection") == "1",
            })
        groups.append({"name": g.get("name"), "sections": secs})

    gen = t.find("genInfo")
    summaries = []
    for s in t.iter("sum"):
        summaries.append({
            "id": s.get("id"), "name": txt(s, "sumName"), "abbrev": txt(s, "sumAbbrev"),
            "introCommentId": txt(s, "sumICID") or None, "footerCommentId": txt(s, "sumFCID") or None,
        })
    pic_labels = t.find(".//picLabelInfo")

    return {
        "format": "inspection-template/v1",
        "source": "HomeGauge",
        "meta": {
            "createdBy": txt(t, "tCreatedBy"), "lastModifiedBy": txt(t, "tLastModBy"),
            "lastModified": txt(t, "tLastMod"), "descriptionHtml": unescape_html(txt(t, "tDesc")),
        },
        "ratingColumns": columns_from(t, "colHead"),
        "costRanges": [e.text for e in t.findall("tEst")],
        "connectorWords": [c.text for c in t.findall("cons/con")],
        "smartFields": smart,
        "comments": comments,
        "commentLibrary": [cat_tree(c) for c in t.findall("cat")],
        "items": items,
        "materials": materials,
        "sectionGroups": groups,
        "generalInfo": {
            "commentIds": [x.text for x in gen.findall("genCID")] if gen is not None else [],
            "materialIds": [x.text for x in gen.findall("genSMID")] if gen is not None else [],
        },
        "photoCaptionCommentIds": [x.text for x in pic_labels.findall("picLID")] if pic_labels is not None else [],
        "summaries": summaries,
    }


# ---------- audit ----------
def audit_template(T):
    C, I, M = T["comments"], T["items"], T["materials"]
    issues = defaultdict(list)

    def walk_cats(nodes, path=""):
        for n in nodes:
            p = f"{path} > {n['name']}" if path else n["name"]
            yield p, n
            yield from walk_cats(n["children"], p)

    cat_refs = set()
    for p, n in walk_cats(T["commentLibrary"]):
        for cid in n["commentIds"]:
            cat_refs.add(cid)
            if cid not in C:
                issues["broken_comment_refs"].append(f"Library folder '{p}' → missing comment {cid}")
    item_refs = set()
    for it in I.values():
        for cid in it["commentIds"]:
            item_refs.add(cid)
            if cid not in C:
                issues["broken_comment_refs"].append(f"Item '{it['title']}' → missing comment {cid}")
    used_items, used_mats = set(), set()
    sec_refs = set()
    for g in T["sectionGroups"]:
        for s in g["sections"]:
            for cid in s["introCommentIds"] + s["footerCommentIds"]:
                sec_refs.add(cid)
                if cid not in C:
                    issues["broken_comment_refs"].append(f"Section '{s['name']}' intro/footer → missing comment {cid}")
            for iid in s["itemIds"]:
                used_items.add(iid)
                if iid not in I:
                    issues["broken_item_refs"].append(f"Section '{s['name']}' → missing item {iid}")
            for mid in s["materialIds"]:
                used_mats.add(mid)
                if mid not in M:
                    issues["broken_material_refs"].append(f"Section '{s['name']}' → missing material list {mid}")
    other = set(T["generalInfo"]["commentIds"]) | set(T["photoCaptionCommentIds"])
    for s in T["summaries"]:
        other |= {s["introCommentId"], s["footerCommentId"]}
    used_mats |= set(T["generalInfo"]["materialIds"])

    # smart field keys that comments use but have no pick list
    for c in C.values():
        for f in c["smartFields"]:
            if f not in T["smartFields"]:
                issues["missing_smart_lists"].append(f"'{c['name']}' uses *{f}* (no pick list defined)")
    for k, v in T["smartFields"].items():
        if not v:
            issues["empty_smart_lists"].append(k)

    orphan = [c for cid, c in C.items() if cid not in cat_refs | item_refs | sec_refs | other]
    issues["comments_not_in_library_or_item"] = [f"{c['name'] or '(no name)'}: {c['text'][:90]}" for c in orphan]
    issues["items_not_in_any_section"] = [it["title"] for iid, it in I.items() if iid not in used_items]
    issues["material_lists_not_used"] = [m["name"] for mid, m in M.items() if mid not in used_mats]

    for c in C.values():
        for p in c["defaultPhotos"] + c["defaultAttachments"]:
            if re.match(r"^[A-Za-z]:\\", p["path"]):
                issues["machine_specific_paths"].append(f"Comment '{c['name']}' → {p['path']}")

    by_title = defaultdict(list)
    for it in I.values():
        by_title[it["title"].strip().upper()].append(it)
    issues["duplicate_item_titles"] = [f"{t} (×{len(v)})" for t, v in by_title.items() if len(v) > 1]

    # exact + near-duplicate comment text
    norm = {}
    for c in C.values():
        k = re.sub(r"\W+", " ", c["text"].lower()).strip()
        if k:
            norm.setdefault(k, []).append(c)
    issues["exact_duplicate_comments"] = [
        f"×{len(v)}: {v[0]['text'][:100]}" for v in norm.values() if len(v) > 1]
    keys = sorted(norm)
    near = []
    for i, a in enumerate(keys):
        for b in keys[i + 1:i + 40]:  # neighbours in sorted order catch most near-dupes cheaply
            if abs(len(a) - len(b)) < 0.15 * max(len(a), len(b)) and len(a) > 40:
                r = SequenceMatcher(None, a, b).ratio()
                if r > 0.92:
                    near.append(f"{r:.0%} alike:\n      A: {norm[a][0]['text'][:110]}\n      B: {norm[b][0]['text'][:110]}")
    issues["near_duplicate_comments"] = near
    return issues


def write_audit(T, issues, path):
    C, I = T["comments"], T["items"]
    n_secs = sum(len(g["sections"]) for g in T["sectionGroups"])
    lines = ["# Template audit", "",
             f"- Section groups: {', '.join(g['name'] for g in T['sectionGroups'])}",
             f"- Sections: {n_secs}",
             f"- Inspection items: {len(I)}",
             f"- Comments: {len(C)}  (with smart fill-ins: {sum(1 for c in C.values() if c['smartFields'])})",
             f"- Smart fill-in pick lists: {len(T['smartFields'])}  ({sum(len(v) for v in T['smartFields'].values())} choices)",
             f"- Styles & Materials lists: {len(T['materials'])}",
             f"- Rating columns: {', '.join(c['short'] for c in T['ratingColumns'])}",
             "", "## Section layout", ""]
    for g in T["sectionGroups"]:
        lines.append(f"**{g['name']}**")
        for s in g["sections"]:
            flags = []
            if s["excludedByDefault"]: flags.append("excluded by default")
            if s["repeatNames"]: flags.append("repeats as: " + ", ".join(s["repeatNames"]))
            if s["ratingColumns"]: flags.append("own columns: " + "/".join(c["short"] for c in s["ratingColumns"]))
            lines.append(f"- {s['name']} — {len(s['itemIds'])} items, {len(s['materialIds'])} S&M lists"
                         + (f" ({'; '.join(flags)})" if flags else ""))
        lines.append("")
    titles = {
        "broken_comment_refs": "Broken links to comments that no longer exist",
        "broken_item_refs": "Sections pointing to missing items",
        "broken_material_refs": "Sections pointing to missing S&M lists",
        "missing_smart_lists": "Smart fill-ins used in comments with no pick list",
        "empty_smart_lists": "Smart fill-in pick lists with no choices",
        "machine_specific_paths": "Default photos stored as paths on one laptop (need bundling)",
        "duplicate_item_titles": "Inspection items with the same title",
        "exact_duplicate_comments": "Comments with identical text",
        "near_duplicate_comments": "Comments that are nearly identical (>92% alike)",
        "items_not_in_any_section": "Inspection items not used by any section",
        "material_lists_not_used": "S&M lists not used by any section",
        "comments_not_in_library_or_item": "Comments not filed in any library folder, item or section",
    }
    lines += ["## Cleanup findings", ""]
    for k, t in titles.items():
        v = issues.get(k, [])
        lines.append(f"### {t} — {len(v)}")
        for x in v[:60]:
            lines.append(f"- {x}")
        if len(v) > 60:
            lines.append(f"- … and {len(v) - 60} more (full list in audit.json)")
        lines.append("")
    open(path, "w", encoding="utf-8").write("\n".join(lines))


# ---------- report ----------
def parse_report(r):
    tpl_el = r.find("template")
    T = parse_template(tpl_el)
    C, I, M = T["comments"], T["items"], T["materials"]

    def props(el):
        return {p.get("name"): p.text or "" for p in el.findall("prop")} if el is not None else {}

    clients = [props(c) for c in r.findall("ClientData")]
    clients = [c for c in clients if len(c) > 1]
    ri = r.find("ReportInfo")
    info = props(ri)
    people = [{k[1:] if k.startswith("P") else k: (e.text or "") for e in p for k in [e.tag]}
              for p in ri.findall("Person")]
    services = [{
        "name": html.unescape(txt(s, "SName")), "selected": txt(s, "SOn") == "1",
        "priceCents": int(txt(s, "SPrice", "0") or 0), "qty": int(txt(s, "SNum", "1") or 1),
        "taxable": txt(s, "STax") == "1",
    } for s in ri.findall("Service")]

    sections = []
    for g_el in tpl_el.findall("secC"):
        for s_el in g_el.findall("sec"):
            item_ids = [x.text for x in s_el.findall("secIIID")]
            mat_ids = [x.text for x in s_el.findall("iiSMID")]
            cols = columns_from(s_el, "colHeadOR") or T["ratingColumns"]
            sa = s_el.find("SecA")
            out = {"group": g_el.get("name"), "name": s_el.get("name"),
                   "excluded": sa is not None and txt(sa, "SecAEx") == "1", "instances": []}
            for rep in (sa.findall("SecARepeat") if sa is not None else []):
                inst = {"name": txt(rep, "SecAName"),
                        "introHtml": unescape_html(txt(rep, "SecAIntro")),
                        "footerHtml": unescape_html(txt(rep, "SecAF")),
                        "items": [], "materials": []}
                for idx, ai in enumerate(rep.findall("SecAI")):
                    iid = item_ids[idx] if idx < len(item_ids) else None
                    flags = bits(txt(ai, "SecAIXs"))
                    entries = []
                    for e in ai.findall("SecAII"):
                        raw = txt(e, "SecAITxt")
                        entries.append({
                            "html": unescape_html(raw), "text": html_to_text(raw),
                            "summaryIds": [x.text for x in e.findall("SecAISum")],
                            "photos": [{"file": p.text, "caption": (p.get("label") or "").strip(),
                                        "taken": p.get("date"), "originalName": p.get("orig")}
                                       for p in e.findall("SecAIPic")],
                        })
                    inst["items"].append({
                        "itemId": iid,
                        "title": I.get(iid, {}).get("title", "?"),
                        "ratings": [cols[i]["short"] for i, on in enumerate(flags) if on and i < len(cols)],
                        "excluded": txt(ai, "SecAIREx") == "1",
                        "entries": [e for e in entries if e["text"] or e["photos"]],
                    })
                for idx, ma in enumerate(rep.findall("SMA")):
                    mid = mat_ids[idx] if idx < len(mat_ids) else None
                    m = M.get(mid, {"name": "?", "options": []})
                    sel = bits(txt(ma, "SMAXs"))
                    custom = [v.strip() for v in txt(ma, "SMAVs").split(",")]
                    chosen = [m["options"][i] if i < len(m["options"]) else (custom[i] if i < len(custom) else "")
                              for i, on in enumerate(sel) if on]
                    inst["materials"].append({
                        "materialId": mid, "name": m["name"], "selected": [c for c in chosen if c],
                        "extraInfo": txt(ma, "SMAI") or None, "excluded": txt(ma, "SMAEx") == "1",
                    })
                out["instances"].append(inst)
            sections.append(out)

    ga = tpl_el.find(".//GA")
    gen = {
        "selections": [txt(x, "GASMT") for x in ga.findall("GASM")] if ga is not None else [],
        "html": unescape_html(txt(ga, "GAI")) if ga is not None else "",
    }

    return {
        "format": "inspection-report/v1",
        "source": "HomeGauge",
        "reportId": txt(r, "ReportGUID"),
        "reportNumber": info.get("RIReportNumber"),
        "inspection": {
            "date": info.get("RIDate"), "start": info.get("RIStartTime"), "end": info.get("RIStopTime"),
            "address": info.get("RIAddress1"), "city": info.get("RICity"), "state": info.get("RIState"),
            "zip": info.get("RIZip"), "inspector": info.get("RIInspector"),
            "company": info.get("RIInspectorCo"), "license": info.get("RIinspectorLicense"),
            "notes": info.get("RISpecialNotes"), "mls": info.get("RIMLS"),
        },
        "clients": [{"first": c.get("CFName1"), "last": c.get("CLName1"), "email": c.get("CEmail"),
                     "phone": c.get("CMobilePhone"), "address": c.get("CAddress"), "city": c.get("CCity"),
                     "state": c.get("CState"), "zip": c.get("CZip")} for c in clients],
        "people": people,
        "services": services,
        "templateName": txt(r, "TemplateFileName"),
        "generalInfo": gen,
        "sections": sections,
        "_template": T,  # full template snapshot, like HomeGauge keeps
    }


def main():
    mode, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    root = ET.parse(src).getroot()
    if mode == "template":
        T = parse_template(root)
        issues = audit_template(T)
        json.dump(T, open(os.path.join(out, "template.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        json.dump(issues, open(os.path.join(out, "audit.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        write_audit(T, issues, os.path.join(out, "template-audit.md"))
        print({k: len(v) for k, v in issues.items()})
    else:
        R = parse_report(root)
        json.dump(R, open(os.path.join(out, "report.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        n_items = sum(len(i["items"]) for s in R["sections"] for i in s["instances"])
        n_ent = sum(len(it["entries"]) for s in R["sections"] for i in s["instances"] for it in i["items"])
        n_pic = sum(len(e["photos"]) for s in R["sections"] for i in s["instances"] for it in i["items"] for e in it["entries"])
        print(f"sections={len(R['sections'])} items={n_items} comments={n_ent} photos={n_pic}")


if __name__ == "__main__":
    main()
