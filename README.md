# Atlante Meteo Trentino

**[Apri l’Atlante Meteo Trentino](https://bnistor4.github.io/meteo-trentino/)** · Gratuito, senza account.

Un atlante indipendente per vedere dove ha fatto più freddo, caldo o dove è piovuto di più in Trentino. La mappa usa i dati delle stazioni di Meteotrentino per stimare i valori anche nei luoghi senza una stazione.

## Come si usa

1. Scegli **Minima**, **Massima** o **Pioggia**. Usa le frecce o scegli una data. Premi **Riproduci** per vedere come cambiano mappa e valori del comune giorno per giorno; **Più recente** torna all’ultimo dato.
2. Cerca un comune per vedere i suoi valori stimati e gli **Ultimi 7 giorni**. Salvalo per ritrovarlo quando riapri il sito dallo stesso browser.
3. Apri **Altre mappe** per vedere gelo, caldo e pioggia nel tempo. Usa **Filtri** per cambiare date o quota, **Confronta valli** per vedere due territori affiancati e **Condividi** per copiare il link o scaricare i dati.

Un punto sulla mappa mostra una **stima** per quel luogo. I punti contrassegnati come **Stazioni** mostrano invece le misure raccolte sul posto. L’Atlante descrive il passato, non il tempo di oggi o di domani: per quello usa le [previsioni ufficiali di Meteotrentino](https://www.meteotrentino.it/previsioni/).

## Aggiornamento automatico

Il [workflow GitHub Actions](https://github.com/bnistor4/meteo-trentino/actions/workflows/atlante.yml) aggiorna le mappe alle 06:37 UTC e riprova alle 07:53 UTC se un’esecuzione pianificata non ha ancora pubblicato i dati di ieri. Le modifiche a `main` pubblicano anche il sito. Se Meteotrentino non ha ancora fornito i dati del giorno atteso, il sito mantiene l’ultima versione pubblicata. In **Guida e fonti** trovi la data delle misure e, sotto **Ultima elaborazione**, quella del calcolo delle mappe.

GitHub può ritardare le esecuzioni e disattiva quelle pianificate nei repository pubblici dopo 60 giorni di inattività. Se ciò accade, un amministratore può riattivarle dalla [pagina del workflow](https://github.com/bnistor4/meteo-trentino/actions/workflows/atlante.yml). Per ospitare una propria copia, attiva **Settings → Pages → Source → GitHub Actions**.

## Avvio locale

Con Python 3.12:

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
OPENBLAS_NUM_THREADS=1 .venv/bin/python refresh.py
.venv/bin/gunicorn --bind 127.0.0.1:8765 serve:application
```

`web/` è il sito statico; la stessa cartella si può pubblicare con un qualsiasi servizio statico. Le mappe predefinite usano `data/atlas.json.gz`; le serie giornaliere vengono scaricate solo quando si seleziona un periodo personalizzato. Per Devin Apps, impostare `ATLAS_SNAPSHOT` al percorso assoluto di `atlas.json.gz` e usare lo stesso percorso per `refresh.py --output`, con `--cache` fuori dal checkout e `--trigger cron`. Le serie di ciascuna versione sono scritte prima di pubblicare il nuovo atlante.

Per provare modifiche senza riscaricare i dati, usa lo stesso percorso assoluto in `ATLAS_SNAPSHOT` e una porta libera, per esempio `8766`. Il file delle serie giornaliere deve restare accanto allo snapshot.

## Metodo e fonti

- **Meteo:** [Provincia Autonoma di Trento – Meteotrentino, Archivio Dati](https://archivio.meteotrentino.it/share/#/scarica), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.it). Estremi misurati su intervalli di 15 min negli Annali recenti (400.55 e 400.56; possibili errori alle 00:00 per le minime), medie da misure di intervallo (400.02, almeno 95% dei campioni) e pioggia (10.00, 288 campioni). Il giorno civile usa l’ora solare UTC+1; si escludono giorno in corso, campioni marcati mancanti ed estremi di qualità dubbia o ricostruiti. Possono essere incluse misure provvisorie.
- **Rilievo:** Tarquini S., Isola I., Favalli M., Battistini A., Dotta G. (2023), [TINITALY 1.1, INGV](https://doi.org/10.13127/tinitaly/1.1), CC BY 4.0; rilievo ricampionato da Meteotrentino a 250 m e dall’Atlante a circa 750 m.
- **Confini:** Provincia Autonoma di Trento, [Comunità di valle](https://siatservices.provincia.tn.it/geonetwork/geonetwork/api/records/p_TN:58604ed2-ac1d-4f78-a00c-514fd3562c51) e [Comuni](https://siatservices.provincia.tn.it/geonetwork/geonetwork/api/records/p_TN:0dc5bc18-54de-4495-be3e-9e44f2135803), CC0; geometrie semplificate per la mappa.
- **Fondo cartografico:** rilievo TINITALY, acqua e viabilità semplificate da [OpenFreeMap](https://openfreemap.org/) con [OpenMapTiles](https://openmaptiles.org/) e [contributori OpenStreetMap](https://www.openstreetmap.org/copyright). Le geometrie derivate da OSM nel fondo sono disponibili con [licenza ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- **Stima:** combinazione con peso inverso al quadrato della distanza di un massimo di sei stazioni; almeno tre entro 30 km, la più vicina entro 15 km. Per la temperatura l’interpolazione agisce sugli scarti dal gradiente giornaliero di quota e non copre celle oltre 550 m sopra la stazione vicina più alta. La verifica con una stazione esclusa a turno riguarda solo il giorno più recente. La copertura è la frazione di celle stimabili nella fascia, non l’accuratezza.
- **Indicatori:** servono stime per tutti i giorni del periodo in ciascuna cella. I massimi di pioggia a 24/48/72 ore usano finestre da mezzanotte e il picco locale è il massimo delle celle. La somma termica misura gradi-giorno sopra 10 °C, aprile–ottobre, non la produttività. Le fasce non uniformano le distribuzioni di quota.
- **Riepilogo del comune:** ogni giorno e ogni indicatore fanno media sulle celle comunali con una stima disponibile quel giorno, a tutte le quote. Non sono misure di stazione; il confronto fra due giorni può includere celle diverse.

### Rigenerare il fondo

Il sito serve il fondo già generato. Per sostituirlo, procurarsi i 16 riquadri OpenFreeMap di livello 9 (x 270–273, y 180–183; versione originale `20261122_124456_pt`), chiamarli `osm-Z-X-Y.pbf` e usare i due file del rilievo presenti nella cache del refresh. La rigenerazione richiede `mapbox-vector-tile==2.2.0` oltre alle dipendenze dell’Atlante.

```sh
.venv/bin/python build_basemap.py PERCORSO_TILES .cache/dem_250m.json .cache/dem_250m.bin web/basemap.svg.gz
```

## Verifica

```sh
.venv/bin/python -m unittest discover -s tests -v
node --check web/app.js
node --test tests/indicators.test.mjs
```
