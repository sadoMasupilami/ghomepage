<?php
/**
 * calendar.php — Kalender der Akademischen Sängerschaft Gothia zu Graz
 *
 * Liefert den öffentlichen Google-Kalender „Veranstaltungen AS! Gothia“ als iCalendar-Datei (.ics):
 *   • für die Startseite (assets/js/termine.js lädt „calendar.php“)
 *   • als Abo-Adresse für Kalender-Apps: webcal://www.gothia-graz.at/calendar.php
 *
 * So funktioniert es:
 *   – Der Kalender wird höchstens alle 15 Minuten bei Google abgeholt und als Datei
 *     zwischengespeichert (Ordner „cache/“ neben dieser Datei, sonst im Temp-Ordner des Servers).
 *   – Ist Google nicht erreichbar, wird die letzte funktionierende Kopie ausgeliefert.
 *   – Gibt es gar keine Kopie, antwortet das Skript mit 503 bzw. 502 und einem kurzen Text.
 *   – Eingaben der Besucher (Parameter, Formulare …) werden nicht verwendet.
 *
 * Termine ändert man NICHT hier, sondern direkt im Google-Kalender.
 * Läuft ab PHP 7.4. Für Tests können die Konstanten unten vorab definiert werden
 * (z. B. per „php -d auto_prepend_file=…“), ausgeliefert wird immer die echte Google-Adresse.
 */

declare(strict_types=1);

/* ── Einstellungen ───────────────────────────────────────────────────────── */

if (!defined('GOTHIA_ICS_URL')) {
    define('GOTHIA_ICS_URL', 'https://calendar.google.com/calendar/ical/c0fd677e5a63edd668f9dd71cefc7060286a8025dd9fe520a61779a287ca314f%40group.calendar.google.com/public/basic.ics');
}
if (!defined('GOTHIA_CACHE_TTL')) {
    define('GOTHIA_CACHE_TTL', 900);            // Sekunden, die eine Kopie als aktuell gilt (15 Min.)
}
if (!defined('GOTHIA_RETRY_AFTER')) {
    define('GOTHIA_RETRY_AFTER', 60);           // nach einem Fehlschlag so lange nicht erneut bei Google fragen
}
if (!defined('GOTHIA_FETCH_TIMEOUT')) {
    define('GOTHIA_FETCH_TIMEOUT', 8);          // Sekunden für den gesamten Abruf bei Google
}
if (!defined('GOTHIA_MAX_BYTES')) {
    define('GOTHIA_MAX_BYTES', 5 * 1024 * 1024);
}
if (!defined('GOTHIA_CACHE_DIR')) {
    define('GOTHIA_CACHE_DIR', '');             // leer = automatisch (cache/ neben dieser Datei, sonst Temp-Ordner)
}
define('GOTHIA_USER_AGENT', 'GothiaCalendarProxy/1.0 (+https://www.gothia-graz.at/)');


/* ── Zwischenspeicher ────────────────────────────────────────────────────── */

/** Ersten beschreibbaren Cache-Ordner finden und die Dateipfade liefern (oder null). */
function gothia_cache_paths(): ?array
{
    $candidates = [];
    if (GOTHIA_CACHE_DIR !== '') {
        $candidates[] = [GOTHIA_CACHE_DIR, 'gothia-calendar'];
    }
    $candidates[] = [__DIR__ . DIRECTORY_SEPARATOR . 'cache', 'gothia-calendar'];
    $tmp = sys_get_temp_dir();
    if ($tmp !== '') {
        // Eigener Name pro Website, falls sich mehrere Seiten einen Temp-Ordner teilen
        $candidates[] = [$tmp, 'gothia-calendar-' . substr(sha1(__DIR__), 0, 10)];
    }

    foreach ($candidates as $candidate) {
        $dir = rtrim((string) $candidate[0], '/\\');
        if ($dir === '') {
            continue;
        }
        // „@“: auf Shared Hosting kann open_basedir manche Ordner sperren – dann einfach den nächsten nehmen
        if (!@is_dir($dir) && !@mkdir($dir, 0755, true) && !@is_dir($dir)) {
            continue;
        }
        if (!@is_writable($dir)) {
            continue;
        }
        gothia_protect_dir($dir);
        $base = $dir . DIRECTORY_SEPARATOR . $candidate[1];
        return ['data' => $base . '.cache', 'lock' => $base . '.lock', 'fail' => $base . '.fail'];
    }
    return null;
}

/** Liegt der Cache-Ordner im Webspace, wird er per .htaccess für Besucher gesperrt. */
function gothia_protect_dir(string $dir): void
{
    $real = @realpath($dir);
    if ($real === false) {
        return;
    }
    $roots = [@realpath(__DIR__)];
    if (!empty($_SERVER['DOCUMENT_ROOT'])) {
        $roots[] = @realpath((string) $_SERVER['DOCUMENT_ROOT']);
    }
    $inside = false;
    foreach ($roots as $root) {
        if ($root !== false && ($real === $root || strpos($real . DIRECTORY_SEPARATOR, $root . DIRECTORY_SEPARATOR) === 0)) {
            $inside = true;
            break;
        }
    }
    $htaccess = $real . DIRECTORY_SEPARATOR . '.htaccess';
    if (!$inside || is_file($htaccess)) {
        return;
    }
    @file_put_contents(
        $htaccess,
        "# Automatisch von calendar.php angelegt: Zwischenspeicher, kein Zugriff von außen.\n" .
        "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n" .
        "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n"
    );
}

/**
 * Zwischengespeicherte Kopie lesen.
 * Format: erste Zeile JSON mit Metadaten, danach der unveränderte Kalender.
 */
function gothia_cache_read(string $file): ?array
{
    if (!@is_file($file)) {
        return null;
    }
    $raw = @file_get_contents($file);
    if ($raw === false) {
        return null;
    }
    $nl = strpos($raw, "\n");
    if ($nl === false) {
        return null;
    }
    $meta = json_decode(substr($raw, 0, $nl), true);
    $body = (string) substr($raw, $nl + 1);
    if (!is_array($meta) || !gothia_is_ics($body)) {
        return null;
    }
    $fetched = isset($meta['fetched']) ? (int) $meta['fetched'] : 0;
    if (($meta['source'] ?? '') !== GOTHIA_ICS_URL) {
        $fetched = 0;   // Kalender-Adresse wurde geändert → sofort neu abrufen (alte Kopie nur als Notlösung)
    }
    return [
        'fetched' => $fetched,
        'changed' => isset($meta['changed']) ? (int) $meta['changed'] : $fetched,
        'etag'    => isset($meta['etag']) ? (string) $meta['etag'] : gothia_etag($body),
        'body'    => $body,
    ];
}

/** Atomar schreiben: erst in eine temporäre Datei, dann umbenennen (Leser sehen nie halbe Dateien). */
function gothia_cache_write(string $file, array $entry): bool
{
    $meta = json_encode([
        'fetched' => $entry['fetched'],
        'changed' => $entry['changed'],
        'etag'    => $entry['etag'],
        'source'  => GOTHIA_ICS_URL,
    ], JSON_UNESCAPED_SLASHES);
    if ($meta === false) {
        return false;
    }
    try {
        $tmp = $file . '.tmp-' . bin2hex(random_bytes(6));
    } catch (Exception $e) {
        $tmp = $file . '.tmp-' . getmypid() . '-' . mt_rand();
    }
    $fh = @fopen($tmp, 'xb');
    if ($fh === false) {
        return false;
    }
    $data = $meta . "\n" . $entry['body'];
    $ok = @fwrite($fh, $data) === strlen($data);
    $ok = @fflush($fh) && $ok;
    fclose($fh);
    if ($ok) {
        @chmod($tmp, 0644);
        $ok = @rename($tmp, $file);
    }
    if (!$ok) {
        @unlink($tmp);
    }
    return $ok;
}

/**
 * Sperre, damit bei vielen gleichzeitigen Aufrufen nur einer bei Google nachfragt.
 * Rückgabe: Datei-Handle (gesperrt) · false (gerade von jemand anderem gesperrt) · null (Sperren nicht möglich).
 */
function gothia_lock(string $file, bool $wait)
{
    $fh = @fopen($file, 'c');
    if ($fh === false) {
        return null;
    }
    if (!@flock($fh, $wait ? LOCK_EX : (LOCK_EX | LOCK_NB))) {
        fclose($fh);
        return $wait ? null : false;
    }
    return $fh;
}

function gothia_unlock($fh): void
{
    if (is_resource($fh)) {
        @flock($fh, LOCK_UN);
        fclose($fh);
    }
}


/* ── Abruf bei Google ────────────────────────────────────────────────────── */

function gothia_is_ics(string $body): bool
{
    return strncmp($body, 'BEGIN:VCALENDAR', 15) === 0 && strpos($body, 'END:VCALENDAR') !== false;
}

/**
 * Inhalts-Kennung für ETag. Die Zeile DTSTAMP ändert Google bei jedem Abruf –
 * sie wird ignoriert, damit Kalender-Apps „304 Not Modified“ bekommen, solange sich nichts geändert hat.
 */
function gothia_etag(string $body): string
{
    $normalized = preg_replace('/^DTSTAMP[;:][^\r\n]*\r?\n/m', '', $body);
    return substr(sha1(is_string($normalized) ? $normalized : $body), 0, 24);
}

/**
 * Kalender abrufen. Rückgabe: ['body' => string|null, 'error' => string, 'invalid' => bool]
 * („invalid“ = Google hat geantwortet, aber nicht mit einem gültigen Kalender → 502 statt 503).
 */
function gothia_fetch(string $url): array
{
    $body = null;
    $status = 0;
    $error = '';

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            return ['body' => null, 'error' => 'cURL konnte nicht gestartet werden', 'invalid' => false];
        }
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 5,
            CURLOPT_CONNECTTIMEOUT => min(5, GOTHIA_FETCH_TIMEOUT),
            CURLOPT_TIMEOUT        => GOTHIA_FETCH_TIMEOUT,
            CURLOPT_USERAGENT      => GOTHIA_USER_AGENT,
            CURLOPT_HTTPHEADER     => ['Accept: text/calendar, text/plain;q=0.8, */*;q=0.5'],
            CURLOPT_ENCODING       => '',          // gzip/deflate annehmen, falls Google es anbietet
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];
        if (defined('CURLOPT_PROTOCOLS') && defined('CURLOPT_REDIR_PROTOCOLS')) {
            $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS | CURLPROTO_HTTP;
            $options[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTPS | CURLPROTO_HTTP;
        }
        if (defined('CURLOPT_MAXFILESIZE')) {
            $options[CURLOPT_MAXFILESIZE] = GOTHIA_MAX_BYTES;
        }
        foreach ($options as $option => $value) {
            @curl_setopt($ch, $option, $value);     // einzeln, damit eine fehlende Option nicht alles abbricht
        }
        $result = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($result === false) {
            $error = 'cURL: ' . curl_error($ch);
        } else {
            $body = (string) $result;
        }
        unset($ch);
    } elseif (filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        $context = stream_context_create([
            'http' => [
                'method'          => 'GET',
                'header'          => "Accept: text/calendar, text/plain;q=0.8, */*;q=0.5\r\n" .
                                     'User-Agent: ' . GOTHIA_USER_AGENT . "\r\n",
                'timeout'         => GOTHIA_FETCH_TIMEOUT,
                'follow_location' => 1,
                'max_redirects'   => 5,
                'ignore_errors'   => true,    // auch bei 4xx/5xx Antwort lesen, Status prüfen wir selbst
            ],
            'ssl' => [
                'verify_peer'      => true,
                'verify_peer_name' => true,
            ],
        ]);
        $previousTimeout = ini_set('default_socket_timeout', (string) GOTHIA_FETCH_TIMEOUT);
        $stream = @fopen($url, 'rb', false, $context);
        if ($stream === false) {
            $error = 'Stream: ' . ((error_get_last()['message'] ?? '') ?: 'Verbindung fehlgeschlagen');
        } else {
            // Antwort-Header stehen in den Metadaten; nach Weiterleitungen zählt die letzte Statuszeile
            $meta = stream_get_meta_data($stream);
            foreach ((array) ($meta['wrapper_data'] ?? []) as $line) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $line, $m)) {
                    $status = (int) $m[1];
                }
            }
            $result = stream_get_contents($stream, GOTHIA_MAX_BYTES + 1);
            $timedOut = !empty(stream_get_meta_data($stream)['timed_out']);
            fclose($stream);
            if ($result === false || $timedOut) {
                $error = $timedOut ? 'Stream: Zeitüberschreitung' : 'Stream: Lesen fehlgeschlagen';
            } else {
                $body = $result;
            }
        }
        if ($previousTimeout !== false) {
            ini_set('default_socket_timeout', (string) $previousTimeout);
        }
    } else {
        return ['body' => null, 'error' => 'Weder cURL noch allow_url_fopen verfügbar', 'invalid' => false];
    }

    if ($body === null) {
        return ['body' => null, 'error' => $error ?: 'Keine Antwort', 'invalid' => false];
    }
    if ($status !== 200) {
        return ['body' => null, 'error' => 'HTTP-Status ' . $status, 'invalid' => $status > 0];
    }
    if (strlen($body) > GOTHIA_MAX_BYTES) {
        return ['body' => null, 'error' => 'Antwort zu groß', 'invalid' => true];
    }
    // Byte-Order-Mark und Leerraum am Anfang entfernen, dann prüfen
    $body = ltrim((string) preg_replace('/^\xEF\xBB\xBF/', '', $body));
    if (!gothia_is_ics($body)) {
        return ['body' => null, 'error' => 'Antwort ist kein gültiger Kalender', 'invalid' => true];
    }
    return ['body' => $body, 'error' => '', 'invalid' => false];
}


/** Ist der letzte Abruf gerade erst fehlgeschlagen? Dann Google eine Minute in Ruhe lassen. */
function gothia_recent_failure(?array $paths): bool
{
    return $paths !== null
        && @is_file($paths['fail'])
        && time() - (int) @filemtime($paths['fail']) < GOTHIA_RETRY_AFTER;
}


/* ── Antworten ───────────────────────────────────────────────────────────── */

function gothia_plain(int $status, string $text, array $extraHeaders = []): void
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    foreach ($extraHeaders as $line) {
        header($line);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        echo $text;
    }
    exit;
}

/** ETag ohne „W/“, Anführungszeichen und die von Apache (mod_deflate) angehängte Endung „-gzip“. */
function gothia_opaque_tag(string $tag): string
{
    $tag = trim($tag);
    if (stripos($tag, 'W/') === 0) {
        $tag = substr($tag, 2);
    }
    $tag = trim($tag, '"');
    return (string) preg_replace('/-(gzip|br|deflate|zstd)$/', '', $tag);
}

/** Bedingte Anfrage (If-None-Match / If-Modified-Since) → true, wenn „304 Not Modified“ genügt. */
function gothia_not_modified(string $etag, int $lastModified): bool
{
    if (isset($_SERVER['HTTP_IF_NONE_MATCH'])) {
        $want = gothia_opaque_tag($etag);
        foreach (explode(',', (string) $_SERVER['HTTP_IF_NONE_MATCH']) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '*' || ($candidate !== '' && gothia_opaque_tag($candidate) === $want)) {
                return true;
            }
        }
        return false;   // If-None-Match hat Vorrang vor If-Modified-Since
    }
    if (isset($_SERVER['HTTP_IF_MODIFIED_SINCE'])) {
        $since = strtotime((string) $_SERVER['HTTP_IF_MODIFIED_SINCE']);
        return $since !== false && $since >= $lastModified;
    }
    return false;
}


/* ── Ablauf ──────────────────────────────────────────────────────────────── */

if (function_exists('header_remove')) {
    header_remove('X-Powered-By');
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method !== 'GET' && $method !== 'HEAD') {
    gothia_plain(405, "Nur GET und HEAD sind erlaubt.\n", ['Allow: GET, HEAD']);
}

$now = time();
$paths = gothia_cache_paths();
$entry = $paths !== null ? gothia_cache_read($paths['data']) : null;
$state = 'HIT';
$failure = null;

if ($entry === null || $now - $entry['fetched'] >= GOTHIA_CACHE_TTL) {
    if (gothia_recent_failure($paths)) {
        $failure = ['error' => 'Letzter Abruf vor Kurzem fehlgeschlagen', 'invalid' => false];
    } else {
        // Mit veralteter Kopie: nicht warten, wenn schon jemand abruft (die alte Kopie genügt so lange).
        // Ohne Kopie: kurz warten, bis der andere Abruf fertig ist.
        $lock = $paths !== null ? gothia_lock($paths['lock'], $entry === null) : null;

        if ($lock === false) {
            $state = 'STALE';
        } else {
            // Jemand anderes könnte inzwischen aktualisiert haben (oder gerade gescheitert sein)
            clearstatcache();
            $latest = $paths !== null ? gothia_cache_read($paths['data']) : null;
            if ($latest !== null && $now - $latest['fetched'] < GOTHIA_CACHE_TTL) {
                $entry = $latest;
            } elseif ($latest === null && $entry === null && gothia_recent_failure($paths)) {
                $failure = ['error' => 'Abruf während des Wartens fehlgeschlagen', 'invalid' => false];
            } else {
                if ($latest !== null) {
                    $entry = $latest;
                }
                $result = gothia_fetch(GOTHIA_ICS_URL);
                if ($result['body'] !== null) {
                    $etag = gothia_etag($result['body']);
                    $entry = [
                        'fetched' => $now,
                        'changed' => ($entry !== null && $entry['etag'] === $etag) ? $entry['changed'] : $now,
                        'etag'    => $etag,
                        'body'    => $result['body'],
                    ];
                    $state = 'MISS';
                    if ($paths !== null) {
                        gothia_cache_write($paths['data'], $entry);
                        if (is_file($paths['fail'])) {
                            @unlink($paths['fail']);
                        }
                    }
                } else {
                    $failure = $result;
                    error_log('calendar.php: Google-Kalender nicht abrufbar (' . $result['error'] . ')');
                    if ($paths !== null) {
                        @touch($paths['fail']);
                    }
                }
            }
            gothia_unlock($lock);
        }
    }

    if ($failure !== null) {
        if ($entry === null) {
            if ($failure['invalid']) {
                gothia_plain(502, "Der Kalender hat gerade keine gültigen Daten geliefert. Bitte versuche es in ein paar Minuten noch einmal.\n", ['Retry-After: ' . GOTHIA_RETRY_AFTER]);
            }
            gothia_plain(503, "Der Kalender ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten noch einmal.\n", ['Retry-After: ' . GOTHIA_RETRY_AFTER]);
        }
        $state = 'STALE';
    }
}

$etag = 'W/"' . $entry['etag'] . '"';
$lastModified = $entry['changed'] > 0 ? $entry['changed'] : $entry['fetched'];

header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="gothia.ics"');
header('Cache-Control: public, max-age=' . GOTHIA_CACHE_TTL);
header('Expires: ' . gmdate('D, d M Y H:i:s', $now + GOTHIA_CACHE_TTL) . ' GMT');
header('ETag: ' . $etag);
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $lastModified) . ' GMT');
header('X-Robots-Tag: noindex');
header('X-Calendar-Cache: ' . $state);

if (gothia_not_modified($etag, $lastModified)) {
    http_response_code(304);
    exit;
}

header('Content-Length: ' . strlen($entry['body']));
if ($method !== 'HEAD') {
    echo $entry['body'];
}
