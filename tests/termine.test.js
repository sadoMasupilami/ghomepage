'use strict';
/*
 * Tests für assets/js/termine.js (Kalender-Modul der Startseite).
 * Ausführen im Repo-Ordner:  node --test tests/
 * Keine Abhängigkeiten. Die Ergebnisse dürfen nicht von der Zeitzone des Rechners abhängen
 * (z. B. auch mit TZ=UTC oder TZ=America/New_York laufen lassen).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const T = require('../assets/js/termine.js');

const FIX = path.join(__dirname, 'fixtures');
const GCAL = fs.readFileSync(path.join(FIX, 'gcal.ics'), 'utf8');          // aktueller Google-Feed
const WORDPRESS = fs.readFileSync(path.join(FIX, 'wordpress.ics'), 'utf8'); // alte Kopie aus WordPress
const DAY = 86400000;

/* ── Hilfsfunktionen ── */

// Kalender aus Termin-Zeilen bauen (CRLF wie im echten Feed)
function cal(...events) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gothia//Tests//DE'];
    events.forEach((e) => lines.push('BEGIN:VEVENT', ...e, 'END:VEVENT'));
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
}
const ms = (s) => { const v = Date.parse(s); assert.ok(!Number.isNaN(v), 'ungültiges Datum im Test: ' + s); return v; };
const occ = (text, from, to) => T.buildOccurrences(T.parseICS(text), ms(from), ms(to));
const iso = (t) => new Date(t).toISOString().replace(':00.000Z', 'Z');   // 2026-11-10T18:00Z

const VIENNA = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vienna', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
});
// Zeitpunkt → Wiener Ortszeit „YYYY-MM-DD HH:MM“
function local(t) {
    const p = {};
    VIENNA.formatToParts(new Date(t)).forEach((x) => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const localDay = (t) => local(t).slice(0, 10);
// ICU kann schmale geschützte Leerzeichen liefern → für Vergleiche vereinheitlichen
const norm = (s) => String(s).replace(/[\u00a0\u202f]/g, ' ');
const unfoldIcs = (s) => s.replace(/\r\n[ \t]/g, '');

/* ───────────────────────── Modul ───────────────────────── */

describe('Modul', () => {
    it('exportiert die öffentliche API', () => {
        for (const name of ['parseICS', 'buildOccurrences', 'expandRule', 'parseRRule', 'wallToInstant', 'timeText', 'singleIcs', 'tagOf']) {
            assert.equal(typeof T[name], 'function', name);
        }
        assert.equal(globalThis.GothiaTermine, T);
    });
});

/* ───────────────────────── Parser ───────────────────────── */

describe('parseICS: Zeilen & Text', () => {
    it('entfaltet gefaltete Zeilen (CRLF + Leerzeichen/Tab, LF, CR)', () => {
        const crlf = 'BEGIN:VEVENT\r\nDTSTART:20261110T180000Z\r\nSUMMARY:Lieder\r\n abend mit\r\n\t Krambambuli\r\nDESCRIPTION:Erste Zeile\r\n  mit Leerzeichen\r\nEND:VEVENT\r\n';
        const [e] = T.parseICS(crlf);
        assert.equal(e.summary, 'Liederabend mit Krambambuli');
        assert.equal(e.description, 'Erste Zeile mit Leerzeichen');   // nur das erste Leerzeichen der Folgezeile fällt weg
        assert.deepEqual(T.parseICS(crlf.replace(/\r\n/g, '\n')), [e]);
        assert.deepEqual(T.parseICS(crlf.replace(/\r\n/g, '\r')), [e]);
    });

    it('entfaltet auch Parameter und Werte von Datumszeilen', () => {
        const [e] = T.parseICS(cal(['DTSTART;TZID=Europe/', ' Vienna:20261110T19', ' 0000', 'SUMMARY:x']));
        assert.equal(e.start.tz, 'Europe/Vienna');
        assert.equal(iso(T.buildOccurrences([e], 0, ms('2030-01-01'))[0].start), '2026-11-10T18:00Z');
    });

    it('löst Escape-Sequenzen auf (\\, \\; \\n \\N \\\\)', () => {
        const [e] = T.parseICS(cal([
            'DTSTART:20261110T180000Z',
            'SUMMARY:Kneipe\\, Bier\\; Gesang',
            'LOCATION:Feyertagsstube\\, Leonhardstraße 27\\, Graz\\, 8010',
            'DESCRIPTION:Zeile 1\\nZeile 2\\NZeile 3\\, mit Komma\\; Strichpunkt und C:\\\\Pfad\\\\neu'
        ]));
        assert.equal(e.summary, 'Kneipe, Bier; Gesang');
        assert.equal(e.location, 'Feyertagsstube, Leonhardstraße 27, Graz, 8010');
        // „\\n“ ist ein Backslash gefolgt von „n“ — kein Zeilenumbruch
        assert.equal(e.description, 'Zeile 1\nZeile 2\nZeile 3, mit Komma; Strichpunkt und C:\\Pfad\\neu');
    });

    it('macht aus HTML-Beschreibungen (Google) reinen Text', () => {
        const [e] = T.parseICS(cal([
            'DTSTART:20261110T180000Z',
            'SUMMARY:Liederabend',
            'DESCRIPTION:<p>Hallo <b>Bundesbrüder</b>\\,</p><p>Treffpunkt: Haus<br>Beginn <i>19 Uhr</i></p><ul><li>Eins</li><li>Zwei</li></ul><!-- intern --><a href="https://www.gothia-graz.at/">Website</a>'
        ]));
        assert.equal(e.description, 'Hallo Bundesbrüder,\nTreffpunkt: Haus\nBeginn 19 Uhr\nEins\nZwei\nWebsite');
    });

    it('dekodiert HTML-Entities genau einmal und lässt Text mit < und > stehen', () => {
        const d = (v) => T.parseICS(cal(['DTSTART:20261110T180000Z', 'DESCRIPTION:' + v]))[0].description;
        assert.equal(d('Bier &amp; Brezeln&nbsp;um&nbsp;19 Uhr'), 'Bier & Brezeln um 19 Uhr');
        assert.equal(d('Code: &lt;b&gt; und &quot;Zitat&quot; &#39;x&#39; &apos;y&apos;'), 'Code: <b> und "Zitat" \'x\' \'y\'');
        assert.equal(d('&amp;lt;b&amp;gt;'), '&lt;b&gt;');                    // kein doppeltes Dekodieren
        assert.equal(d('Gr&auml;tzer &#228;&#xE4;&#X2013;&#8364; &#127926;'), 'Grätzer ää–€ \u{1F3B6}');
        assert.equal(d('&unbekannt; &#0; &#xD800;'), '&unbekannt; &#0; &#xD800;');
        assert.equal(d('Eintritt < 5 € für Mitglieder\\, > 10 € sonst'), 'Eintritt < 5 € für Mitglieder, > 10 € sonst');
        assert.equal(d('a<br><br><br><br>b'), 'a\n\nb');
    });

    it('liest URL, STATUS, UID und ignoriert CATEGORIES/X-Eigenschaften', () => {
        const [e] = T.parseICS(cal([
            'UID: abc@google.com ', 'DTSTART:20261110T180000Z', 'STATUS:cancelled', 'URL:https://www.gothia-graz.at/event/x/',
            'CATEGORIES:Gothische Veranstaltung,nur für Männer', 'X-GOOGLE-CONFERENCE:https://meet.example', 'SUMMARY:x'
        ]));
        assert.equal(e.uid, 'abc@google.com');
        assert.equal(e.status, 'CANCELLED');
        assert.equal(e.url, 'https://www.gothia-graz.at/event/x/');
        assert.equal(e.summary, 'x');
    });

    it('VALARM im Termin stört nicht (Eigenschaften des Alarms werden ignoriert)', () => {
        const events = T.parseICS(cal(
            ['UID:a', 'DTSTART;TZID=Europe/Vienna:20261110T190000', 'SUMMARY:Chorprobe', 'DESCRIPTION:Echte Beschreibung',
                'BEGIN:VALARM', 'ACTION:DISPLAY', 'SUMMARY:Alarm', 'DESCRIPTION:Erinnerung', 'TRIGGER;VALUE=DATE-TIME:20261110T170000Z', 'END:VALARM',
                'BEGIN:VALARM', 'ACTION:AUDIO', 'TRIGGER:-PT1H', 'END:VALARM',
                'LOCATION:Gothenhaus', 'DTEND;TZID=Europe/Vienna:20261110T223000'],
            ['UID:b', 'DTSTART:20261111T180000Z', 'SUMMARY:Danach']
        ));
        assert.equal(events.length, 2);
        assert.equal(events[0].summary, 'Chorprobe');
        assert.equal(events[0].description, 'Echte Beschreibung');
        assert.equal(events[0].location, 'Gothenhaus');                 // nach END:VALARM wieder gelesen
        assert.ok(events[0].end, 'DTEND nach dem Alarm wird gelesen');
        assert.equal(events[1].summary, 'Danach');
    });

    it('ignoriert kaputte Zeilen und Termine ohne (gültiges) DTSTART', () => {
        const text = [
            'BEGIN:VCALENDAR', 'das ist keine iCalendar-Zeile', '', '   ',
            'BEGIN:VEVENT', 'SUMMARY:Ohne Beginn', 'END:VEVENT',
            'BEGIN:VEVENT', 'DTSTART:2026-11-10', 'SUMMARY:Falsches Datum', 'END:VEVENT',
            'BEGIN:VEVENT', 'DTSTART:20261110T180000Z', 'KAPUTT', ':nur Wert', 'SUMMARY:Gültig', 'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
        const events = T.parseICS(text);
        assert.deepEqual(events.map((e) => e.summary), ['Gültig']);
        assert.deepEqual(T.parseICS(''), []);
        assert.deepEqual(T.parseICS('<!doctype html><html>Fehler 503</html>'), []);
    });

    it('verliert keine Folgetermine, wenn ein END:VEVENT fehlt, und übernimmt abgeschnittene Dateien', () => {
        const text = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT', 'DTSTART:20261110T180000Z', 'SUMMARY:Ohne Ende',
            'BEGIN:VEVENT', 'DTSTART:20261111T180000Z', 'SUMMARY:Zweiter', 'END:VEVENT',
            'BEGIN:VEVENT', 'DTSTART:20261112T180000Z', 'SUMMARY:Dritter', 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'END:VEVENT',
            'BEGIN:VEVENT', 'DTSTART:20261113T180000Z', 'SUMMARY:Abgeschnit'
        ].join('\r\n');
        assert.deepEqual(T.parseICS(text).map((e) => e.summary), ['Ohne Ende', 'Zweiter', 'Dritter', 'Abgeschnit']);
    });

    it('ignoriert DTSTART/RRULE aus VTIMEZONE', () => {
        const events = T.parseICS(GCAL);
        assert.ok(events.every((e) => e.summary), 'nur echte Termine');
        assert.ok(!events.some((e) => e.start.w.y === 1970));
    });
});

describe('parseICS: Datumswerte', () => {
    const one = (line) => T.parseICS(cal([line, 'SUMMARY:x']))[0];
    const start = (line) => T.buildOccurrences([one(line)], 0, ms('2100-01-01'))[0];

    it('unterscheidet UTC, TZID und „floating“ (= Wiener Zeit)', () => {
        assert.equal(iso(start('DTSTART:20261110T190000Z').start), '2026-11-10T19:00Z');
        assert.equal(iso(start('DTSTART;TZID=Europe/Vienna:20261110T190000').start), '2026-11-10T18:00Z');
        assert.equal(iso(start('DTSTART;TZID="Europe/Vienna":20261110T190000').start), '2026-11-10T18:00Z');
        assert.equal(iso(start('DTSTART:20261110T190000').start), '2026-11-10T18:00Z');
        assert.equal(iso(start('DTSTART:20260710T190000').start), '2026-07-10T17:00Z');       // Sommerzeit
        assert.equal(iso(start('DTSTART;TZID=America/New_York:20261110T190000').start), '2026-11-11T00:00Z');
        assert.equal(iso(start('DTSTART;TZID=UTC:20261110T190000').start), '2026-11-10T19:00Z');
        assert.equal(iso(start('DTSTART;VALUE=DATE-TIME:20261110T1900').start), '2026-11-10T18:00Z'); // ohne Sekunden
    });

    it('unbekannte TZID fällt auf Europe/Vienna zurück', () => {
        assert.equal(iso(start('DTSTART;TZID=Mars/Olympus_Mons:20261110T190000').start), '2026-11-10T18:00Z');
        assert.equal(iso(start('DTSTART;TZID="(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien":20260710T190000').start), '2026-07-10T17:00Z');
        assert.equal(iso(start('DTSTART;TZID=W. Europe Standard Time:20261110T190000').start), '2026-11-10T18:00Z');
    });

    it('erkennt ganztägige Werte (VALUE=DATE oder nur Datum)', () => {
        const a = one('DTSTART;VALUE=DATE:20261108');
        assert.equal(a.start.allDay, true);
        assert.equal(one('DTSTART:20261108').start.allDay, true);
        assert.equal(one('DTSTART:20261108T000000').start.allDay, false);
    });
});

describe('parseRRule', () => {
    it('liest FREQ, INTERVAL, COUNT, UNTIL', () => {
        const r = T.parseRRule('FREQ=WEEKLY;UNTIL=20261215T225959Z');
        assert.equal(r.freq, 'WEEKLY');
        assert.equal(r.interval, 1);
        assert.equal(r.count, null);
        assert.equal(r.until.utc, true);
        assert.deepEqual(r.until.w, { y: 2026, mo: 12, d: 15, h: 22, mi: 59, s: 59 });
        assert.equal(r.byday, null);
        assert.equal(r.wkst, 1);
    });

    it('liest BYDAY mit Ordinalzahlen, BYMONTHDAY, BYMONTH, WKST', () => {
        const r = T.parseRRule('FREQ=MONTHLY;BYDAY=-1FR,+2MO,TU;BYMONTHDAY=1,-1;BYMONTH=3,10;INTERVAL=2;COUNT=10;WKST=SU');
        assert.deepEqual(r.byday, [{ n: -1, wd: 5 }, { n: 2, wd: 1 }, { n: 0, wd: 2 }]);
        assert.deepEqual(r.bymonthday, [1, -1]);
        assert.deepEqual(r.bymonth, [3, 10]);
        assert.equal(r.interval, 2);
        assert.equal(r.count, 10);
        assert.equal(r.wkst, 0);
    });

    it('ist unempfindlich gegen Groß-/Kleinschreibung und fängt Unsinn ab', () => {
        const r = T.parseRRule('freq=yearly;bymonth=10;byday=-1su;interval=0;count=abc');
        assert.equal(r.freq, 'YEARLY');
        assert.deepEqual(r.bymonth, [10]);
        assert.deepEqual(r.byday, [{ n: -1, wd: 0 }]);
        assert.equal(r.interval, 1);
        assert.equal(r.count, null);
    });
});

/* ───────────────────────── Zeitzonen ───────────────────────── */

describe('wallToInstant', () => {
    const w = (y, mo, d, h, mi) => ({ y, mo, d, h, mi: mi || 0, s: 0 });

    it('rechnet Wiener Sommer- und Winterzeit um', () => {
        assert.equal(iso(T.wallToInstant(w(2026, 7, 3, 19), 'Europe/Vienna')), '2026-07-03T17:00Z');
        assert.equal(iso(T.wallToInstant(w(2026, 12, 1, 19), 'Europe/Vienna')), '2026-12-01T18:00Z');
        assert.equal(iso(T.wallToInstant(w(2026, 10, 25, 19), 'Europe/Vienna')), '2026-10-25T18:00Z');   // Tag der Umstellung
        assert.equal(iso(T.wallToInstant(w(2027, 3, 28, 19), 'Europe/Vienna')), '2027-03-28T17:00Z');
        assert.equal(iso(T.wallToInstant(w(2026, 10, 25, 0, 30), 'Europe/Vienna')), '2026-10-24T22:30Z');
        assert.equal(iso(T.wallToInstant(w(2026, 10, 25, 3, 30), 'Europe/Vienna')), '2026-10-25T02:30Z');
    });

    it('andere Zonen, UTC, fehlende und unbekannte Zone (→ Wien)', () => {
        assert.equal(iso(T.wallToInstant(w(2026, 11, 10, 19), 'UTC')), '2026-11-10T19:00Z');
        assert.equal(iso(T.wallToInstant(w(2026, 11, 10, 19), 'America/New_York')), '2026-11-11T00:00Z');
        assert.equal(iso(T.wallToInstant(w(2026, 11, 10, 19))), '2026-11-10T18:00Z');
        assert.equal(iso(T.wallToInstant(w(2026, 11, 10, 19), 'Keine/Zone')), '2026-11-10T18:00Z');
    });

    it('doppelte Stunde im Herbst → erste Uhrzeit (RFC 5545)', () => {
        assert.equal(iso(T.wallToInstant(w(2026, 10, 25, 2, 30), 'Europe/Vienna')), '2026-10-25T00:30Z');   // 02:30 MESZ
        assert.equal(iso(T.wallToInstant(w(2026, 11, 1, 1, 30), 'America/New_York')), '2026-11-01T05:30Z');  // 01:30 EDT
    });

    it('fehlende Stunde im Frühjahr → Offset vor der Lücke (02:30 → 03:30)', () => {
        const t = T.wallToInstant(w(2026, 3, 29, 2, 30), 'Europe/Vienna');
        assert.equal(iso(t), '2026-03-29T01:30Z');
        assert.equal(local(t), '2026-03-29 03:30');
        assert.equal(iso(T.wallToInstant(w(2026, 3, 8, 2, 30), 'America/New_York')), '2026-03-08T07:30Z');  // 03:30 EDT
    });
});

describe('Sommer-/Winterzeit: 19:00 bleibt 19:00 Ortszeit', () => {
    it('wöchentlich über den letzten Sonntag im Oktober (TZID)', () => {
        const list = occ(cal(['UID:dst1', 'DTSTART;TZID=Europe/Vienna:20261020T190000', 'DTEND;TZID=Europe/Vienna:20261020T210000',
            'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Probe']), '2026-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => iso(o.start)), ['2026-10-20T17:00Z', '2026-10-27T18:00Z', '2026-11-03T18:00Z']);
        assert.deepEqual(list.map((o) => local(o.start)), ['2026-10-20 19:00', '2026-10-27 19:00', '2026-11-03 19:00']);
        assert.deepEqual(list.map((o) => local(o.end)), ['2026-10-20 21:00', '2026-10-27 21:00', '2026-11-03 21:00']);
        assert.deepEqual(list.map((o) => norm(T.timeText(o))), ['19:00 – 21:00 Uhr', '19:00 – 21:00 Uhr', '19:00 – 21:00 Uhr']);
    });

    it('wöchentlich über den letzten Sonntag im März (floating)', () => {
        const list = occ(cal(['UID:dst2', 'DTSTART:20270323T190000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Probe']), '2027-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => iso(o.start)), ['2027-03-23T18:00Z', '2027-03-30T17:00Z']);
        assert.deepEqual(list.map((o) => local(o.start)), ['2027-03-23 19:00', '2027-03-30 19:00']);
    });

    it('täglich über die Umstellung, auch am Umstellungstag selbst', () => {
        const list = occ(cal(['UID:dst3', 'DTSTART;TZID=Europe/Vienna:20261024T190000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => local(o.start)), ['2026-10-24 19:00', '2026-10-25 19:00', '2026-10-26 19:00']);
        assert.deepEqual(list.map((o) => iso(o.start)), ['2026-10-24T17:00Z', '2026-10-25T18:00Z', '2026-10-26T18:00Z']);
    });

    it('Einzeltermine vor und nach der Umstellung', () => {
        const list = occ(cal(
            ['UID:a', 'DTSTART;TZID=Europe/Vienna:20261024T190000', 'SUMMARY:Samstag'],
            ['UID:b', 'DTSTART;TZID=Europe/Vienna:20261026T190000', 'SUMMARY:Montag'],
            ['UID:c', 'DTSTART:20270327T190000', 'SUMMARY:Samstag März'],
            ['UID:d', 'DTSTART:20270329T190000', 'SUMMARY:Montag März']
        ), '2026-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => iso(o.start)), ['2026-10-24T17:00Z', '2026-10-26T18:00Z', '2027-03-27T18:00Z', '2027-03-29T17:00Z']);
        assert.ok(list.every((o) => norm(T.timeText(o)) === '19:00 Uhr'));
    });

    it('Dauer über die Umstellung bleibt die exakte Dauer', () => {
        const [o] = occ(cal(['UID:n', 'DTSTART;TZID=Europe/Vienna:20261024T220000', 'DTEND;TZID=Europe/Vienna:20261025T040000', 'SUMMARY:Lange Nacht']),
            '2026-01-01', '2028-01-01');
        assert.equal(o.end - o.start, 7 * 3600000);     // Uhr wird zurückgestellt → 7 Stunden
        assert.equal(norm(T.timeText(o)), '22:00 Uhr – So., 25. Okt., 04:00 Uhr');
    });

    it('UTC-Serie bleibt in UTC (Ortszeit verschiebt sich, wie im RFC)', () => {
        const list = occ(cal(['UID:u', 'DTSTART:20261020T170000Z', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => iso(o.start)), ['2026-10-20T17:00Z', '2026-10-27T17:00Z']);
    });

    it('ganztägige Serie über die Umstellung bleibt auf ganzen Tagen', () => {
        const list = occ(cal(['UID:ad', 'DTSTART;VALUE=DATE:20261017', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Samstag']), '2026-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => o.startKey), ['2026-10-17', '2026-10-24', '2026-10-31']);
        assert.deepEqual(list.map((o) => local(o.start)), ['2026-10-17 00:00', '2026-10-24 00:00', '2026-10-31 00:00']);
        assert.deepEqual(list.map((o) => local(o.end)), ['2026-10-18 00:00', '2026-10-25 00:00', '2026-11-01 00:00']);
    });
});

/* ───────────────────────── Serientermine ───────────────────────── */

describe('Serientermine (RRULE)', () => {
    const days = (list) => list.map((o) => (o.allDay ? o.startKey : localDay(o.start)));

    it('Google-Feed: Chorprobe wöchentlich mit UNTIL und zwei EXDATEs (TZID)', () => {
        const list = T.buildOccurrences(T.parseICS(GCAL), ms('2026-10-01'), ms('2027-03-01')).filter((o) => o.title === 'Chorprobe');
        assert.deepEqual(days(list), ['2026-10-20', '2026-10-27', '2026-11-10', '2026-11-17', '2026-11-24', '2026-12-08', '2026-12-15']);
        assert.ok(list.every((o) => local(o.start).endsWith(' 19:00') && local(o.end).endsWith(' 22:30')));
        assert.ok(list.every((o) => norm(T.timeText(o)) === '19:00 – 22:30 Uhr'));
        assert.ok(list.every((o) => o.uid === '88buvidcab9j63cr893ceo5rks@google.com'));
    });

    it('UNTIL ist inklusive (auch genau zur Beginnzeit) und darf ein Datum sein', () => {
        const a = occ(cal(['UID:u1', 'DTSTART;TZID=Europe/Vienna:20261020T190000', 'RRULE:FREQ=WEEKLY;UNTIL=20261103T180000Z', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(a), ['2026-10-20', '2026-10-27', '2026-11-03']);
        const b = occ(cal(['UID:u2', 'DTSTART;TZID=Europe/Vienna:20261020T190000', 'RRULE:FREQ=WEEKLY;UNTIL=20261103T175959Z', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(b), ['2026-10-20', '2026-10-27']);
        const c = occ(cal(['UID:u3', 'DTSTART;TZID=Europe/Vienna:20261020T190000', 'RRULE:FREQ=WEEKLY;UNTIL=20261103', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(c), ['2026-10-20', '2026-10-27', '2026-11-03']);
        const d = occ(cal(['UID:u4', 'DTSTART;VALUE=DATE:20261230', 'RRULE:FREQ=DAILY;UNTIL=20270102', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(d), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    });

    it('COUNT (EXDATE verlängert die Serie nicht)', () => {
        const a = occ(cal(['UID:c1', 'DTSTART;TZID=Europe/Vienna:20261013T190000', 'RRULE:FREQ=WEEKLY;COUNT=5', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(a), ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10']);
        const b = occ(cal(['UID:c2', 'DTSTART;TZID=Europe/Vienna:20261013T190000', 'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Europe/Vienna:20261020T190000', 'SUMMARY:x']),
            '2026-01-01', '2028-01-01');
        assert.deepEqual(days(b), ['2026-10-13', '2026-10-27', '2026-11-03']);
        const c = occ(cal(['UID:c3', 'DTSTART:20261101T090000Z', 'RRULE:FREQ=DAILY;INTERVAL=3;COUNT=4', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(c), ['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10']);
    });

    it('INTERVAL=2 mit zwei Wochentagen', () => {
        const list = occ(cal(['UID:i2', 'DTSTART;TZID=Europe/Vienna:20261013T190000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=6', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(list), ['2026-10-13', '2026-10-15', '2026-10-27', '2026-10-29', '2026-11-10', '2026-11-12']);
    });

    it('BYDAY mit mehreren Tagen, Beginn mitten in der Woche', () => {
        const list = occ(cal(['UID:bd', 'DTSTART;TZID=Europe/Vienna:20261104T190000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261116T235959Z', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(list), ['2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16']);
        assert.ok(list.every((o) => local(o.start).endsWith(' 19:00')));
    });

    it('WKST verändert INTERVAL-Serien (Beispiel aus RFC 5545)', () => {
        const base = ['DTSTART;TZID=America/New_York:19970805T090000', 'SUMMARY:x'];
        const mo = occ(cal(['UID:w1', ...base, 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO']), '1997-01-01', '1998-01-01');
        const su = occ(cal(['UID:w2', ...base, 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU']), '1997-01-01', '1998-01-01');
        const ny = (o) => new Date(o.start - 4 * 3600000).toISOString().slice(0, 16);   // EDT = UTC-4
        assert.deepEqual(mo.map(ny), ['1997-08-05T09:00', '1997-08-10T09:00', '1997-08-19T09:00', '1997-08-24T09:00']);
        assert.deepEqual(su.map(ny), ['1997-08-05T09:00', '1997-08-17T09:00', '1997-08-19T09:00', '1997-08-31T09:00']);
    });

    it('MONTHLY BYDAY=-1FR (letzter Freitag)', () => {
        const list = occ(cal(['UID:m1', 'DTSTART;TZID=Europe/Vienna:20260130T200000', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=12', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(list), ['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29', '2026-06-26',
            '2026-07-31', '2026-08-28', '2026-09-25', '2026-10-30', '2026-11-27', '2026-12-25']);
        assert.ok(list.every((o) => local(o.start).endsWith(' 20:00')));
    });

    it('MONTHLY BYDAY mit Ordinalzahl (+2TU) und fehlendem 5. Wochentag', () => {
        const a = occ(cal(['UID:m2', 'DTSTART;TZID=Europe/Vienna:20261013T190000', 'RRULE:FREQ=MONTHLY;BYDAY=+2TU;COUNT=3', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(a), ['2026-10-13', '2026-11-10', '2026-12-08']);
        const b = occ(cal(['UID:m3', 'DTSTART;TZID=Europe/Vienna:20261030T190000', 'RRULE:FREQ=MONTHLY;BYDAY=5FR;COUNT=3', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(b), ['2026-10-30', '2027-01-29', '2027-04-30']);
    });

    it('MONTHLY BYMONTHDAY=31 überspringt Monate ohne 31. (auch ohne BYMONTHDAY)', () => {
        const expected = ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31', '2026-10-31', '2026-12-31'];
        const a = occ(cal(['UID:m31', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=31;UNTIL=20261231', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(a), expected);
        const b = occ(cal(['UID:m31b', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY;UNTIL=20261231', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(b), expected);
        const c = occ(cal(['UID:mlast', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(c), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });

    it('YEARLY mit BYMONTH + BYDAY', () => {
        const a = occ(cal(['UID:y1', 'DTSTART;TZID=Europe/Vienna:20251026T110000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'SUMMARY:x']), '2025-01-01', '2029-01-01');
        assert.deepEqual(days(a), ['2025-10-26', '2026-10-25', '2027-10-31', '2028-10-29']);
        assert.ok(a.every((o) => local(o.start).endsWith(' 11:00')));
        const b = occ(cal(['UID:y2', 'DTSTART;TZID=Europe/Vienna:20261205T190000', 'RRULE:FREQ=YEARLY;BYMONTH=12;BYDAY=1SA;COUNT=3', 'SUMMARY:x']), '2026-01-01', '2030-01-01');
        assert.deepEqual(days(b), ['2026-12-05', '2027-12-04', '2028-12-02']);
        const c = occ(cal(['UID:y3', 'DTSTART;VALUE=DATE:20260301', 'RRULE:FREQ=YEARLY;BYMONTH=3,6;COUNT=4', 'SUMMARY:x']), '2026-01-01', '2030-01-01');
        assert.deepEqual(days(c), ['2026-03-01', '2026-06-01', '2027-03-01', '2027-06-01']);
    });

    it('YEARLY am 29. Februar nur in Schaltjahren', () => {
        const list = occ(cal(['UID:leap', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY', 'SUMMARY:x']), '2024-01-01', '2033-01-01');
        assert.deepEqual(days(list), ['2024-02-29', '2028-02-29', '2032-02-29']);
    });

    it('lange laufende Serien liefern auch Jahre später noch Termine', () => {
        const daily = occ(cal(['UID:d', 'DTSTART;TZID=Europe/Vienna:20200101T190000', 'DTEND;TZID=Europe/Vienna:20200101T200000', 'RRULE:FREQ=DAILY', 'SUMMARY:Heimbar']),
            '2026-11-01T00:00:00Z', '2026-11-08T00:00:00Z');
        assert.deepEqual(days(daily), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
        assert.ok(daily.every((o) => local(o.start).endsWith(' 19:00')));

        const weekly = occ(cal(['UID:w', 'DTSTART;TZID=Europe/Vienna:19950103T190000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Stammtisch']), '2026-11-01', '2026-12-01');
        assert.deepEqual(days(weekly), ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);

        const workdays = occ(cal(['UID:wd', 'DTSTART;TZID=Europe/Vienna:20200106T080000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'SUMMARY:Büro']), '2026-11-02', '2026-11-07');
        assert.equal(workdays.length, 5);

        const monthly = occ(cal(['UID:m', 'DTSTART;TZID=Europe/Vienna:18700115T190000', 'RRULE:FREQ=MONTHLY;INTERVAL=3', 'SUMMARY:Quartal']), '2026-01-01', '2027-01-01');
        assert.deepEqual(days(monthly), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
    });

    it('lange Serie mit COUNT: die Zählung beginnt beim ersten Termin', () => {
        // Dienstag, 2. 1. 1990 + 1599 Wochen = letzter (1600.) Termin
        const last = new Date(Date.UTC(1990, 0, 2) + 1599 * 7 * DAY).toISOString().slice(0, 10);
        const text = cal(['UID:cnt', 'DTSTART;TZID=Europe/Vienna:19900102T190000', 'RRULE:FREQ=WEEKLY;COUNT=1600', 'SUMMARY:x']);
        const from = new Date(Date.parse(last) - 15 * DAY).toISOString();
        const list = occ(text, from, new Date(Date.parse(last) + 30 * DAY).toISOString());
        assert.equal(days(list).pop(), last);
        assert.equal(list.length, 3);
    });

    it('EXDATE in UTC, als Liste, ohne TZID (floating) und als ganzer Tag', () => {
        const base = ['DTSTART;TZID=Europe/Vienna:20261103T190000', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:x'];
        const a = occ(cal(['UID:e1', ...base, 'EXDATE:20261110T180000Z,20261117T180000Z']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(a), ['2026-11-03', '2026-11-24']);
        const b = occ(cal(['UID:e2', ...base, 'EXDATE:20261110T190000']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(b), ['2026-11-03', '2026-11-17', '2026-11-24']);
        const c = occ(cal(['UID:e3', ...base, 'EXDATE;VALUE=DATE:20261110']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(c), ['2026-11-03', '2026-11-17', '2026-11-24']);
        const d = occ(cal(['UID:e4', 'DTSTART;VALUE=DATE:20261107', 'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE;VALUE=DATE:20261108', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(days(d), ['2026-11-07', '2026-11-09']);
        const e = occ(cal(['UID:e5', ...base, 'EXDATE;TZID=Europe/Vienna:20261110T200000']), '2026-01-01', '2028-01-01');   // falsche Uhrzeit → kein Treffer
        assert.equal(e.length, 4);
    });

    it('unbekannte Frequenz oder RRULE ohne FREQ → nur Einzeltermin', () => {
        assert.equal(occ(cal(['UID:f1', 'DTSTART:20261110T180000Z', 'RRULE:FREQ=HOURLY;COUNT=5', 'SUMMARY:x']), '2026-01-01', '2028-01-01').length, 1);
        assert.equal(occ(cal(['UID:f2', 'DTSTART:20261110T180000Z', 'RRULE:COUNT=5', 'SUMMARY:x']), '2026-01-01', '2028-01-01').length, 1);
    });

    it('expandRule liefert Wanduhr-Objekte und hält Fenster und COUNT ein', () => {
        const start = { allDay: false, w: { y: 2026, mo: 11, d: 1, h: 19, mi: 0, s: 0 }, utc: false, tz: 'Europe/Vienna' };
        const three = T.expandRule(start, T.parseRRule('FREQ=DAILY;COUNT=3'), ms('2030-01-01'));
        assert.deepEqual(three, [
            { y: 2026, mo: 11, d: 1, h: 19, mi: 0, s: 0 }, { y: 2026, mo: 11, d: 2, h: 19, mi: 0, s: 0 }, { y: 2026, mo: 11, d: 3, h: 19, mi: 0, s: 0 }
        ]);
        const end = ms('2026-11-06T00:00:00Z');
        const open = T.expandRule(start, T.parseRRule('FREQ=DAILY'), end);
        assert.ok(open.length >= 5 && open.length <= 8, 'endet kurz nach dem Fensterende: ' + open.length);
        // Fensterbeginn: frühere Termine zählen für COUNT, werden aber nicht geliefert
        const late = T.expandRule(start, T.parseRRule('FREQ=DAILY;COUNT=10'), ms('2030-01-01'), ms('2026-11-08T00:00:00Z'));
        assert.deepEqual(late[late.length - 1], { y: 2026, mo: 11, d: 10, h: 19, mi: 0, s: 0 });
        assert.ok(late.length < 10 && late.length >= 3);
        assert.ok(late.every((w) => Date.UTC(w.y, w.mo - 1, w.d) >= ms('2026-11-05T00:00:00Z')));
    });
});

describe('Geänderte und abgesagte Einzeltermine', () => {
    it('RECURRENCE-ID verschiebt einen Termin, STATUS:CANCELLED streicht einen (Reihenfolge egal)', () => {
        const text = cal(
            ['UID:r@google.com', 'RECURRENCE-ID:20261117T180000Z', 'DTSTART;TZID=Europe/Vienna:20261117T190000', 'STATUS:CANCELLED', 'SUMMARY:Chorprobe'],
            ['UID:r@google.com', 'RECURRENCE-ID;TZID=Europe/Vienna:20261110T190000', 'DTSTART;TZID=Europe/Vienna:20261112T180000',
                'DTEND;TZID=Europe/Vienna:20261112T200000', 'SUMMARY:Chorprobe (verschoben)', 'LOCATION:Aula'],
            ['UID:r@google.com', 'DTSTART;TZID=Europe/Vienna:20261103T190000', 'DTEND;TZID=Europe/Vienna:20261103T223000',
                'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Chorprobe', 'LOCATION:Gothenhaus']
        );
        const list = occ(text, '2026-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => [local(o.start), local(o.end), o.title, o.location]), [
            ['2026-11-03 19:00', '2026-11-03 22:30', 'Chorprobe', 'Gothenhaus'],
            ['2026-11-12 18:00', '2026-11-12 20:00', 'Chorprobe (verschoben)', 'Aula'],
            ['2026-11-24 19:00', '2026-11-24 22:30', 'Chorprobe', 'Gothenhaus']
        ]);
    });

    it('verschobener Termin außerhalb des Fensters blendet auch das Original aus', () => {
        const text = cal(
            ['UID:r2', 'DTSTART;TZID=Europe/Vienna:20261103T190000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:x'],
            ['UID:r2', 'RECURRENCE-ID;TZID=Europe/Vienna:20261110T190000', 'DTSTART;TZID=Europe/Vienna:20270110T190000', 'SUMMARY:x (Jänner)']
        );
        const list = occ(text, '2026-11-01', '2026-12-01');
        assert.deepEqual(list.map((o) => localDay(o.start)), ['2026-11-03', '2026-11-17']);
    });

    it('RECURRENCE-ID bei ganztägigen Serien', () => {
        const text = cal(
            ['UID:r3', 'DTSTART;VALUE=DATE:20261107', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Ausflug'],
            ['UID:r3', 'RECURRENCE-ID;VALUE=DATE:20261114', 'DTSTART;VALUE=DATE:20261115', 'SUMMARY:Ausflug (Sonntag)']
        );
        assert.deepEqual(occ(text, '2026-01-01', '2028-01-01').map((o) => o.startKey + ' ' + o.title),
            ['2026-11-07 Ausflug', '2026-11-15 Ausflug (Sonntag)', '2026-11-21 Ausflug']);
    });

    it('abgesagter Einzeltermin und abgesagte Serie fehlen', () => {
        const text = cal(
            ['UID:x1', 'DTSTART:20261110T180000Z', 'STATUS:CANCELLED', 'SUMMARY:Abgesagt'],
            ['UID:x2', 'DTSTART:20261110T180000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'STATUS:CANCELLED', 'SUMMARY:Serie abgesagt'],
            ['UID:x3', 'DTSTART:20261110T180000Z', 'STATUS:CONFIRMED', 'SUMMARY:Findet statt'],
            ['UID:x4', 'DTSTART:20261111T180000Z', 'STATUS:TENTATIVE', 'SUMMARY:Vielleicht']
        );
        assert.deepEqual(occ(text, '2026-01-01', '2028-01-01').map((o) => o.title), ['Findet statt', 'Vielleicht']);
    });
});

/* ───────────────────────── Ganztägig & Dauer ───────────────────────── */

describe('Ganztägige Termine und Dauer', () => {
    it('WordPress-Kopie: mehrtägig (DTEND exklusiv), TZID, maskierte Kommas', () => {
        const list = T.buildOccurrences(T.parseICS(WORDPRESS), ms('2026-01-01'), ms('2028-01-01'));
        assert.equal(list.length, 3);
        const [kneipe, fw26, fw27] = list;

        assert.equal(kneipe.title, 'Abschlusskneipe');
        assert.equal(kneipe.allDay, false);
        assert.equal(iso(kneipe.start), '2026-07-03T17:00Z');
        assert.equal(iso(kneipe.end), '2026-07-03T21:30Z');
        assert.equal(norm(T.timeText(kneipe)), '19:00 – 23:30 Uhr');
        assert.equal(kneipe.location, 'Feyertagsstube, Leonhardstraße 27, Graz, 8010');
        assert.equal(kneipe.description, '');
        assert.equal(kneipe.url, 'https://www.gothia-graz.at/event/abschlusskneipe/');

        assert.equal(fw26.title, 'Familienwochen AS! Gothia');
        assert.equal(fw26.allDay, true);
        assert.equal(fw26.startKey, '2026-07-18');
        assert.equal(fw26.lastKey, '2026-08-02');
        assert.equal(fw26.days, 16);
        assert.equal(local(fw26.start), '2026-07-18 00:00');
        assert.equal(local(fw26.end), '2026-08-03 00:00');
        assert.equal(norm(T.timeText(fw26)), 'bis So., 2. August');
        assert.equal(fw26.location, 'Franz-Ludwig-Herzog Heim, Seestraße 64, Feld am See, 9544, Österreich');
        assert.equal(fw26.description, 'Anmeldung bis 1. Mai 2026 \nAnreise Samstag ab 15:00 Uhr, Abreise bis 10:00 Uhr am Samstag.');

        assert.equal(fw27.startKey, '2027-07-31');
        assert.equal(fw27.lastKey, '2027-08-15');
        assert.equal(norm(T.timeText(fw27)), 'bis So., 15. August');
    });

    it('eintägig: DTEND am Folgetag, fehlendes DTEND oder DTEND = DTSTART → 1 Tag', () => {
        for (const extra of [['DTEND;VALUE=DATE:20261109'], [], ['DTEND;VALUE=DATE:20261108']]) {
            const [o] = occ(cal(['UID:a', 'DTSTART;VALUE=DATE:20261108', ...extra, 'SUMMARY:Ganztags']), '2026-01-01', '2028-01-01');
            assert.equal(o.allDay, true);
            assert.equal(o.days, 1);
            assert.equal(o.startKey, '2026-11-08');
            assert.equal(o.lastKey, '2026-11-08');
            assert.equal(iso(o.start), '2026-11-07T23:00Z');
            assert.equal(iso(o.end), '2026-11-08T23:00Z');
            assert.equal(T.timeText(o), 'ganztägig');
        }
    });

    it('mehrtägig über Sommer-/Winterzeit, Monats- und Jahreswechsel', () => {
        const [a] = occ(cal(['UID:a', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261027', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual([a.days, a.lastKey, iso(a.end)], [3, '2026-10-26', '2026-10-26T23:00Z']);
        const [b] = occ(cal(['UID:b', 'DTSTART;VALUE=DATE:20270327', 'DTEND;VALUE=DATE:20270329', 'SUMMARY:x']), '2027-01-01', '2028-01-01');
        assert.deepEqual([b.days, b.lastKey, iso(b.end)], [2, '2027-03-28', '2027-03-28T22:00Z']);
        const [c] = occ(cal(['UID:c', 'DTSTART;VALUE=DATE:20261230', 'DTEND;VALUE=DATE:20270102', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual([c.days, c.lastKey], [3, '2027-01-01']);
        assert.equal(norm(T.timeText(c)), 'bis Fr., 1. Jänner');
    });

    it('Termin mit Uhrzeit ohne DTEND hat keine Dauer', () => {
        const [o] = occ(cal(['UID:t', 'DTSTART;TZID=Europe/Vienna:20261110T190000', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.equal(o.end, o.start);
        assert.equal(norm(T.timeText(o)), '19:00 Uhr');
    });

    it('DURATION statt DTEND', () => {
        const [a] = occ(cal(['UID:d1', 'DTSTART;TZID=Europe/Vienna:20261110T190000', 'DURATION:PT2H30M', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.equal(a.end - a.start, 2.5 * 3600000);
        assert.equal(norm(T.timeText(a)), '19:00 – 21:30 Uhr');
        const [b] = occ(cal(['UID:d2', 'DTSTART;VALUE=DATE:20261101', 'DURATION:P3D', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual([b.days, b.lastKey, norm(T.timeText(b))], [3, '2026-11-03', 'bis Di., 3. November']);
        const [c] = occ(cal(['UID:d3', 'DTSTART:20261110T180000Z', 'DURATION:P1W', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.equal(c.end - c.start, 7 * DAY);
        const [d] = occ(cal(['UID:d4', 'DTSTART:20261110T180000Z', 'DURATION:kaputt', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.equal(d.end, d.start);
        const list = occ(cal(['UID:d5', 'DTSTART;TZID=Europe/Vienna:20261020T190000', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:x']), '2026-01-01', '2028-01-01');
        assert.deepEqual(list.map((o) => local(o.end)), ['2026-10-20 20:00', '2026-10-27 20:00']);
    });
});

/* ───────────────────────── Fenster & Sortierung ───────────────────────── */

describe('Zeitfenster und Sortierung', () => {
    it('laufende Termine bleiben drin, vergangene und zu späte fallen weg', () => {
        const text = cal(
            ['UID:1', 'DTSTART;TZID=Europe/Vienna:20261101T100000', 'DTEND;TZID=Europe/Vienna:20261101T140000', 'SUMMARY:Läuft gerade'],
            ['UID:2', 'DTSTART;TZID=Europe/Vienna:20261101T080000', 'DTEND;TZID=Europe/Vienna:20261101T120000', 'SUMMARY:Endet genau jetzt'],
            ['UID:3', 'DTSTART;TZID=Europe/Vienna:20261031T190000', 'SUMMARY:Gestern'],
            ['UID:4', 'DTSTART;VALUE=DATE:20261030', 'DTEND;VALUE=DATE:20261103', 'SUMMARY:Mehrtägig, läuft'],
            ['UID:5', 'DTSTART;VALUE=DATE:20261101', 'SUMMARY:Heute ganztägig'],
            ['UID:6', 'DTSTART;VALUE=DATE:20261031', 'SUMMARY:Gestern ganztägig'],
            ['UID:7', 'DTSTART:20261108T110000Z', 'SUMMARY:Beginnt genau am Fensterende'],
            ['UID:8', 'DTSTART:20261108T105959Z', 'SUMMARY:Knapp davor'],
            ['UID:9', 'DTSTART;TZID=Europe/Vienna:20261020T110000', 'DTEND;TZID=Europe/Vienna:20261020T130000', 'RRULE:FREQ=DAILY', 'SUMMARY:Täglich'],
            ['UID:10', 'DTSTART;VALUE=DATE:20261023', 'DTEND;VALUE=DATE:20261027', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Wöchentlich mehrtägig']
        );
        const now = '2026-11-01T11:00:00Z';   // 12:00 in Wien
        const list = occ(text, now, '2026-11-08T11:00:00Z');
        const titles = list.map((o) => o.title);
        for (const t of ['Läuft gerade', 'Mehrtägig, läuft', 'Heute ganztägig', 'Knapp davor']) assert.ok(titles.includes(t), t);
        for (const t of ['Endet genau jetzt', 'Gestern', 'Gestern ganztägig', 'Beginnt genau am Fensterende']) assert.ok(!titles.includes(t), t);
        // Serien: das gerade laufende Vorkommen (11–13 Uhr) ist dabei, ebenso das laufende mehrtägige
        const daily = list.filter((o) => o.title === 'Täglich').map((o) => local(o.start));
        assert.equal(daily[0], '2026-11-01 11:00');
        assert.equal(daily.length, 8);
        assert.deepEqual(list.filter((o) => o.title === 'Wöchentlich mehrtägig').map((o) => o.startKey), ['2026-10-30', '2026-11-06']);
    });

    it('sortiert nach Beginn, dann Titel (deutsch), ganztägig vor Uhrzeit', () => {
        const text = cal(
            ['UID:a', 'DTSTART;TZID=Europe/Vienna:20261110T190000', 'SUMMARY:Zeta'],
            ['UID:b', 'DTSTART;TZID=Europe/Vienna:20261110T190000', 'SUMMARY:Ölfest'],
            ['UID:c', 'DTSTART;TZID=Europe/Vienna:20261110T190000', 'SUMMARY:Alpha'],
            ['UID:d', 'DTSTART;VALUE=DATE:20261110', 'SUMMARY:Ganztags'],
            ['UID:e', 'DTSTART:20261110T170000Z', 'SUMMARY:Früher (UTC)'],
            ['UID:f', 'DTSTART;TZID=Europe/Vienna:20261109T190000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Serie']
        );
        assert.deepEqual(occ(text, '2026-01-01', '2028-01-01').map((o) => o.title),
            ['Serie', 'Ganztags', 'Früher (UTC)', 'Alpha', 'Ölfest', 'Serie', 'Zeta', 'Serie']);
    });

    it('Google-Feed: Gesamtliste, nächster öffentlicher Termin, Vergangenes fällt weg', () => {
        const events = T.parseICS(GCAL);
        assert.equal(events.length, 19);
        assert.ok(events.every((e) => /@google\.com$/.test(e.uid)));
        const chor = events.find((e) => e.summary === 'Chorprobe');
        assert.equal(chor.rrule.freq, 'WEEKLY');
        assert.equal(chor.exdates.length, 2);

        const all = T.buildOccurrences(events, ms('2026-10-01'), ms('2027-03-01'));
        assert.equal(all.length, 18 + 7);
        for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].start <= all[i].start, 'sortiert');

        const now = ms('2026-11-01T11:06:55Z');
        const upcoming = T.buildOccurrences(events, now, now + 366 * DAY);
        assert.ok(!upcoming.some((o) => o.title === 'Gräberbummel' || o.title === 'Herbstfest'));
        assert.equal(upcoming[0].title, 'Burschenconvent');
        const pub = upcoming.filter((o) => { const t = T.tagOf(o.title); return !(t && t.label === 'Convent'); });
        assert.equal(pub[0].title, 'Liederabend');
        assert.equal(local(pub[0].start), '2026-11-03 20:00');
        assert.equal(upcoming[upcoming.length - 1].title, 'Abschlussconvent');
    });

    it('LF statt CRLF im Feed ergibt dasselbe', () => {
        const a = T.buildOccurrences(T.parseICS(GCAL), ms('2026-10-01'), ms('2027-03-01'));
        const b = T.buildOccurrences(T.parseICS(GCAL.replace(/\r\n/g, '\n')), ms('2026-10-01'), ms('2027-03-01'));
        assert.deepEqual(a, b);
    });

    it('Offline-Kopie in index.html (#ics-fallback) ist lesbar', (t) => {
        const file = path.join(__dirname, '..', 'index.html');
        const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const m = /<script[^>]*id="ics-fallback"[^>]*>([\s\S]*?)<\/script>/.exec(html);
        if (!m) { t.skip('keine Offline-Kopie in index.html'); return; }
        assert.match(m[1], /^\s*BEGIN:VCALENDAR/);
        const events = T.parseICS(m[1]);
        assert.ok(events.length > 0);
        assert.ok(events.every((e) => e.summary && e.start));
    });
});

/* ───────────────────────── timeText ───────────────────────── */

describe('timeText', () => {
    const one = (lines) => occ(cal(['UID:t', ...lines, 'SUMMARY:x']), '2026-01-01', '2028-01-01')[0];

    it('Uhrzeiten am selben Tag, bis Mitternacht, über Mitternacht', () => {
        assert.equal(norm(T.timeText(one(['DTSTART:20261207T203000Z', 'DTEND:20261207T225500Z']))), '21:30 – 23:55 Uhr');
        assert.equal(norm(T.timeText(one(['DTSTART;TZID=Europe/Vienna:20261110T200000', 'DTEND;TZID=Europe/Vienna:20261111T000000']))), '20:00 – 00:00 Uhr');
        assert.equal(norm(T.timeText(one(['DTSTART;TZID=Europe/Vienna:20261110T220000', 'DTEND;TZID=Europe/Vienna:20261111T020000']))),
            '22:00 Uhr – Mi., 11. Nov., 02:00 Uhr');
        assert.equal(norm(T.timeText(one(['DTSTART;TZID=Europe/Vienna:20261110T090500']))), '09:05 Uhr');
    });

    it('ganztägig und mehrtägig', () => {
        assert.equal(T.timeText(one(['DTSTART;VALUE=DATE:20261224'])), 'ganztägig');
        assert.equal(norm(T.timeText(one(['DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261227']))), 'bis Sa., 26. Dezember');
    });
});

/* ───────────────────────── singleIcs ───────────────────────── */

describe('singleIcs („Zum Kalender hinzufügen“)', () => {
    const physicalLines = (s) => s.slice(0, -2).split('\r\n');
    const prop = (s, name) => unfoldIcs(s).split('\r\n').filter((l) => l.split(/[;:]/)[0] === name);

    function assertValid(s) {
        assert.ok(s.endsWith('END:VCALENDAR\r\n'), 'endet mit END:VCALENDAR + CRLF');
        assert.ok(s.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'), 'beginnt korrekt');
        assert.ok(!/\r(?!\n)|(?<!\r)\n/.test(s), 'nur CRLF-Zeilenenden');
        for (const l of physicalLines(s)) {
            assert.ok(Buffer.byteLength(l, 'utf8') <= 75, 'Zeile ≤ 75 Oktette: ' + l);
            assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l), 'kein zerteiltes Zeichen');
        }
        const names = unfoldIcs(s).split('\r\n').filter(Boolean).map((l) => l.split(/[;:]/)[0]);
        assert.deepEqual(names.filter((n) => n === 'BEGIN' || n === 'END'), ['BEGIN', 'BEGIN', 'END', 'END']);
        for (const req of ['PRODID', 'UID', 'DTSTAMP', 'DTSTART', 'SUMMARY']) assert.equal(names.filter((n) => n === req).length, 1, req);
        assert.match(prop(s, 'DTSTAMP')[0], /^DTSTAMP:\d{8}T\d{6}Z$/);
    }

    it('Termin mit Uhrzeit: UTC-Zeiten, maskierter Text, Rundreise über parseICS', () => {
        const [ev] = occ(cal([
            'UID:abc@google.com', 'DTSTART;TZID=Europe/Vienna:20261110T190000', 'DTEND;TZID=Europe/Vienna:20261110T223000',
            'SUMMARY:Kneipe\\, Bier\\; Gesang \\\\ mehr', 'LOCATION:Gothenhaus\\, Graz',
            'DESCRIPTION:Erste Zeile\\nZweite Zeile mit Komma\\, Strichpunkt\\; und Backslash \\\\n'
        ]), '2026-01-01', '2028-01-01');
        const s = T.singleIcs(ev);
        assertValid(s);
        assert.deepEqual(prop(s, 'DTSTART'), ['DTSTART:20261110T180000Z']);
        assert.deepEqual(prop(s, 'DTEND'), ['DTEND:20261110T213000Z']);
        assert.deepEqual(prop(s, 'SUMMARY'), ['SUMMARY:Kneipe\\, Bier\\; Gesang \\\\ mehr']);
        assert.deepEqual(prop(s, 'LOCATION'), ['LOCATION:Gothenhaus\\, Graz']);
        assert.deepEqual(prop(s, 'DESCRIPTION'), ['DESCRIPTION:Erste Zeile\\nZweite Zeile mit Komma\\, Strichpunkt\\; und Backslash \\\\n']);
        assert.match(prop(s, 'UID')[0], /^UID:abc-\d+@gothia-graz\.at$/);

        const [back] = T.buildOccurrences(T.parseICS(s), 0, ms('2100-01-01'));
        for (const k of ['title', 'location', 'description', 'start', 'end', 'allDay']) assert.deepEqual(back[k], ev[k], k);
    });

    it('Termin ohne Dauer hat kein DTEND; ohne Ort/Beschreibung keine leeren Zeilen', () => {
        const [ev] = occ(cal(['DTSTART:20261110T180000Z', 'SUMMARY:Kurz']), '2026-01-01', '2028-01-01');
        const s = T.singleIcs(ev);
        assertValid(s);
        assert.deepEqual(prop(s, 'DTEND'), []);
        assert.deepEqual(prop(s, 'LOCATION'), []);
        assert.deepEqual(prop(s, 'DESCRIPTION'), []);
        assert.match(prop(s, 'UID')[0], /^UID:gothia-\d+@gothia-graz\.at$/);
    });

    it('ganztägig: DTEND ist exklusiv (Tag nach dem letzten Tag)', () => {
        const cases = [
            [['DTSTART;VALUE=DATE:20261108'], '20261108', '20261109'],
            [['DTSTART;VALUE=DATE:20261230', 'DTEND;VALUE=DATE:20270102'], '20261230', '20270102'],
            [['DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261027'], '20261024', '20261027'],
            [['DTSTART;VALUE=DATE:20280228', 'DTEND;VALUE=DATE:20280301'], '20280228', '20280301']
        ];
        for (const [lines, s0, e0] of cases) {
            const [ev] = occ(cal(['UID:ad', ...lines, 'SUMMARY:Ganztags']), '2026-01-01', '2030-01-01');
            const s = T.singleIcs(ev);
            assertValid(s);
            assert.deepEqual(prop(s, 'DTSTART'), ['DTSTART;VALUE=DATE:' + s0]);
            assert.deepEqual(prop(s, 'DTEND'), ['DTEND;VALUE=DATE:' + e0]);
            const [back] = T.buildOccurrences(T.parseICS(s), 0, ms('2100-01-01'));
            assert.deepEqual([back.startKey, back.lastKey, back.days], [ev.startKey, ev.lastKey, ev.days]);
        }
        const fw = T.buildOccurrences(T.parseICS(WORDPRESS), ms('2026-01-01'), ms('2028-01-01'))[1];
        const s = T.singleIcs(fw);
        assert.deepEqual(prop(s, 'DTSTART'), ['DTSTART;VALUE=DATE:20260718']);
        assert.deepEqual(prop(s, 'DTEND'), ['DTEND;VALUE=DATE:20260803']);
    });

    it('lange Zeilen werden gefaltet, ohne Umlaute oder Emojis zu zerteilen', () => {
        const desc = 'Grüße aus dem Gothenhaus 🎶 '.repeat(12) + 'Ende';
        const ev = {
            uid: 'lang', title: 'Weihnachtsfeier mit Krambambuli, Glühwein und Gesang für alle Bundesbrüder und Gäste',
            description: desc, location: 'Studentenheim Gothenhaus, Leonhardstraße 27, 8010 Graz',
            allDay: false, start: ms('2026-12-19T18:00:00Z'), end: ms('2026-12-19T22:55:00Z')
        };
        const s = T.singleIcs(ev);
        assertValid(s);
        assert.ok(physicalLines(s).length > 12, 'wurde gefaltet');
        const [back] = T.parseICS(s);
        assert.equal(back.description, desc.trim());
        assert.equal(back.summary, ev.title);
        assert.equal(back.location, ev.location);
    });

    it('Zeilenumbrüche mit CR werden maskiert', () => {
        const s = T.singleIcs({ uid: 'cr', title: 'a\r\nb\rc', allDay: false, start: 0, end: 0 });
        assertValid(s);
        assert.deepEqual(prop(s, 'SUMMARY'), ['SUMMARY:a\\nb\\nc']);
    });
});

/* ───────────────────────── tagOf ───────────────────────── */

describe('tagOf', () => {
    const label = (t) => { const r = T.tagOf(t); return r ? r.label : null; };
    const cases = {
        Convent: ['Burschenconvent', 'Antrittsconvent', 'Abschlussconvent', 'Generalconvent'],
        Musik: ['Chorprobe', 'Erste reguläre Chorprobe', 'Liederabend', 'Liederabend mit Krambabuli', 'Messeumrahmung Stiftskirche Rein bei Graz',
            'Adventsingen', 'Konzert im Stefaniensaal', 'Sängerschaftlicher Abend'],
        Geselligkeit: ['Herbstfest', 'Weihnachtsfeier', 'Gothensilvester', 'Akademiker Ball im Congress', 'Antrittskneipe', 'Abschlusskneipe',
            'Krambambulifest mit dem ATV Graz und der F! Wieland-Staufen', 'Festkommers', 'Fest', 'Weinprobe', 'Bierverkostung'],
        none: ['Gräberbummel', 'Totengedenkfeier', 'Gedenkfeier am Zentralfriedhof', 'Familienwochen AS! Gothia', 'Hüttenwochenende', 'Festakt', '']
    };
    for (const [expected, titles] of Object.entries(cases)) {
        for (const title of titles) {
            it(`„${title}“ → ${expected}`, () => assert.equal(label(title), expected === 'none' ? null : expected));
        }
    }

    it('liefert die CSS-Klassen des Designs', () => {
        assert.deepEqual(T.tagOf('Burschenconvent'), { label: 'Convent', cls: 'event-tag--muted' });
        assert.deepEqual(T.tagOf('Chorprobe'), { label: 'Musik', cls: 'event-tag--gold' });
        assert.deepEqual(T.tagOf('Herbstfest'), { label: 'Geselligkeit', cls: '' });
    });
});
