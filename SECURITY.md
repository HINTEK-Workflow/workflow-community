# Säkerhetspolicy / Security policy

Svenska först, sedan engelska. Swedish first, then English.

## Svenska (SWE)

### Versioner som får säkerhetsrättningar

| Version | Säkerhetsrättningar |
| --- | --- |
| Det senaste släppet | Ja |
| Äldre släpp | Nej. Uppgradera till det senaste släppet. |

- Säkerhetsrättningar kommer i det senaste släppet. Att uppgradera är gratis: kör installationsskriptet igen, så behålls inställningar och data. Ta en backup först (se INSTALLATION.md).
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
- En allvarlig brist rättar vi så snart det går, och vårt mål är inom 30 dagar. Andra brister rättas i ett kommande släpp.
- När rättningen är släppt publicerar vi ett säkerhetsråd under fliken **Security** → **Advisories**, med vilka versioner som berörs och vad den som driver en installation behöver göra. Vill du nämnas i säkerhetsrådet gör vi det.
- Utnyttjas en brist redan rapporterar vi den till de myndigheter som lagen kräver och berättar för användarna vad de ska göra.

Den som driver en egen installation ansvarar för den: drift, backup, uppdateringar och sina användares frågor.

## English (ENG)

### Supported versions

| Version | Security fixes |
| --- | --- |
| The latest release | Yes |
| Older releases | No. Upgrade to the latest release. |

- Security fixes are made in the latest release. Upgrading is free: run the install script again, and settings and data are kept. Take a backup first (see INSTALLATION.en.md).
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
- We fix a severe issue as soon as we can, with the aim of doing so within 30 days. Other issues are fixed in an upcoming release.
- When the fix is released we publish a security advisory under the **Security** tab → **Advisories**, saying which versions are affected and what an operator needs to do. If you want to be credited in the advisory, we will credit you.
- If an issue is already being exploited, we report it to the authorities the law requires and tell users what to do.

Whoever runs an installation is responsible for it: operations, backups, updates and their users' questions.
