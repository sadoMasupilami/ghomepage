# Website der Akademischen Sängerschaft Gothia zu Graz

Das ist der Quellcode von **[www.gothia-graz.at](https://www.gothia-graz.at)**.
Die Seite besteht aus ganz normalen HTML-, CSS- und JavaScript-Dateien. Es gibt **keinen Build-Schritt**:
Was hier im Repository liegt, ist genau das, was online geht. Gehostet wird bei World4You (Apache + PHP).

> **Kurz gesagt:** Datei auf GitHub ändern → „Commit changes“ → nach ca. **1–2 Minuten** ist die Änderung online (wie bisher).

---

## Was ändere ich wo?

| Ich möchte … | Dann bearbeite ich … |
|---|---|
| ein Zimmer als frei/belegt melden, einen Preis ändern | [`zimmer.json`](zimmer.json) → [Zimmer aktualisieren](#zimmer-aktualisieren) |
| einen Termin eintragen oder ändern | **den Google-Kalender** „Veranstaltungen AS! Gothia“ – nicht die Website → [Termine](#termine) |
| Texte auf der Startseite ändern | [`index.html`](index.html) |
| Impressum oder Datenschutzerklärung anpassen | [`impressum.html`](impressum.html), [`datenschutz.html`](datenschutz.html) |
| Farben oder Schriften anpassen | [`assets/css/site.css`](assets/css/site.css), ganz oben → [Design](#design-farben--schriften) |
| die Google-Analytics-ID oder den Cookie-Text ändern | [`consent.js`](consent.js) → [Cookie-Banner](#cookie-banner--google-analytics) |

## Änderungen veröffentlichen

1. Auf GitHub die gewünschte Datei öffnen und auf das **Stift-Symbol** („Edit this file“) klicken.
2. Ändern, unten eine kurze Beschreibung eintippen (z. B. „Zimmer Graz ist frei“) und **„Commit changes“** klicken.
3. Nach ca. 1–2 Minuten ist die Seite automatisch aktualisiert. Im Browser ggf. einmal neu laden.

Größere Änderungen am besten vorher [lokal ansehen](#lokal-ansehen).

---

## Ordnerstruktur

```
index.html            Startseite (alle Abschnitte: Über uns, Chor, Termine, Gothenhaus …)
zimmer.html           Freie Zimmer – liest zimmer.json
impressum.html        Impressum
datenschutz.html      Datenschutzerklärung
404.html              „Seite nicht gefunden“ (alle Pfade dort beginnen mit „/“)

zimmer.json           Zimmerliste: Status, Preise, Fotos  ← wird am häufigsten bearbeitet
calendar.php          holt den Google-Kalender und speichert eine Kopie (15 Minuten)
consent.js            Cookie-Banner; lädt Google Analytics nur nach Zustimmung
.htaccess             Server-Einstellungen: Fehlerseite, Komprimierung, Cache, Sicherheit
robots.txt            Hinweise für Suchmaschinen
sitemap.xml           Seitenliste für Suchmaschinen
favicon.ico / favicon.png / apple-touch-icon.png   Symbole für Browser-Tab und Handy

assets/
  css/site.css        Design-System: Farben, Schriften und alle gemeinsamen Bausteine
  css/zimmer.css      nur für die Zimmerseite
  js/site.js          gemeinsame Logik: Menü, Einblenden, Karten/Spotify erst nach Klick …
  js/termine.js       liest den Kalender und zeigt die Termine an
  js/zimmer.js        baut Zimmerliste und Fotogalerie
  fonts/              Schriften (selbst gehostet – keine Verbindung zu Google Fonts)
  img/                Bilder der Seiten (WebP, jeweils in mehreren Größen)

images/               Zimmerfotos (Originale, JPEG)
  thumbs/             Vorschaubilder dazu (WebP, werden per Skript erzeugt)

tools/make_thumbs.py  erzeugt fehlende Vorschaubilder für die Zimmerfotos
tests/                automatische Tests für die Terminlogik

cache/                (nur auf dem Server, nicht in Git) Zwischenspeicher von calendar.php
```

`README.md`, `tools/`, `tests/` und `cache/` sind auf dem Server für Besucher gesperrt.

---

## Zimmer aktualisieren

Alles zu den Zimmern steht in **`zimmer.json`**. Ein Eintrag sieht so aus:

```json
{
  "name": "Graz",
  "size": 23,
  "price": 410,
  "status": "frei",
  "balkon": false,
  "hinweis": "ab Sept. 2026",
  "photos": [
    "images/Fotos_Wohnungen/Fotos_Wohnungen/Zi-Graz_01.jpeg",
    "images/Fotos_Wohnungen/Fotos_Wohnungen/Zi-Graz_02.jpeg"
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `name` | Name des Zimmers (Text in Anführungszeichen) |
| `size` | Größe in m² (Zahl, **ohne** Anführungszeichen) |
| `price` | Miete in Euro pro Monat (Zahl). **`null`** (ohne Anführungszeichen) zeigt „auf Anfrage“ |
| `status` | `"frei"`, `"reserviert"`, `"gaestezimmer"` oder `"belegt"` – steuert Farbe, Filter und Sortierung (freie Zimmer zuerst). `""` = kein Status-Abzeichen. Groß/klein und Umlaute sind egal („Gästezimmer“ geht auch). |
| `balkon` | `true` = Abzeichen „Balkon“, `false` = keins |
| `hinweis` | kleines Zusatz-Abzeichen, z. B. `"ab Sept. 2026"`. `""` = keins |
| `photos` | Liste der Fotos. Reihenfolge = Reihenfolge in der Galerie, **das erste Foto ist das Vorschaubild** |

Die Startseite zeigt automatisch „Aktuell X Zimmer frei · ab Y € / Monat“ – berechnet aus derselben Datei.

**Wichtig – gültiges JSON:** Texte stehen in `"…"`, Einträge werden mit Komma getrennt, nach dem **letzten** Eintrag einer Liste steht **kein** Komma.
Ist die Datei fehlerhaft, zeigt die Zimmerseite statt der Liste nur „Die Zimmerliste konnte gerade nicht geladen werden …“.
Prüfen kannst du sie vor dem Commit z. B. mit
`python3 tools/make_thumbs.py --check` – das meldet bei einem Fehler Zeile und Spalte.

### Neue Fotos hinzufügen

1. Foto in einen Ordner unter `images/` hochladen (JPEG ist ok). Am besten mit einem einfachen Dateinamen
   ohne Leer- und Sonderzeichen, z. B. `Zi-Graz_07.jpeg`, und nicht größer als ca. 2000 px / 1 MB.
2. Den Pfad in `zimmer.json` bei `photos` eintragen.
3. **Vorschaubild erzeugen** (empfohlen, damit die Zimmerseite schnell lädt):
   ```bash
   python3 tools/make_thumbs.py
   ```
   Das legt für jedes Foto ohne Vorschaubild eine WebP-Datei unter `images/thumbs/…` an
   (max. 760 px, richtig gedreht, ohne Kamera-Metadaten wie GPS). Diese Dateien mit committen.
   Benötigt Python 3 und Pillow (`python3 -m pip install Pillow`). Bereits vorhandene Vorschaubilder bleiben unverändert.

**Kein Computer zur Hand?** Kein Problem: Fehlt das Vorschaubild, lädt die Zimmerseite einfach das Originalfoto.
Das funktioniert, ist nur etwas langsamer. Das Vorschaubild kann später jemand nachziehen.

**Foto ersetzen:** Am besten unter einem **neuen Dateinamen** hochladen (Browser speichern Bilder bis zu 30 Tage).
Wer denselben Namen behält, erzeugt das Vorschaubild mit `python3 tools/make_thumbs.py --force` neu.

---

## Termine

Termine werden **nur im Google-Kalender „Veranstaltungen AS! Gothia“** gepflegt – mit einem Google-Konto,
das Schreibrechte für diesen Kalender hat. Die Website liest sie von dort:

```
Google-Kalender  ──►  calendar.php  ──►  Startseite (Terminliste + „Nächster Termin“)
                      (holt höchstens         └─►  Abo für Handys/Outlook:
                       alle 15 Min. neu)            webcal://www.gothia-graz.at/calendar.php
```

- Neue oder geänderte Termine erscheinen spätestens nach **ca. 15 Minuten** auf der Website.
- Ist Google einmal nicht erreichbar, liefert `calendar.php` die letzte funktionierende Kopie aus.
- Die Startseite zeigt die nächsten 6 Termine (weitere per Klick) und ordnet sie automatisch ein:
  Titel mit „Probe“, „Lieder…“, „Konzert“ usw. werden als **Musik** markiert, „Kneipe“, „Fest“, „Ball“ … als **Geselligkeit**.
  Termine mit **„Convent“** im Titel gelten als intern und werden nie als „Nächster Termin“ oben im Kopfbereich gezeigt.
- Serientermine (z. B. wöchentliche Chorprobe) und einzelne Ausnahmen davon werden korrekt berücksichtigt.

**Offline-Kopie:** In `index.html` steht ganz unten im Abschnitt „Termine“ ein Block
`<script type="text/calendar" id="ics-fallback">`. Diese Kopie wird **nur** verwendet, wenn `calendar.php`
nicht erreichbar ist – etwa wenn man die Seite lokal ohne PHP öffnet. Im Normalbetrieb muss man sie nicht anfassen.
Wer sie auffrischen will, ersetzt den Inhalt durch den aktuellen Kalender (Adresse `…/calendar.php` im Browser öffnen,
alles kopieren).

**Fehlersuche:** `https://www.gothia-graz.at/calendar.php` im Browser öffnen – der Text muss mit `BEGIN:VCALENDAR` beginnen.
Für Technikinteressierte: Der Antwort-Header `X-Calendar-Cache` zeigt `HIT` (aus dem Zwischenspeicher),
`MISS` (gerade frisch von Google) oder `STALE` (Google nicht erreichbar, ältere Kopie). Probleme stehen im PHP-Fehlerprotokoll des Hostings.

---

## Cookie-Banner & Google Analytics

Alles steht in **`consent.js`**:

- Die Google-Analytics-ID steht ganz oben: `var GA_ID = 'G-TDHNXVECH4';`
- Google Analytics wird **ausschließlich nach Zustimmung** geladen („Akzeptieren“).
- Spotify-Player und Google-Karte auf der Startseite laden ebenfalls erst nach Zustimmung – oder wenn man
  direkt auf „Player laden“ / „Karte laden“ klickt.
- Die Auswahl wird nur im Browser des Besuchers gespeichert (`localStorage`, Schlüssel `gothia-consent`).
  Über „Cookie-Einstellungen“ in der Fußzeile kann man sie jederzeit ändern.

Wird ein Dienst ergänzt, geändert oder entfernt, bitte auch **`datenschutz.html`** anpassen.

**Grundsatz (DSGVO):** Die Seite lädt nichts von fremden Servern, solange niemand zustimmt –
Schriften, Skripte und Bilder liegen alle hier im Repository. Bitte keine externen Schriften (z. B. Google Fonts),
CDNs oder Einbettungen ohne Einwilligung hinzufügen.

---

## Lokal ansehen

Im Hauptordner der Website ein Terminal öffnen und einen kleinen Webserver starten:

```bash
python3 -m http.server 8000      # dann http://localhost:8000 öffnen
```

Ohne PHP zeigt die Startseite die Termine aus der Offline-Kopie. Wer `calendar.php` live testen möchte
(Internetverbindung nötig):

```bash
php -S localhost:8000            # dann http://localhost:8000 öffnen
```

Einfach `index.html` per Doppelklick öffnen geht auch, dann funktionieren aber manche Dinge nicht
(z. B. die Zimmerliste, weil der Browser `zimmer.json` so nicht laden darf). Die 404-Seite sieht man lokal unter `/404.html`.

## Tests

Die Terminlogik (Kalender lesen, Serientermine, Zeitzonen, Sommer-/Winterzeit …) wird automatisch getestet:

```bash
node --test tests/
```

Dafür wird nur [Node.js](https://nodejs.org) ab Version 18 benötigt, sonst nichts. Beispielkalender liegen in `tests/fixtures/`.

---

## Design: Farben & Schriften

Alle Farben und Abstände sind ganz oben in **`assets/css/site.css`** als „Tokens“ festgelegt
(angelehnt an Band und Mütze: Gold · Grün · Weiß · Gold):

| Token | Farbe | Verwendung |
|---|---|---|
| `--forest-900` | `#0f2619` | Waldgrün – dunkle Flächen, Kopf- und Fußbereich |
| `--band-green` | `#0e6b45` | Grün aus dem Band |
| `--gold` | `#c9a24c` | Gold – Buttons, Akzente |
| `--gold-light` | `#e6cf91` | helles Gold auf dunklem Grund |
| `--paper` / `--parchment` | `#fbf8f1` / `#f4eddd` | helle Hintergründe |
| `--ink` | `#152019` | Textfarbe |

**Schriften:** *Newsreader* (Überschriften, gern kursiv für Akzente) und *Manrope* (Fließtext) –
beide selbst gehostet in `assets/fonts/`.

Häufige Bausteine: Buttons `btn btn--gold` / `btn--forest` / `btn--ghost`, kleine Überzeile `eyebrow`,
Überschrift `h2` mit `<em>…</em>` für den farbigen, kursiven Teil, Abschnitte `section section--paper` /
`section--parchment` / `section--forest`. Unterseiten beginnen mit einem dunklen Kopfbereich `page-hero`.

## Bilder

- **Format:** WebP (Qualität ca. 75–80). Umwandeln geht z. B. mit [Squoosh](https://squoosh.app)
  (läuft im Browser, das Bild verlässt den Computer nicht) oder `cwebp`.
- **Größen:** großes Titelbild 960 / 1600 / 2400 px breit, Inhaltsbilder 640–1400 px. Größere Bilder als nötig
  machen die Seite nur langsam.
- Im HTML immer `width` und `height` angeben, `loading="lazy"` (außer beim Titelbild) und einen
  aussagekräftigen `alt`-Text (rein dekorative Bilder: `alt=""`).
- `assets/img/og-image.jpg` (1200 × 630 px) ist das Vorschaubild beim Teilen in WhatsApp, Facebook & Co.
- Ein Bild ersetzen: am besten **neuer Dateiname**, sonst sehen wiederkehrende Besucher bis zu 30 Tage das alte.

## Server-Einstellungen (`.htaccess`)

- Unbekannte Adressen zeigen die hübsche Seite `404.html`.
- Dateien werden komprimiert ausgeliefert; Browser speichern Bilder & Schriften 30 Tage, CSS/JS 7 Tage,
  HTML-Seiten, `zimmer.json` und den Kalender dagegen nicht lange.
- **Nach Änderungen an CSS oder JavaScript** sehen wiederkehrende Besucher bis zu 7 Tage die alte Version.
  Abhilfe: In allen HTML-Dateien steht hinter den Dateinamen eine Versionsnummer (aktuell `?v=20261101`,
  z. B. `assets/css/site.css?v=20261101`). Nach einer Änderung überall auf das neue Datum hochzählen.
- Eine Weiterleitung auf HTTPS/www ist absichtlich **nicht** aktiv (das erledigt das Hosting); ein Beispiel steht auskommentiert drin.
- Zeigt die Seite nach einer Änderung an `.htaccess` „500 Internal Server Error“: die letzte Änderung rückgängig machen.

---

Fragen? **info@gothia-graz.at** · *Vivat, crescat, floreat!*
