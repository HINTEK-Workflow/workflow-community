# Säkerhetspolicy / Security policy

Svenska först, sedan engelska. Swedish first, then English.

## Svenska (SWE)

### Versioner som får säkerhetsrättningar

| Version | Säkerhetsrättningar |
| --- | --- |
| Det senaste släppet | Ja |
| Äldre släpp | Nej. Uppgradera till det senaste släppet. |

- Säkerhetsrättningar kommer i det senaste släppet. Att uppgradera är gratis: kör installationsskriptet igen, så behålls inställningar och data. Installationsskriptet tar en krypterad backup och läser tillbaka den innan databasen uppdateras (se INSTALLATION.md).
- **Varje version kan uppgraderas gratis till den senaste.** Databasen ändras bara framåt: en tabell eller kolumn tas bort först när en släppt version har slutat använda den, så att även en gammal installation kan uppgraderas i ett steg.
- Alla versioner finns kvar under *Releases*, med kontrollsummor (`SHA256SUMS`), förteckning över paketen (SBOM) och en signerad tagg, så att ni kan kontrollera det ni hämtar och gå tillbaka till en tidigare version.
- HINTEK Power Solutions AB underhåller utgåvan så länge den publiceras här. Slutar vi underhålla den säger vi det minst tolv månader i förväg, här i arkivet och på hintekwork.com.

### Rapportera en sårbarhet

- Rapportera inte sårbarheter i öppna ärenden eller pull requests.
- **På GitHub:** använd den privata sårbarhetsrapporteringen, fliken **Security** → **Report a vulnerability**. Rapporten syns bara för dig och för dem som underhåller arkivet.
- **Utan GitHub-konto:** skriv till säkerhetsadressen på https://hintekwork.com/legal/support. Samma adress står i https://hintekwork.com/.well-known/security.txt.
- Beskriv problemet, hur det kan återskapas, vilken version det gäller och vilken påverkan du ser.
- Prova bara mot din egen installation, aldrig mot någon annans data, och undvik prov som kan göra en tjänst långsam.
- Berätta inte om bristen offentligt innan den är rättad.

### Det här gör vi

- Vi bekräftar att vi fått rapporten inom tre arbetsdagar.
- Inom tio arbetsdagar får du vår första bedömning av hur allvarlig bristen är.
- En kritisk brist som redan utnyttjas rättar vi, eller ger ett sätt att skydda sig mot, inom 7 dagar.
- En allvarlig brist rättar vi så snart det går, och senast inom 30 dagar. Andra brister rättas i ett kommande släpp.
- Varje vecka och före varje släpp söker vi igenom paketen, avbildningen och historiken efter kända sårbarheter och hemligheter (OSV-Scanner, Trivy och Gitleaks). Ett släpp med en kritisk eller hög sårbarhet som har en rättning går inte ut.
- När rättningen är släppt publicerar vi ett säkerhetsråd under fliken **Security** → **Advisories**, med vilka versioner som berörs och vad den som driver en installation behöver göra. Vill du nämnas i säkerhetsrådet gör vi det.
- Utnyttjas en brist redan rapporterar vi den till de myndigheter som lagen kräver och berättar för användarna vad de ska göra.

Den som driver en egen installation ansvarar för den: drift, backup, uppdateringar och sina användares frågor.

## English (ENG)

### Supported versions

| Version | Security fixes |
| --- | --- |
| The latest release | Yes |
| Older releases | No. Upgrade to the latest release. |

- Security fixes are made in the latest release. Upgrading is free: run the install script again, and settings and data are kept. The install script takes an encrypted backup and reads it back before the database is updated (see INSTALLATION.en.md).
- **Every version can be upgraded free of charge to the latest one.** The database only changes forward: a table or column is removed only after a released version has stopped using it, so even an old installation can be upgraded in one step.
- Every version stays available under *Releases*, with checksums (`SHA256SUMS`), a list of the packages (SBOM) and a signed tag, so you can check what you download and go back to an earlier version.
- HINTEK Power Solutions AB maintains this edition for as long as it is published here. If we stop maintaining it, we will say so at least twelve months in advance, here in the repository and on hintekwork.com.

### Reporting a vulnerability

- Do not report vulnerabilities in public issues or pull requests.
- **On GitHub:** use private vulnerability reporting, the **Security** tab → **Report a vulnerability**. Only you and the maintainers of the repository can see the report.
- **Without a GitHub account:** write to the security address on https://hintekwork.com/legal/support. The same address is in https://hintekwork.com/.well-known/security.txt.
- Describe the problem, how to reproduce it, which version it affects and the impact you see.
- Only test against your own installation, never against anyone else's data, and avoid tests that could slow a service down.
- Do not disclose the issue publicly before it is fixed.

### What we do

- We acknowledge your report within three working days.
- Within ten working days you get our first assessment of how severe the issue is.
- A critical issue that is already being exploited is fixed, or a way to protect against it is given, within 7 days.
- We fix a severe issue as soon as we can, and within 30 days at the latest. Other issues are fixed in an upcoming release.
- Every week and before every release we scan the packages, the image and the history for known vulnerabilities and secrets (OSV-Scanner, Trivy and Gitleaks). A release with a critical or high vulnerability that has a fix does not go out.
- When the fix is released we publish a security advisory under the **Security** tab → **Advisories**, saying which versions are affected and what an operator needs to do. If you want to be credited in the advisory, we will credit you.
- If an issue is already being exploited, we report it to the authorities the law requires and tell users what to do.

Whoever runs an installation is responsible for it: operations, backups, updates and their users' questions.
