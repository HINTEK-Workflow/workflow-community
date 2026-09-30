# Juridiska texter för din installation

Den som driver en Workflow-installation ansvarar för sina egna villkor. Workflow har därför inga färdiga texter:
länkarna *Tjänstevillkor*, *Integritetspolicy* och *DPA* visar bara en kort beskrivning av vad dokumentet är till för,
tills du lägger in din egen text här.

Skriv texterna som Markdown i den här mappen:

| Fil | Visas på |
| --- | --- |
| `terms.md` | /legal/terms – Tjänstevillkor |
| `privacy.md` | /legal/privacy – Integritetspolicy |
| `dpa.md` | /legal/dpa – Personuppgiftsbiträdesavtal |

Med `docker compose` läses mappen direkt, så en ändrad text syns när sidan laddas om. En annan mapp kan anges med
`LEGAL_DIR` i `.env`.

Låt en jurist granska texterna innan du använder installationen med riktiga kunder.
