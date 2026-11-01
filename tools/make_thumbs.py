#!/usr/bin/env python3
"""
Vorschaubilder (WebP) für die Zimmerfotos erzeugen.

Liest zimmer.json und legt für jedes Foto, das noch kein Vorschaubild hat, eines an:

    images/Fotos_Wohnungen/Zi-Graz_01.jpeg
 →  images/thumbs/Fotos_Wohnungen/Zi-Graz_01.webp

Einstellungen wie bei den bestehenden Vorschaubildern: längste Seite höchstens 760 px,
WebP-Qualität 78, Drehung laut Kamera (EXIF) wird übernommen. Kamera-Metadaten
(z. B. GPS-Position) landen NICHT im Vorschaubild.

Aufruf (im Hauptordner der Website):
    python3 tools/make_thumbs.py           # nur fehlende Vorschaubilder anlegen
    python3 tools/make_thumbs.py --check   # nur prüfen, nichts schreiben (Rückgabe 1, wenn etwas fehlt)
    python3 tools/make_thumbs.py --force   # alle neu erzeugen (z. B. nach Austausch eines Fotos)

Benötigt Python 3.8+ und Pillow:  python3 -m pip install Pillow
Ohne Vorschaubild funktioniert die Zimmerseite trotzdem – sie lädt dann das Originalfoto.
"""

import argparse
import json
import os
import re
import sys
from urllib.parse import unquote

MAX_SIZE = 760      # längste Seite in Pixel
QUALITY = 78        # WebP-Qualität
METHOD = 6          # WebP-Kompression: 6 = gründlichste (langsamer, kleinere Dateien)

ROOT_DEFAULT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def thumb_path_for(photo):
    """Gleiche Regel wie assets/js/zimmer.js: images/X/Y.jpeg → images/thumbs/X/Y.webp"""
    if not re.match(r"^images/", photo, re.I):
        return None
    rest = re.sub(r"\.[a-z0-9]{2,5}$", "", photo[7:], flags=re.I)
    return "images/thumbs/" + rest + ".webp"


def load_photos(json_file):
    """Alle Fotopfade aus zimmer.json (Reihenfolge bleibt, doppelte nur einmal)."""
    try:
        with open(json_file, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        sys.exit("Fehler: %s nicht gefunden." % json_file)
    except json.JSONDecodeError as err:
        sys.exit(
            "Fehler: zimmer.json ist kein gültiges JSON (Zeile %d, Spalte %d): %s\n"
            "Häufige Ursachen: fehlendes oder überzähliges Komma, fehlende Anführungszeichen."
            % (err.lineno, err.colno, err.msg)
        )
    rooms = data if isinstance(data, list) else data.get("zimmer", [])
    photos = []
    for room in rooms:
        if not isinstance(room, dict):
            continue
        for photo in room.get("photos") or []:
            if isinstance(photo, str) and photo.strip() and photo.strip() not in photos:
                photos.append(photo.strip())
    return photos


def existing_path(root, rel):
    """Pfad auf der Festplatte – auch wenn er in zimmer.json URL-kodiert steht (%20 statt Leerzeichen)."""
    for candidate in (rel, unquote(rel)):
        full = os.path.join(root, *candidate.split("/"))
        if os.path.isfile(full):
            return full, candidate
    return None, rel


def make_thumb(Image, ImageOps, resample, src, dst):
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        im = im.convert("RGBA" if has_alpha else "RGB")
        im.thumbnail((MAX_SIZE, MAX_SIZE), resample)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = dst + ".tmp"
        im.save(tmp, "WEBP", quality=QUALITY, method=METHOD)
        os.replace(tmp, dst)          # erst fertig schreiben, dann umbenennen
        return im.size


def main():
    parser = argparse.ArgumentParser(description="Vorschaubilder (WebP) für die Zimmerfotos aus zimmer.json erzeugen.")
    parser.add_argument("--check", action="store_true", help="nur prüfen, nichts schreiben (Rückgabe 1, wenn Vorschaubilder fehlen)")
    parser.add_argument("--force", action="store_true", help="alle Vorschaubilder neu erzeugen")
    parser.add_argument("--root", default=ROOT_DEFAULT, help="Hauptordner der Website (Standard: Ordner über tools/)")
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    photos = load_photos(os.path.join(root, "zimmer.json"))

    Image = ImageOps = resample = None
    if not args.check:
        try:
            from PIL import Image, ImageOps
        except ImportError:
            sys.exit("Fehler: Pillow fehlt. Installieren mit:  python3 -m pip install Pillow")
        resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS")

    created = skipped = missing = 0
    problems = []
    for photo in photos:
        thumb_rel = thumb_path_for(photo)
        if thumb_rel is None:
            problems.append("übersprungen (liegt nicht unter images/): %s" % photo)
            continue
        src, photo_rel = existing_path(root, photo)
        if src is None:
            problems.append("Foto nicht gefunden: %s" % photo)
            continue
        thumb_rel = thumb_path_for(photo_rel)
        dst = os.path.join(root, *thumb_rel.split("/"))

        if os.path.isfile(dst) and not args.force:
            skipped += 1
            continue
        if args.check:
            missing += 1
            print("fehlt:     %s" % thumb_rel)
            continue
        try:
            w, h = make_thumb(Image, ImageOps, resample, src, dst)
        except Exception as err:      # defektes Bild o. Ä. – die anderen trotzdem bearbeiten
            problems.append("Fehler bei %s: %s" % (photo, err))
            continue
        created += 1
        print("erstellt:  %s  (%d×%d, %d KB)" % (thumb_rel, w, h, round(os.path.getsize(dst) / 1024)))

    for line in problems:
        print("Achtung:   " + line)
    if args.check:
        print("\n%d Fotos geprüft: %d Vorschaubilder vorhanden, %d fehlen." % (len(photos), skipped, missing))
    else:
        print("\n%d Fotos: %d Vorschaubilder erstellt, %d waren schon da." % (len(photos), created, skipped))
        if created:
            print("Jetzt die neuen Dateien unter images/thumbs/ mit committen.")
    if problems:
        return 2
    if args.check and missing:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
