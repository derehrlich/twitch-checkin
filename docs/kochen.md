# Koch-Overlay

Zeigt beim Kochstream links oben das Schild **„Heute in der Küche:“** mit dem Gericht und dem Hinweis auf `!rezept`, dazu rechts unten auf Wunsch einen **Countdown**. Beides ist so gelegt, dass es nichts Wichtiges im Kamerabild verdeckt.

## Einrichten (einmalig)
1. In OBS eine **Browserquelle** anlegen, Adresse `https://wache.ehrlichverwirrt.de/kochen`, Größe 1920 × 1080, **ganz oben** über der Kamera.
2. Der Befehl `!rezept` muss im Admin unter Chat → Rezept eingeschaltet sein, sonst steht er nicht auf dem Schild.

## Beim Kochen
Admin → Overlays → **Kochen**:
1. Gericht eintragen, **Schild einschalten**. Das Gericht kannst du jederzeit ändern.
2. **Countdown:** entweder Minuten ab jetzt (z. B. 45) oder einen Tag und eine Uhrzeit wählen, dazu einen Text wie „Essen ist fertig in“. Ist die Zeit um, blinkt ein Text, den du selbst einträgst (Standard „Guten Appetit!“, z. B. auch „Essen ist fertig!“). Mit „Countdown wegnehmen“ verschwindet er.
3. **Alles ausblenden** nimmt Schild und Countdown weg.

Mit `?size=0.8` hinter der Adresse wird alles kleiner, mit `?demo` siehst du ein Beispiel.
