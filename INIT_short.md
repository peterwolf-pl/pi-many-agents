** Główna idea: nie tworzyć kolejnego wielkiego agenta-orchestratora, tylko warstwę sterującą nad Pi. Główne Pi rozmawia z użytkownikiem i podejmuje decyzje, 
a pi-many-agents uruchamia izolowanych workerów, dobiera im model, reasoning, narzędzia, budżet i kontekst. Do głównego Pi wracają tylko krótkie raporty.   Pasted markdown
- Najtańszy agent to brak agenta. git status, testy, sprawdzanie plików, procesów czy logów powinny być wykonywane zwykłym kodem bez LLM.
- Architektura: Main Pi -> cienkie extension -> osobny PMA daemon -> scheduler/router -> workerzy Pi RPC, lokalne modele i zewnętrzni agenci.
- Pi nie jest modyfikowane. Nie robisz forka. Extension pozostaje cienkie, a cała orkiestracja działa w osobnym daemonie.
- Workerzy Pi działają headless przez RPC. Pełne okno terminala otwierasz tylko wtedy, gdy chcesz podejrzeć konkretnego agenta.
- Centralnym elementem jest Task DAG, a nie rozmowa pomiędzy agentami. Zadania mają zależności i statusy, a agent jest tylko wykonawcą.
- Router dobiera osobno model i reasoning. Możesz więc użyć mocnego modelu z low reasoning albo taniego modelu z medium.
- Domyślna eskalacja: deterministic -> local -> cheap -> capable -> strong. high reasoning jest używany dopiero wtedy, gdy rzeczywiście jest potrzebny.
- Lokalny model działa jako L0: klasyfikacja zadań, streszczanie logów, kompresja kontekstu, wykrywanie duplikacji, monitoring agentów i rekomendowanie eskalacji.
- Kontekst jest bardzo ważny. Worker nie dostaje całej rozmowy Main Pi. Dostaje mały ContextPacket zawierający cel, ograniczenia, istotne pliki i obserwacje.
- Worker zwraca AgentReport, nie transcript. Raport zawiera wynik, zmienione pliki, testy, confidence, koszt, tokeny i ewentualne problemy.
- Równoległość jest dynamiczna. PMA nie powinien uruchamiać 12 agentów tylko dlatego, że może. Proste zadanie może dostać jednego workera, duża migracja kilku.
- Coding workerzy dostają osobne git worktrees. Dodatkowo obowiązuje single-writer rule, żeby dwóch agentów nie edytowało tego samego zasobu równocześnie.
- Implementacja i review są rozdzielone. Reviewer dostaje przede wszystkim cel, diff i testy, a nie uzasadnienie autora, dzięki czemu review jest bardziej niezależne.
- Watchdog pilnuje agentów. Kontroluje heartbeat, czas narzędzia, idle time, tokeny i postęp. Zawieszony agent może zostać przerwany i uruchomiony ponownie.
- Brak cichego przełączania na płatny model. Jeżeli lokalny provider nie działa, system nie może sam przejść na drogi model bez zezwolenia polityki.
- Dashboard najlepiej zrobić w tmux. Lewa kolumna Main Pi, środkowa flota agentów, prawa zadania, koszty, DAG i eventy.
- PMA ma się sam ulepszać na podstawie telemetrii, ale nie może edytować własnego działającego kodu. Zmiany polityk mają być wersjonowane i testowane.
- MVP powinno być małe: Main Pi + extension + daemon + Pi RPC workers + deterministic executor + lokalny worker + Task DAG + scheduler + budgets + timeouts + SQLite + podstawowy dashboard.
- Codex, Grok Build i Antigravity dopiero później. Najpierw trzeba udowodnić, że sam scheduler i router rzeczywiście zmniejszają czas lub koszt.
- Każdy backend powinien implementować wspólny interfejs. Scheduler ma wiedzieć, jakie agent ma możliwości, a nie jak konkretnie działa Codex, Grok czy Pi.
- Najważniejsze metryki: czas do zweryfikowanego wyniku, koszt zaakceptowanego zadania, płatne tokeny, success rate, retry, manual fixes, wasted runs oraz stosunek pracy lokalnej do płatnej.
- Test skuteczności: porównać zwykłe Pi z PMA na 50-100 rzeczywistych zadaniach. Jeśli PMA jest wolniejsze dla określonego typu prostych zadań, router powinien nauczyć się go tam nie uruchamiać.

 Najważniejsza myśl



pi-many-agents nie powinien być produktem typu "mam 12 agentów".
Powinien być systemem typu:
"Do wykonania tego zadania użyłem 47 operacji bez LLM, 3 lokalnych agentów, 2 płatnych agentów i tylko jednego wywołania high reasoning. Testy oraz niezależne review przeszły."
