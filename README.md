# Atlante Meteo Trentino

Atlante indipendente in italiano. Mappe, schede comunali e confronti tra due valli nella stessa fascia di quota. Scegli un intervallo negli ultimi 90 giorni, oppure esplora gelo primaverile, caldo estivo e somma termica stagionale. Condividi una vista o esporta CSV, PNG e PDF tramite la stampa. Le stime riguardano condizioni passate, non sono allerte e non misurano il clima o la resa agricola.

## Avvio

Con Python 3.12:

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
OPENBLAS_NUM_THREADS=1 .venv/bin/python refresh.py
.venv/bin/gunicorn --bind 127.0.0.1:8765 serve:application
```

`web/` è il sito statico; la stessa cartella si può pubblicare con un qualsiasi servizio statico. Per Devin Apps, impostare `ATLAS_SNAPSHOT` e usare `refresh.py --output ... --cache ... --trigger cron` con percorsi di runtime assoluti fuori dal checkout. La sostituzione atomica consente di servire la versione precedente anche durante un aggiornamento.

## Pubblicazione e aggiornamento

- GitHub Pages: attivare **Settings → Pages → Source → GitHub Actions**. Il workflow pubblica su push al ramo principale e ogni giorno alle 06:37 UTC. Un errore nel download o nei controlli non sostituisce il sito già pubblicato.
- Gli orari GitHub possono slittare. GitHub disattiva le pianificazioni dei repository pubblici dopo 60 giorni di inattività; controllare che il workflow sia ancora attivo in caso di sito non aggiornato.
- Devin App: la pianificazione locale del deployment è alle 06:20 UTC. Il server e la pianificazione locale dipendono dalla disponibilità della sessione che li ospita; l’App Devin è visibile solo agli utenti autenticati autorizzati.
- L’ultimo giorno osservato, la versione dell’archivio e la data di pubblicazione sono verificabili in **Metodo e fonti**. Il refresh registra una riga JSON con versione, data, conteggi e trigger.

## Metodo e fonti

- **Meteo:** [Provincia Autonoma di Trento – Meteotrentino, Archivio Dati](https://archivio.meteotrentino.it/share/#/scarica), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.it). Estremi misurati su intervalli di 15 min negli Annali recenti (400.55 e 400.56; possibili errori alle 00:00 per le minime), medie da misure di intervallo (400.02, almeno 95% dei campioni) e pioggia (10.00, 288 campioni). Il giorno civile usa l’ora solare UTC+1; si escludono giorno in corso, campioni marcati mancanti ed estremi di qualità dubbia o ricostruiti. Possono essere incluse misure provvisorie.
- **Rilievo:** Tarquini S., Isola I., Favalli M., Battistini A., Dotta G. (2023), [TINITALY 1.1, INGV](https://doi.org/10.13127/tinitaly/1.1), CC BY 4.0; rilievo ricampionato da Meteotrentino a 250 m e dall’Atlante a circa 750 m.
- **Confini:** Provincia Autonoma di Trento, [Comunità di valle](https://siatservices.provincia.tn.it/geonetwork/geonetwork/api/records/p_TN:58604ed2-ac1d-4f78-a00c-514fd3562c51) e [Comuni](https://siatservices.provincia.tn.it/geonetwork/geonetwork/api/records/p_TN:0dc5bc18-54de-4495-be3e-9e44f2135803), CC0; geometrie semplificate per la mappa.
- **Stima:** combinazione con peso inverso al quadrato della distanza di un massimo di sei stazioni; almeno tre entro 30 km, la più vicina entro 15 km. Per la temperatura l’interpolazione agisce sugli scarti dal gradiente giornaliero di quota e non copre celle oltre 550 m sopra la stazione vicina più alta. La verifica con una stazione esclusa a turno riguarda solo il giorno più recente. La copertura è la frazione di celle stimabili nella fascia, non l’accuratezza.
- **Indicatori:** servono stime per tutti i giorni del periodo in ciascuna cella. I massimi di pioggia a 24/48/72 ore usano finestre da mezzanotte e il picco locale è il massimo delle celle. La somma termica misura gradi-giorno sopra 10 °C, aprile–ottobre, non la produttività. Le fasce non uniformano le distribuzioni di quota.

## Verifica

```sh
.venv/bin/python -m unittest discover -s tests -v
node --check web/app.js
node --test tests/indicators.test.mjs
```
