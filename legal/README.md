# Juridiska texter för din installation / Legal texts for your installation

Svenska först, sedan engelska. Swedish first, then English.

## Svenska (SWE)

- Den som driver en Workflow-installation ansvarar för sina egna villkor. Workflow har därför inga färdiga texter.
- Länkarna *Tjänstevillkor*, *Integritetspolicy* och *DPA* visar bara en kort beskrivning tills du lägger in din egen
  text här.
- Skriv Markdown i den här mappen. Med `docker compose` läses mappen direkt. En annan mapp anges med `LEGAL_DIR` i `.env`.
- Kontrollera att texterna stämmer för er verksamhet och följer gällande regler innan du använder installationen med
  riktiga kunder.

| Fil | Visas på |
| --- | --- |
| `terms.md` | /legal/terms |
| `privacy.md` | /legal/privacy |
| `dpa.md` | /legal/dpa |

## English (ENG)

- Whoever runs a Workflow installation is responsible for its own terms, so Workflow ships none.
- The links *Tjänstevillkor* (terms), *Integritetspolicy* (privacy policy) and *DPA* show only a short description until
  you add your own text here.
- Write Markdown in this folder. With `docker compose` the folder is read directly; set another folder with `LEGAL_DIR`
  in `.env`.
- Make sure the texts fit your business and follow the rules that apply to you before you use the installation with real
  customers.

| File | Shown at |
| --- | --- |
| `terms.md` | /legal/terms |
| `privacy.md` | /legal/privacy |
| `dpa.md` | /legal/dpa |
