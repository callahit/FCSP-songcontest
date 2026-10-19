# SPSC Songs – St. Pauli Song Contest offline

Inoffizielle Web-App (PWA) mit allen Songs der Song-Auswahl des St. Pauli Song Contests:

- [Bereits bestehende Songs](https://www.fcstpauli.com/spsc/der-st-pauli-song-contest-deine-stimme-wird-gebraucht/song-auswahl) (S-Nummern)
- [Neu erstellte Songs](https://www.fcstpauli.com/spsc/der-st-pauli-song-contest-deine-stimme-wird-gebraucht/song-auswahl-2) ohne KI (N-Nummern) und mit KI (K-Nummern)

## Funktionen

- Alle Songs mit Nummer, Titel, Interpret, Beschreibung bzw. Songtext, unterteilt in die drei Kategorien
- MP3-Player; ist kein MP3 hinterlegt, wird das YouTube-Video eingebettet
- Favoriten (★) und „gehört“-Markierung, Filter und Suche
- Funktioniert offline: Song-Liste und Beschreibungen werden automatisch gespeichert,
  MP3s lassen sich einzeln, für alle Favoriten oder komplett offline speichern
- Favoriten als Text teilen/kopieren
- Installierbar auf dem Homescreen („Zum Home-Bildschirm hinzufügen“)

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `app/` | Die App (statische Dateien, kein Build nötig) |
| `app/songs.json` | Alle Song-Daten, erzeugt vom Scraper |
| `scripts/scrape.mjs` | Lädt die Song-Auswahl und alle Detailseiten von fcstpauli.com |
| `.github/workflows/fetch-songs.yml` | Aktualisiert `songs.json` täglich (und manuell per „Run workflow“) |
| `.github/workflows/pages.yml` | Veröffentlicht `app/` auf GitHub Pages |

## Veröffentlichen

Einmalig in GitHub unter **Settings → Pages → Build and deployment → Source** „GitHub Actions“ auswählen.
Danach ist die App unter `https://<benutzer>.github.io/FCSP-songcontest/` erreichbar.

## Lokal starten

```sh
node scripts/scrape.mjs        # Song-Daten aktualisieren (braucht Zugriff auf fcstpauli.com)
cd app && python3 -m http.server 8000
```
