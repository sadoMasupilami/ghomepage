'use strict';
// Einstieg für „node --test tests/“: Node 22+ behandelt einen Ordner als Modulpfad und lädt
// diese Datei; ältere Versionen (18/20) durchsuchen den Ordner selbst nach *.test.js.
// Neue Testdateien hier ergänzen.
require('./termine.test.js');
