"""Cherche les nouveaux chapitres de chaque série sur MangaUpdates.

Lit library.json et releases.json dans le dossier donné (la branche "data"),
met à jour releases.json, et indique s'il y a eu des changements.
"""
import datetime
import json
import pathlib
import sys
import time
import urllib.request

API = "https://api.mangaupdates.com/v1/series/"
folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

library = json.loads((folder / "library.json").read_text(encoding="utf-8"))
rel_path = folder / "releases.json"
releases = json.loads(rel_path.read_text(encoding="utf-8")) if rel_path.exists() else {"series": {}}
known = releases.setdefault("series", {})


def fetch(series_id):
    for attempt in range(4):
        try:
            req = urllib.request.Request(API + str(series_id), headers={"User-Agent": "ma-bibliotheque-manga/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(5 * (attempt + 1))
        except Exception:
            time.sleep(5 * (attempt + 1))
    return None


ids = sorted({str(s["mu"]) for s in library.get("series", []) if s.get("mu") and not s.get("deleted")})
new_count = 0
for sid in ids:
    d = fetch(sid)
    time.sleep(0.5)
    if not d:
        continue
    old = known.get(sid, {})
    latest = d.get("latest_chapter") or None
    cover = ((d.get("image") or {}).get("url") or {}).get("thumb") or old.get("cover", "")
    entry = {
        "title": d.get("title", old.get("title", "")),
        "url": d.get("url", old.get("url", "")),
        "type": d.get("type", old.get("type", "")),
        "latest": latest,
        "completed": bool(d.get("completed")),
        "cover": cover,
        "changed_at": old.get("changed_at"),
        "history": old.get("history", []),
    }
    if latest and old.get("latest") and latest > old["latest"]:
        entry["changed_at"] = now
        entry["history"] = ([{"chapter": latest, "at": now}] + entry["history"])[:20]
        new_count += 1
        print(f"Nouveau : {entry['title']} -> {latest}")
    known[sid] = entry

releases["checked_at"] = now
rel_path.write_text(json.dumps(releases, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(ids)} séries vérifiées, {new_count} avec de nouveaux chapitres")
