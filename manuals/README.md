# Consulente B737

`manuals.html` contiene il campo messaggio. La freccia copia la domanda negli appunti e apre il GPT B737NG/MAX OMA + Appdx; l’utente deve incollarla in ChatGPT. Il testo resta nel campo in caso di errore negli appunti. Non è una chat API e non esegue analisi operative nell’app.

Non sono presenti caricamento manuali o ricerca aeroportuale. La configurazione del GPT è separata e resta da completare. Il GPT attualmente è privato.

## Pubblicazione

Eseguire `python3 scripts/package-site.py` dalla cartella del progetto. Il file `dist/737-OPS-online.zip` contiene soltanto i dieci file pubblici necessari all’app. Pubblicare il contenuto di questo archivio, non l’intera cartella di lavoro.

`manuals/library/` contiene documenti e testo privati: resta locale ed è esclusa sia da Git sia dall’archivio. Gli altri moduli manuali precedenti sono conservati ma non usati dalla pagina attuale né inclusi nell’archivio.

Il service worker usa una revisione della cache dedicata. Un aggiornamento già installato può restare in attesa fino alla chiusura delle vecchie finestre dell’app.
