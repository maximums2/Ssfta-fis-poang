SSF TA – FIS-poäng v0.11

Hämtar FIS-poäng för den disciplin som anmälningslistan gäller (SL/GS/SG/DH)
från fis-ski.com med hjälp av FIS-koderna, och visar dem i kolumnen "FIS xx".

Installera / uppdatera:
1. Packa upp ZIP-filen.
2. Öppna chrome://extensions och aktivera utvecklarläge.
3. Ta bort den gamla versionen (v0.2) eller klicka "Uppdatera" på den.
4. Läs in opaketerat -> välj mappen fis_ssfta_extension_v0_11.
5. Ladda om SSF TA-sidan.

Noteringar:
- Svar sparas i 12 timmar (chrome.storage.local) för att inte belasta FIS.
- "—" = åkaren har inga poäng i disciplinen (eller 999.99). "?" = hämtning/tolkning misslyckades.
- Misslyckas tolkningen: öppna F12 -> Console och skicka raden "[FIS-poäng] Kunde inte tolka...".
- Klicka på kolumnrubriken "FIS xx" för att sortera (lägst poäng först, sedan högst först, sedan ursprunglig ordning). Åkare utan poäng hamnar sist.
- v0.11: tåligare disciplinavläsning (även engelska 'Discipline:'), följer sidan när den laddar om innehåll, och om disciplinen ändå inte hittas kan du välja SL/GS/SG/DH med knappar i statusrutan.
- v0.11: om Chrome blockerar åtkomsten till fis-ski.com (CORS-felet) visar tillägget ett tydligt meddelande. Klicka på tilläggets ikon för att ge åtkomst.
  Kontrollera annars chrome://extensions -> Detaljer -> Webbplatsåtkomst: välj "På alla webbplatser" eller lägg till fis-ski.com.
- v0.11: ny kolumn "Rank" som visar placering bland de anmälda efter FIS-poäng (lägst = 1, delad placering vid lika poäng, åkare utan poäng får —).
- v0.11: åkarens namn är en länk till hens FIS-profil på fis-ski.com (öppnas i ny flik).
- v0.11: den gröna statusrutan försvinner efter 4 sekunder när allt gått bra. Varningar och fel ligger kvar.
- v0.11: varannan rad har olika bakgrundsfärg, och raden under musen markeras.
