# Kickbase-API: Messungen für die Kontostand-Schätzung

Stand 08.10.2026, gemessen an einer echten 2.-Liga-Liga (5 Manager, Startbudget 75 Mio,
nach Spieltag 6). Alle Aufrufe sind GET gegen `https://api.kickbase.com/v4`.

## Ergebnis: Der Prüfstein geht auf

Für den Token-Inhaber reproduziert die Formel unten den echten Kontostand aus `/me`
bis auf **50.000 €** (bei rund 960 Mio Transfervolumen). Dieselbe Rechnung lässt sich
für jeden Gegner aufstellen, weil alle Bestandteile über öffentliche Endpunkte
abrufbar oder ableitbar sind.

```
Kontostand = Startbudget                       /leagues/{L}/overview  b
           − Käufe + Verkäufe                  /leagues/{L}/managers/{U}/transfer
           + MVP-Auto-Verkäufe                 Feed Typ 32 / Kaderabgleich
           + Saisonpunkte × 1.000 €            /leagues/{L}/managers/{U}/dashboard  tp
           + Erfolgsprämien                    abgeleitet, siehe unten
           + Auflaufprämie                     Staffel, siehe unten
```

Prüfstein am 08.10.2026: 75.000.000 − 543.196.551 + 419.613.941 + 25.029.776
+ 3.973.000 + 2.550.000 + 3.125.000 = −13.904.834; `/me` meldet −13.954.834.

## Endpunkte

| Endpunkt | Nutzen |
|---|---|
| `/leagues/{L}/managers/{U}/transfer?start=N` | **Komplette Transferhistorie jedes Managers seit Ligastart**, 25 pro Seite. Felder `pi`, `pn`, `tty` (1 Kauf, 2 Verkauf), `trp`, `dt`. Enthält keine MVP-Auto-Verkäufe. |
| `/leagues/{L}/managers/{U}/dashboard` | `tv` echter Kaderwert, `tp` Saisonpunkte, `mdw` Spieltagssiege, `t` Zahl der Transfers inkl. Auto-Verkäufe |
| `/leagues/{L}/managers/{U}/performance` | Spieltage mit `day`, `md` (Anstoß), `mdp` (Punkte), `tw` (Spieltagssieg) |
| `/leagues/{L}/users/{me}/teamcenter?dayNumber=D` | Aufstellung (`lp`) und Punkte (`mdp`) **aller** Manager an Spieltag D |
| `/competitions/{cpi}/players/{P}/performance` | **Ganze Karriere je Saison** (`it[].ti` z. B. „2026/2027“, auch 1. Liga). Je Spiel in `ph[]`: `day`, `p` Punkte, `mp` Minuten, `st` (5 Startelf, 3 eingewechselt, 4 nicht eingesetzt, 0 noch nicht gespielt), `t1`/`t2` Heim/Gast als Kickbase-Vereins-ID, `t1g`/`t2g` Tore, `pt` Verein des Spielers, `md` Anstoß, `mi` Spiel-ID. **Kommende Spiele stehen mit `st` 0 und ohne Tore drin.** |
| `/competitions/{cpi}/teams/{T}/teamprofile` | Kader eines Vereins (`it[]` mit `i`, `pos`, `ap`, `mv`, `st`) |
| `/competitions/{cpi}/table` | Tabelle: `tid`, `tn`, `cpl` Platz, `sp` Kickbase-Punkte, `gd` Tordifferenz, `mc` Spiele |
| `/leagues/{L}/user/achievements` | eigene Erfolge mit Anzahl `ac` |
| `/leagues/{L}/user/achievements/{t}` | Beschreibung `d` und **Prämie `er`** dieses Erfolgs in dieser Liga |
| `/leagues/{L}/activitiesFeed` | **Nur rund ein Monat Historie.** Typ 22 eigene Auflaufprämie (`bn`), Typ 17 Spieltagssieger, Typ 26 eigene Erfolge, Typ 32 MVP-Auto-Verkauf (`slr`, `trp`) |

Nicht vorhanden (404): Erfolge anderer Manager, ein Budget-Endpunkt für Gegner.

Für Spieler-Detail und Gebotshilfe (Stand 08.10.2026, Felder laut
[kevinskyba/kickbase-api-doc](https://github.com/kevinskyba/kickbase-api-doc), noch nicht
an einer echten Liga nachgemessen):

| Endpunkt | Nutzen |
|---|---|
| `/leagues/{L}/players/{P}/marketvalue/92` | Marktwertverlauf, `it[]` mit `dt` (Tagesindex seit 1970) und `mv`, dazu `hmv`/`lmv` Hoch/Tief. Auch `365` geht. Die App versucht zur Sicherheit auch die Schreibweise `marketValue`. |
| `/leagues/{L}/players/{P}/transferHistory?start=0` | Transfers des Spielers in dieser Liga: `unm` Käufer, `trp` Preis, `dt`. Zusammen mit dem Marktwertverlauf ergibt das den Aufschlag am Kauftag. |
| `/base/predictions/teams/{cpi}` | Kickbase-eigene Aufstellungsprognose, aber nur als **Bild** je Verein (`plpim`, PNG). Für die Einsatzchance nicht auswertbar, deshalb nicht eingebaut. |

## Gegnerstärke

Für den Gegnerfaktor der erwarteten Punkte lädt die App einmal pro halbem Tag die
Spielerhistorie aller Vereine ihres Wettbewerbs (`teamprofile` je Verein, dann
`performance` je Spieler mit Punkteschnitt, einige Hundert GET-Abrufe) und
Ergebnisse von [OpenLigaDB](https://www.openligadb.de) (`/getmatchdata/bl2/2026`, offenes
CORS, ohne Login). Die Vereinsnamen lassen sich eindeutig zuordnen („Hertha BSC“ ↔
„Hertha“, „SpVgg Greuther Fürth“ ↔ „Fürth“).

Rückrechnung am 08.10.2026 mit 475 Spielern der 2. Liga, 4.644 Startelf-Einsätzen aus
2025/26 und 2026/27, jeder Spieltag nur mit Daten davor vorhergesagt
(`tools/backtest.mjs`):

| Vorhersage | RMSE (Punkte) |
|---|---|
| Saisonschnitt des Spielers | 63,70 |
| getrimmter Schnitt (je 10 % oben/unten weg) | 63,89 (schlechter) |
| Schnitt × Gegnerfaktor | **63,22** (Differenz der quadrierten Fehler −61 ± 15) |
| zum Vergleich: Gegnerwerte aus den tatsächlichen Ergebnissen (nachträglich) | 62,28 |

Ein eigener Gegnereffekt je Spieler (Regression auf seine Spiele, zur Position gestaucht)
war nicht besser als der Positionswert und ist deshalb nicht eingebaut. Kickbase-Punkte
schwanken pro Spiel um rund ±64; die Gegner erklären davon nur einen kleinen, aber
messbaren Teil.

## Fallen

- **`tv` im Ranking ist der Wert der aufgestellten Elf**, nicht des Kaders
  (gemessen 84,5 statt 103,2 Mio). Kaderwert immer aus `dashboard`.
- **Der Activity-Feed reicht nur etwa einen Monat zurück.** Eine Rechnung nur aus dem
  Feed verliert alle älteren Transfers; die alte Version der App hat das über einen
  Kalibrierungsbetrag von −67 Mio „ausgeglichen“ und dabei Gegner um bis zu 20 Mio
  falsch geschätzt.
- **MVP-Auto-Verkauf ist Feedtyp 32**, nicht 27, und fehlt in der Transferliste.
  Erkennbar auch ohne Feed: ein gekaufter Spieler, der weder verkauft wurde noch im
  Kader steht.
- **33%-Regel**: Grenze = 33 % von (Mannschaftswert + Kontostand). Beispiel der
  Kickbase-Hilfe: 100 Mio + (−10 Mio) → bis −30 Mio. Offene Gebote zählen zusammen.

## Auflaufprämie

Tag n einer Serie zahlt `min(step × n, cap)`, gezählt ab Ligabeitritt. 2. Liga:
5.000er-Schritte bis 50.000 (gemessen, `bn` = 50.000 an jedem Tag ab Tag 10).
1. Liga: 10.000er-Schritte bis 100.000. Das Feld `day` ist der globale Login-Streak
des Kontos und **nicht** der Multiplikator.

## Erfolgsprämien

Beträge (`er`) in der 2. Liga; die 1. Liga zahlt laut Kickbase-Hilfe das Doppelte. Die
App liest die Beträge aus der API. „r“ = pro Ereignis wiederholbar, sonst einmal pro
Saison. Gestaffelte Erfolge kommen gemeinsam: ein Spieler mit 403 Punkten bringt
Topscorer, Matchwinner und Weltklasse.

| t | Erfolg | Bedingung | er |
|---|---|---|---|
| 5 | Spieltagssieger (r) | Spieltag gewonnen | 500.000 |
| 1–4 | Spieltagssieger Bronze/Silber/Gold, The Special One | 3/5/10/25 Siege | 250k/500k/750k/1 Mio |
| 100 | Spieltagspunkte Bronze | einmal ≥ 500 Punkte | 50.000 |
| 101–103 (r) | Spieltagspunkte Silber/Gold, Jahrhundertspiel | ≥ 1000/1500/2000 Punkte | 125k/500k/1 Mio |
| 200–204 | Saisonpunkte | 1.000/5.000/15.000/30.000/40.000 | 50k/125k/250k/500k/1 Mio |
| 300–303 (r) | Topscorer, Matchwinner, Weltklasse, Fussballgott | ein Spieler ≥ 200/300/400/500 Punkte | 50k/250k/500k/1 Mio |
| 400–404 | Mannschaftswert | 125/150/200/250/350 Mio | 50k/125k/250k/500k/1 Mio |
| 500–504 | Erster Deal, Transferkönig | 1/50/250/500/1000 Transfers | 50k/125k/250k/500k/1 Mio |
| 600–603 | Kreisliga … 1. Liga | Liga mit ≥ 3/6/12/18 Managern | je 500.000 |
| 700 | Glückliches Händchen | einmal ≥ 1 Mio Gewinn mit einem Spieler | 50.000 |
| 701–704 (r) | Bronzenes … Königstransfer | ≥ 3/5/10/25 Mio Gewinn mit einem Spieler | 125k/250k/500k/1 Mio |
| 5001 (r) | MVP | stärkster Spieler eines Spieltags im Kader | 500.000 |

Gegenprobe: Aus den öffentlichen Daten des Token-Inhabers ergeben sich exakt die
11 Erfolge mit zusammen 2.550.000 €, die `/user/achievements` meldet.

## Was unsicher bleibt

- Auflaufprämie der Gegner: Ob sie täglich einloggen, ist unbekannt. Die App zeigt
  eine Spanne zwischen täglichem Login und Login nur an Tagen mit Transfers.
- Mannschaftswert-Erfolge: nur der aktuelle Kaderwert ist bekannt, nicht der Höchststand.
- MVP-Auto-Verkäufe älter als der Feed: Betrag geschätzt (Kaufpreis ± 15 %).
- Punkteprämie in der 1. Liga: nicht gemessen; die App eicht sie am eigenen Konto.
