# Koch-Overlay

Zeigt beim Kochstream Rezept, Zutaten, den aktuellen Schritt und einen Küchenwecker über der Küchenkamera. Die Karten sind so gelegt, dass sie nichts Wichtiges im Bild verdecken.

## Einrichten (einmalig)
1. In OBS eine **Browserquelle** anlegen, Adresse `https://wache.ehrlichverwirrt.de/kochen`, Größe 1920 × 1080, **ganz oben** über der Kamera.
2. Die Quelle bleibt unsichtbar, bis du im Admin ein Rezept startest.

## Beim Kochen
Admin → Overlays → **Kochen**:
1. Titel, Zutaten (eine pro Zeile, höchstens 14) und Schritte (einer pro Zeile, höchstens 20) eintragen, **Rezept starten**.
2. Mit **Nächster Schritt** und **Schritt zurück** schaltest du den Text auf der Karte weiter.
3. Der **Küchenwecker** (Minuten und Name, z. B. „Nudeln“) erscheint unten in der Mitte und blinkt rot, wenn er abgelaufen ist.
4. **Beenden** blendet alles aus.

Ein laufendes Rezept kannst du ändern (Tippfehler, neuer Schritt): Schritt und Wecker bleiben, wo sie sind.

## Wo die Karten liegen
- Rezept und Schritt: links oben auf der schwarzen Dunstabzugshaube
- Zutaten: rechts unten auf den leeren Schranktüren
- Wecker: unten in der Mitte auf der weißen Tischplatte

Mit `?size=0.8` hinter der Adresse werden alle Karten kleiner, mit `?demo` siehst du ein Beispiel. Wenn die Kamera einmal anders steht, ändern sich die Plätze oben in `public/kochen.html` (`#recipe`, `#ing`, `#timer`).
