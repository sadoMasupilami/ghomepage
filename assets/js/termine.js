/*
 * Gothia — Termine
 * Liest den Kalender (iCalendar/.ics) über calendar.php (Proxy für den Google-Kalender
 * „Veranstaltungen AS! Gothia“) und zeigt die kommenden Termine an.
 * Kein externes Skript, keine Verbindung zu Dritten.
 *
 * Unterstützt: ganztägige & mehrtägige Termine, Zeitzonen (TZID / UTC),
 * Serientermine (RRULE: DAILY/WEEKLY/MONTHLY/YEARLY mit INTERVAL, COUNT, UNTIL, BYDAY,
 * BYMONTHDAY, BYMONTH), Ausnahmen (EXDATE), geänderte Einzeltermine (RECURRENCE-ID)
 * und abgesagte Termine (STATUS:CANCELLED).
 */
(function (root) {
    'use strict';

    var TZ = 'Europe/Vienna';
    var DAY = 86400000;
    var WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

    /* ───────────────────────── Parser ───────────────────────── */

    function unfold(text) {
        return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
    }

    function parseLine(line) {
        var inQ = false, colon = -1;
        for (var i = 0; i < line.length; i++) {
            var c = line.charAt(i);
            if (c === '"') inQ = !inQ;
            else if (c === ':' && !inQ) { colon = i; break; }
        }
        if (colon < 0) return null;
        var head = line.slice(0, colon);
        var parts = head.split(';');
        var params = {};
        for (var k = 1; k < parts.length; k++) {
            var eq = parts[k].indexOf('=');
            if (eq > 0) params[parts[k].slice(0, eq).toUpperCase()] = parts[k].slice(eq + 1).replace(/^"|"$/g, '');
        }
        return { name: parts[0].toUpperCase(), params: params, value: line.slice(colon + 1) };
    }

    function unescapeText(v) {
        return String(v)
            .replace(/\\\\/g, '\u0000')
            .replace(/\\n/gi, '\n')
            .replace(/\\([,;:"])/g, '$1')
            .replace(/\u0000/g, '\\');
    }

    // Google liefert Beschreibungen teils mit HTML — hier zu reinem Text machen.
    function plainText(v) {
        return String(v || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /* ── Zeitzonen ── */
    var dtfCache = {};
    function validTz(tz) {
        if (!tz) return TZ;
        if (dtfCache[tz] !== undefined) return dtfCache[tz] ? tz : TZ;
        try {
            dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
                timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            return tz;
        } catch (e) { dtfCache[tz] = null; return TZ; }
    }
    function tzOffset(tz, ms) {
        var f = dtfCache[validTz(tz)];
        var p = {};
        f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
    }
    // Wanduhrzeit in einer Zone → Zeitpunkt (ms)
    function wallToInstant(w, tz) {
        tz = validTz(tz);
        var guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
        var off = tzOffset(tz, guess);
        var t = guess - off;
        var off2 = tzOffset(tz, t);
        return off2 === off ? t : guess - off2;
    }
    // Zeitpunkt → Kalenderdatum in Wien (YYYY-MM-DD)
    function dayKeyOfInstant(ms) {
        var w = new Date(ms + tzOffset(TZ, ms));
        return w.getUTCFullYear() + '-' + pad(w.getUTCMonth() + 1) + '-' + pad(w.getUTCDate());
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    /* ── Datumswerte ── */
    function parseDate(value, params) {
        var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
        if (!m) return null;
        var allDay = (params && params.VALUE === 'DATE') || !m[4];
        return {
            allDay: allDay,
            w: { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) },
            utc: !!m[7],
            tz: params && params.TZID ? params.TZID : null
        };
    }
    function dateToMs(dt) {
        if (dt.allDay) return wallToInstant({ y: dt.w.y, mo: dt.w.mo, d: dt.w.d, h: 0, mi: 0, s: 0 }, TZ);
        if (dt.utc) return Date.UTC(dt.w.y, dt.w.mo - 1, dt.w.d, dt.w.h, dt.w.mi, dt.w.s);
        return wallToInstant(dt.w, dt.tz || TZ);
    }
    function dayKey(w) { return w.y + '-' + pad(w.mo) + '-' + pad(w.d); }

    function parseDuration(v) {
        var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim());
        if (!m) return null;
        var ms = ((+m[2] || 0) * 7 * DAY) + ((+m[3] || 0) * DAY) + ((+m[4] || 0) * 3600000) + ((+m[5] || 0) * 60000) + ((+m[6] || 0) * 1000);
        return m[1] === '-' ? -ms : ms;
    }

    function parseRRule(v) {
        var r = {};
        String(v).split(';').forEach(function (part) {
            var eq = part.indexOf('=');
            if (eq > 0) r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
        });
        return {
            freq: r.FREQ,
            interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
            count: r.COUNT ? parseInt(r.COUNT, 10) : null,
            until: r.UNTIL ? parseDate(r.UNTIL, {}) : null,
            byday: r.BYDAY ? r.BYDAY.split(',').map(function (s) {
                var mm = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(s.trim().toUpperCase());
                return mm ? { n: mm[1] ? parseInt(mm[1], 10) : 0, wd: WD.indexOf(mm[2]) } : null;
            }).filter(Boolean) : null,
            bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(function (s) { return parseInt(s, 10); }) : null,
            bymonth: r.BYMONTH ? r.BYMONTH.split(',').map(function (s) { return parseInt(s, 10); }) : null
        };
    }

    function parseICS(text) {
        var lines = unfold(text).split('\n');
        var events = [], cur = null, depth = 0;
        lines.forEach(function (raw) {
            if (!raw) return;
            var p = parseLine(raw);
            if (!p) return;
            if (p.name === 'BEGIN') {
                if (p.value.toUpperCase() === 'VEVENT' && !cur) { cur = { exdates: [], rrule: null }; depth = 0; }
                else if (cur) depth++;           // z. B. VALARM innerhalb des Termins
                return;
            }
            if (p.name === 'END') {
                if (cur && depth > 0) { depth--; return; }
                if (cur && p.value.toUpperCase() === 'VEVENT') { events.push(cur); cur = null; }
                return;
            }
            if (!cur || depth > 0) return;
            switch (p.name) {
                case 'UID': cur.uid = p.value.trim(); break;
                case 'SUMMARY': cur.summary = unescapeText(p.value).trim(); break;
                case 'DESCRIPTION': cur.description = plainText(unescapeText(p.value)); break;
                case 'LOCATION': cur.location = unescapeText(p.value).trim(); break;
                case 'URL': cur.url = p.value.trim(); break;
                case 'STATUS': cur.status = p.value.trim().toUpperCase(); break;
                case 'DTSTART': cur.start = parseDate(p.value, p.params); break;
                case 'DTEND': cur.end = parseDate(p.value, p.params); break;
                case 'DURATION': cur.duration = parseDuration(p.value); break;
                case 'RRULE': cur.rrule = parseRRule(p.value); break;
                case 'RECURRENCE-ID': cur.recurrenceId = parseDate(p.value, p.params); break;
                case 'EXDATE':
                    p.value.split(',').forEach(function (v) {
                        var d = parseDate(v, p.params);
                        if (d) cur.exdates.push(d);
                    });
                    break;
            }
        });
        return events.filter(function (e) { return e.start; });
    }

    /* ───────────────────── Serientermine ───────────────────── */

    // „Wanduhr“-Arithmetik über UTC-Datumsobjekte (zeitzonenneutral)
    function wallMs(w) { return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s); }
    function msWall(ms) {
        var d = new Date(ms);
        return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
    }
    function daysInMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }

    // Alle Tage eines Monats, die zu BYDAY (inkl. Ordinalzahl) / BYMONTHDAY passen
    function monthDays(y, mo, rule, fallbackDay) {
        var dim = daysInMonth(y, mo), out = [];
        if (rule.byday && rule.byday.length) {
            rule.byday.forEach(function (b) {
                var matches = [];
                for (var d = 1; d <= dim; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === b.wd) matches.push(d);
                if (b.n === 0) out = out.concat(matches);
                else {
                    var idx = b.n > 0 ? b.n - 1 : matches.length + b.n;
                    if (matches[idx]) out.push(matches[idx]);
                }
            });
            if (rule.bymonthday) out = out.filter(function (d) { return rule.bymonthday.some(function (md) { return (md > 0 ? md : dim + md + 1) === d; }); });
        } else if (rule.bymonthday && rule.bymonthday.length) {
            rule.bymonthday.forEach(function (md) { var d = md > 0 ? md : dim + md + 1; if (d >= 1 && d <= dim) out.push(d); });
        } else if (fallbackDay <= dim) {
            out.push(fallbackDay);
        }
        return out.sort(function (a, b) { return a - b; }).filter(function (d, i, a) { return a.indexOf(d) === i; });
    }

    // Liefert die Startzeitpunkte (als Wanduhr-Objekte) aller Vorkommen bis windowEnd
    function expandRule(start, rule, windowEndMs) {
        var out = [];
        var s = start.w;
        var startWall = wallMs(s);
        var tz = start.allDay ? TZ : (start.utc ? 'UTC' : (start.tz || TZ));
        var untilMs = null;
        if (rule.until) {
            if (rule.until.allDay) untilMs = wallMs({ y: rule.until.w.y, mo: rule.until.w.mo, d: rule.until.w.d, h: 23, mi: 59, s: 59 });
            else {
                // UNTIL ist (meist) UTC → in die Wanduhr der Terminzone umrechnen
                var uInst = rule.until.utc ? dateToMs(rule.until) : wallToInstant(rule.until.w, rule.until.tz || tz);
                untilMs = tz === 'UTC' ? uInst : uInst + tzOffset(tz, uInst);
            }
        }
        var MAX = 1500, n = 0, guard = 0;
        function push(w) {
            var ms = wallMs(w);
            if (ms < startWall) return true;
            if (untilMs !== null && ms > untilMs) return false;
            if (rule.count !== null && n >= rule.count) return false;
            if (ms > windowEndMs + 2 * DAY) return false;
            n++; out.push(w);
            return n < MAX;
        }
        var t = { h: s.h, mi: s.mi, s: s.s };
        var go = true;
        if (rule.freq === 'DAILY') {
            for (var i = 0; go && guard++ < 20000; i += rule.interval) {
                var w = msWall(startWall + i * DAY);
                if (rule.bymonth && rule.bymonth.indexOf(w.mo) < 0) continue;
                if (rule.byday && rule.byday.length && !rule.byday.some(function (b) { return b.wd === new Date(wallMs(w)).getUTCDay(); })) continue;
                go = push(w);
            }
        } else if (rule.freq === 'WEEKLY') {
            var startDow = new Date(startWall).getUTCDay();
            var weekStart = startWall - ((startDow + 6) % 7) * DAY;         // Montag (WKST=MO)
            var days = rule.byday && rule.byday.length ? rule.byday.map(function (b) { return b.wd; }) : [startDow];
            days = days.map(function (d) { return (d + 6) % 7; }).sort(function (a, b) { return a - b; });   // 0 = Montag
            for (var wk = 0; go && guard++ < 5000; wk += rule.interval) {
                for (var j = 0; j < days.length && go; j++) {
                    var dw = msWall(weekStart + (wk * 7 + days[j]) * DAY);
                    dw.h = t.h; dw.mi = t.mi; dw.s = t.s;
                    if (rule.bymonth && rule.bymonth.indexOf(dw.mo) < 0) continue;
                    go = push(dw);
                }
                if (weekStart + wk * 7 * DAY > windowEndMs + 8 * DAY) break;
            }
        } else if (rule.freq === 'MONTHLY') {
            for (var mIdx = 0; go && guard++ < 3000; mIdx += rule.interval) {
                var y = s.y + Math.floor((s.mo - 1 + mIdx) / 12);
                var mo = ((s.mo - 1 + mIdx) % 12) + 1;
                if (Date.UTC(y, mo - 1, 1) > windowEndMs + 2 * DAY) break;
                if (rule.bymonth && rule.bymonth.indexOf(mo) < 0) continue;
                var md = monthDays(y, mo, rule, s.d);
                for (var q = 0; q < md.length && go; q++) go = push({ y: y, mo: mo, d: md[q], h: t.h, mi: t.mi, s: t.s });
            }
        } else if (rule.freq === 'YEARLY') {
            for (var yIdx = 0; go && guard++ < 300; yIdx += rule.interval) {
                var yy = s.y + yIdx;
                if (Date.UTC(yy, 0, 1) > windowEndMs + 2 * DAY) break;
                var months = rule.bymonth && rule.bymonth.length ? rule.bymonth.slice().sort(function (a, b) { return a - b; }) : [s.mo];
                for (var mm = 0; mm < months.length && go; mm++) {
                    var mdays = (rule.byday || rule.bymonthday) ? monthDays(yy, months[mm], rule, s.d) : (s.d <= daysInMonth(yy, months[mm]) ? [s.d] : []);
                    for (var r = 0; r < mdays.length && go; r++) go = push({ y: yy, mo: months[mm], d: mdays[r], h: t.h, mi: t.mi, s: t.s });
                }
            }
        } else {
            out.push(s);   // unbekannte Frequenz → nur Einzeltermin
        }
        return out;
    }

    /* ───────────────────── Termine aufbereiten ───────────────────── */

    function occurrenceKey(dt) { return dt.allDay ? 'D' + dayKey(dt.w) : 'T' + dateToMs(dt); }

    // Liefert sortierte Termine, die nach "fromMs" enden und vor "toMs" beginnen
    function buildOccurrences(raw, fromMs, toMs) {
        var overrides = {};
        raw.forEach(function (e) {
            if (e.recurrenceId && e.uid) overrides[e.uid + '|' + occurrenceKey(e.recurrenceId)] = true;
        });
        var out = [];
        raw.forEach(function (e) {
            if (e.status === 'CANCELLED') return;
            var start = e.start;
            var allDay = start.allDay;
            var durMs;
            if (e.end) durMs = dateToMs(e.end) - dateToMs(start);
            else if (e.duration !== null && e.duration !== undefined) durMs = e.duration;
            else durMs = allDay ? DAY : 0;
            if (allDay) durMs = Math.max(1, Math.round(durMs / DAY)) * DAY;   // in ganzen Tagen

            var starts;
            if (e.rrule && !e.recurrenceId) {
                var exKeys = {};
                e.exdates.forEach(function (x) {
                    var xd = { allDay: allDay || x.allDay, w: x.w, utc: x.utc, tz: x.tz || start.tz };
                    exKeys[occurrenceKey(xd)] = true;
                });
                starts = expandRule(start, e.rrule, toMs).map(function (w) {
                    return { allDay: allDay, w: w, utc: start.utc, tz: start.tz };
                }).filter(function (dt) {
                    var k = occurrenceKey(dt);
                    return !exKeys[k] && !(e.uid && overrides[e.uid + '|' + k]);
                });
            } else {
                starts = [start];
            }

            starts.forEach(function (dt) {
                var sMs = dateToMs(dt);
                var occ = {
                    uid: e.uid || '',
                    title: e.summary || 'Termin',
                    description: e.description || '',
                    location: e.location || '',
                    url: e.url || '',
                    allDay: allDay,
                    start: sMs,
                    end: sMs + durMs
                };
                if (allDay) {
                    var k0 = Date.UTC(dt.w.y, dt.w.mo - 1, dt.w.d);
                    occ.startKey = dayKey(dt.w);
                    occ.days = Math.round(durMs / DAY);
                    occ.lastKey = dayKey(msWall(k0 + (occ.days - 1) * DAY));
                    occ.end = wallToInstant(msWall(k0 + occ.days * DAY), TZ);
                }
                if (occ.end > fromMs && occ.start < toMs) out.push(occ);
            });
        });
        out.sort(function (a, b) { return a.start - b.start || a.title.localeCompare(b.title, 'de'); });
        return out;
    }

    /* ───────────────────── Formatierung ───────────────────── */

    var fmtCache = {};
    function fmt(opts, ms, zone) {
        var key = JSON.stringify(opts) + (zone || TZ);
        var f = fmtCache[key] || (fmtCache[key] = new Intl.DateTimeFormat('de-AT', Object.assign({ timeZone: zone || TZ }, opts)));
        return f.format(new Date(ms));
    }
    function keyMs(k) { var p = k.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2], 12); }
    function partsOf(ev) {
        var ms = ev.allDay ? keyMs(ev.startKey) : ev.start;
        var zone = ev.allDay ? 'UTC' : TZ;
        return {
            weekday: fmt({ weekday: 'short' }, ms, zone).replace('.', ''),
            day: fmt({ day: 'numeric' }, ms, zone),
            month: fmt({ month: 'short' }, ms, zone).replace('.', ''),
            monthLong: fmt({ month: 'long', year: 'numeric' }, ms, zone)
        };
    }
    function timeText(ev) {
        if (ev.allDay) {
            if (ev.days > 1) return 'bis ' + fmt({ weekday: 'short', day: 'numeric', month: 'long' }, keyMs(ev.lastKey), 'UTC');
            return 'ganztägig';
        }
        var s = fmt({ hour: '2-digit', minute: '2-digit' }, ev.start);
        if (ev.end <= ev.start) return s + ' Uhr';
        var sameDay = dayKeyOfInstant(ev.start) === dayKeyOfInstant(ev.end - 1);
        if (sameDay) return s + ' – ' + fmt({ hour: '2-digit', minute: '2-digit' }, ev.end) + ' Uhr';
        return s + ' Uhr – ' + fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, ev.end) + ' Uhr';
    }
    function shortLocation(loc) {
        // „Feyertagsstube, Leonhardstraße 27, Graz, 8010“ → bleibt; reine Länderzusätze entfernen
        return loc.replace(/,\s*(Österreich|Austria)$/i, '');
    }
    function tagOf(title) {
        if (/convent/i.test(title)) return { label: 'Convent', cls: 'event-tag--muted' };
        if (/chor|probe|lieder|konzert|messe|sänger|singen/i.test(title)) return { label: 'Musik', cls: 'event-tag--gold' };
        if (/kneipe|fest\b|fest |feier|ball|silvester|kommers/i.test(title) || /fest$/i.test(title)) return { label: 'Geselligkeit', cls: '' };
        return null;
    }

    /* ── .ics für einen einzelnen Termin („Zum Kalender hinzufügen“) ── */
    function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
    function utcStamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    function singleIcs(ev) {
        var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Akademische Saengerschaft Gothia zu Graz//Termine//DE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
            'UID:' + (ev.uid || 'gothia') + '-' + ev.start + '@gothia-graz.at',
            'DTSTAMP:' + utcStamp(Date.now())];
        if (ev.allDay) {
            lines.push('DTSTART;VALUE=DATE:' + ev.startKey.replace(/-/g, ''));
            var endKey = dayKey(msWall(keyMs(ev.lastKey) - 12 * 3600000 + DAY));
            lines.push('DTEND;VALUE=DATE:' + endKey.replace(/-/g, ''));
        } else {
            lines.push('DTSTART:' + utcStamp(ev.start));
            if (ev.end > ev.start) lines.push('DTEND:' + utcStamp(ev.end));
        }
        lines.push('SUMMARY:' + icsEscape(ev.title));
        if (ev.location) lines.push('LOCATION:' + icsEscape(ev.location));
        if (ev.description) lines.push('DESCRIPTION:' + icsEscape(ev.description));
        lines.push('END:VEVENT', 'END:VCALENDAR');
        return lines.join('\r\n');
    }
    function downloadIcs(ev) {
        var blob = new Blob([singleIcs(ev)], { type: 'text/calendar;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gothia-' + ev.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.ics';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    /* ───────────────────── Darstellung ───────────────────── */

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }
    function icon(id) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        var use = document.createElementNS(ns, 'use');
        use.setAttribute('href', '#' + id);
        svg.appendChild(use);
        return svg;
    }

    function renderEventItem(ev) {
        var p = partsOf(ev);
        var item = el('article', 'event');

        var date = el('div', 'event-date');
        date.setAttribute('aria-hidden', 'true');
        date.appendChild(el('span', 'wd', p.weekday));
        date.appendChild(el('span', 'd', p.day));
        date.appendChild(el('span', 'm', p.month));
        item.appendChild(date);

        var main = el('div', 'event-main');
        var h = el('h3', 'event-title', ev.title);
        var tag = tagOf(ev.title);
        if (tag) h.appendChild(el('span', 'event-tag ' + tag.cls, tag.label));
        main.appendChild(h);

        var meta = el('div', 'event-meta');
        var when = el('span');
        when.appendChild(icon('i-clock'));
        var dateLabel = ev.allDay
            ? fmt({ weekday: 'long', day: 'numeric', month: 'long' }, keyMs(ev.startKey), 'UTC')
            : fmt({ weekday: 'long', day: 'numeric', month: 'long' }, ev.start);
        when.appendChild(el('span', 'sr-only', dateLabel + ', '));
        when.appendChild(document.createTextNode(timeText(ev)));
        meta.appendChild(when);
        if (ev.location) {
            var where = el('span');
            where.appendChild(icon('i-pin'));
            where.appendChild(document.createTextNode(shortLocation(ev.location)));
            meta.appendChild(where);
        }
        main.appendChild(meta);
        if (ev.description) {
            var desc = ev.description.length > 220 ? ev.description.slice(0, 217).replace(/\s+\S*$/, '') + ' …' : ev.description;
            main.appendChild(el('p', 'event-desc', desc));
        }
        item.appendChild(main);

        var add = el('button', 'event-add');
        add.type = 'button';
        add.title = 'Zum eigenen Kalender hinzufügen';
        add.setAttribute('aria-label', '„' + ev.title + '“ am ' + dateLabel + ' zum eigenen Kalender hinzufügen');
        add.appendChild(icon('i-calendar-plus'));
        add.addEventListener('click', function () { downloadIcs(ev); });
        item.appendChild(add);
        return item;
    }

    function render(container, events, opts) {
        opts = opts || {};
        var limit = opts.limit || 6;
        container.innerHTML = '';
        container.setAttribute('aria-busy', 'false');
        if (!events.length) {
            var empty = el('div', 'events-state');
            empty.appendChild(el('strong', null, 'Gerade ist nichts eingetragen'));
            empty.appendChild(document.createTextNode('Das neue Semesterprogramm folgt in Kürze. Abonniere den Kalender, dann verpasst du nichts.'));
            container.appendChild(empty);
            return;
        }
        var lastMonth = null;
        var hiddenNodes = [];
        events.forEach(function (ev, i) {
            var p = partsOf(ev);
            var nodes = [];
            if (p.monthLong !== lastMonth) {
                lastMonth = p.monthLong;
                nodes.push(el('h3', 'events-month', p.monthLong));
            }
            nodes.push(renderEventItem(ev));
            nodes.forEach(function (n) {
                if (i >= limit) { n.hidden = true; hiddenNodes.push(n); }
                container.appendChild(n);
            });
        });
        if (hiddenNodes.length) {
            var wrap = el('div', 'events-more');
            var btn = el('button', 'btn btn--ghost');
            btn.type = 'button';
            btn.setAttribute('aria-expanded', 'false');
            var label = el('span', null, 'Alle ' + events.length + ' Termine anzeigen');
            btn.appendChild(label);
            btn.appendChild(icon('i-chevron-down'));
            btn.addEventListener('click', function () {
                var open = btn.getAttribute('aria-expanded') === 'true';
                hiddenNodes.forEach(function (n) { n.hidden = open; });
                btn.setAttribute('aria-expanded', open ? 'false' : 'true');
                label.textContent = open ? 'Alle ' + events.length + ' Termine anzeigen' : 'Weniger anzeigen';
                btn.querySelector('svg').style.transform = open ? '' : 'rotate(180deg)';
                if (open) container.scrollIntoView({ block: 'start' });
            });
            wrap.appendChild(btn);
            container.appendChild(wrap);
        }
    }

    function renderNext(card, ev) {
        if (!card || !ev) return;
        var p = partsOf(ev);
        var set = function (k, v) { var n = card.querySelector('[data-ne="' + k + '"]'); if (n) n.textContent = v; };
        set('d', p.day);
        set('m', p.month);
        set('title', ev.title);
        var whenTxt = ev.allDay
            ? fmt({ weekday: 'long', day: 'numeric', month: 'long' }, keyMs(ev.startKey), 'UTC')
            : fmt({ weekday: 'long' }, ev.start) + ', ' + fmt({ hour: '2-digit', minute: '2-digit' }, ev.start) + ' Uhr';
        set('meta', whenTxt + (ev.location ? ' · ' + shortLocation(ev.location).split(',')[0] : ''));
        card.setAttribute('aria-label', 'Nächster Termin: ' + ev.title + ', ' + (ev.allDay ? whenTxt : fmt({ weekday: 'long', day: 'numeric', month: 'long' }, ev.start) + ', ' + fmt({ hour: '2-digit', minute: '2-digit' }, ev.start) + ' Uhr') + ' — alle Termine ansehen');
        card.hidden = false;
    }

    /* ───────────────────── Laden ───────────────────── */

    function isIcs(t) { return typeof t === 'string' && /^\s*BEGIN:VCALENDAR/.test(t); }

    function loadIcs(url) {
        var fallback = function () {
            var n = document.getElementById('ics-fallback');
            return n ? n.textContent : '';
        };
        if (!window.fetch || location.protocol === 'file:') return Promise.resolve(fallback());
        return fetch(url, { cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
            .then(function (t) { if (!isIcs(t)) throw new Error('Keine iCalendar-Daten'); return t; })
            .catch(function () { return fallback(); });
    }

    function init() {
        var list = document.getElementById('events');
        var next = document.getElementById('nextEvent');
        if (!list && !next) return;
        var url = root.GOTHIA_ICS_URL || 'calendar.php';
        loadIcs(url).then(function (text) {
            var now = Date.now();
            var events = buildOccurrences(parseICS(text || ''), now, now + 366 * DAY);
            if (list) render(list, events, { limit: 6 });
            if (next) {
                // Für die Startseite einen öffentlichen Termin wählen (interne Convente überspringen)
                var pub = events.filter(function (e) { var t = tagOf(e.title); return !(t && t.label === 'Convent'); });
                renderNext(next, pub[0] || events[0]);
            }
        }).catch(function () {
            if (list) render(list, [], {});
        });
    }

    var api = { parseICS: parseICS, buildOccurrences: buildOccurrences, expandRule: expandRule, parseRRule: parseRRule, wallToInstant: wallToInstant, timeText: timeText, singleIcs: singleIcs, tagOf: tagOf };
    root.GothiaTermine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
