# Påhittad beskrivning (indata till provet av HINTEK Workflow Form Builder)

Det här är kundens beskrivning som gavs till AI:n. Formuläret `tvattstugerond.json` bredvid skrevs utifrån den genom att följa paketets SKILL.md steg för steg, som en extern AI skulle göra.

> Vi är ett litet fastighetsbolag och vill ha ett formulär för vår månadsrond i tvättstugorna. Fastighetsskötaren väljer
> vilken tvättstuga det gäller och vilken månad. Sedan kontrolleras maskinerna: tvättmaskiner, torktumlare och torkskåp,
> var och en OK eller inte OK, och vid fel ska man kunna ta en bild. Temperaturen i torkskåpet mäts och ska jämföras med
> en gräns som vi själva sätter. Golvbrunnen ska vara rensad (ja/nej, nej är en avvikelse). Städningen bedöms som bra,
> godkänd eller dålig, där dålig är en avvikelse. Om bokningstavlan är trasig vill vi skriva vad som är fel. Varje
> maskin med fel ska kunna bli en arbetsorder. Sist en anteckning och fastighetsskötarens signatur.

Vad AI:n valde och berättade efteråt (steg 5 i SKILL.md):
- Avsnitten: Rond, Maskiner, Torkskåp, Lokalen, Fel på maskiner, Signering.
- Gränsen för torkskåpets temperatur är ett gränsvärde utan tal (`torkskap_max`); företaget anger värdet i Workflow.
- Fel på maskiner registreras i en tabell med Skapa arbetsorder på varje rad, och checklistans Ej OK kan läggas där.
