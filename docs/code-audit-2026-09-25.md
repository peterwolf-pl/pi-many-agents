# Przegląd pi-many-agents

Data: 25.09.2026. Gałąź: main. Commit: `21c4f3eac30ae006bf0c24133d64362b0c877db5`.

## Wniosek

Podstawowy runner działa. Stage 3 jest zestawem częściowo wdrożonych modułów, nie zamkniętym przepływem użytkownika. Najpierw trzeba naprawić integrację, anulowanie i wiarygodność raportów. Dopiero później rozwijać routing kosztowy i interfejs terminalowy.

## Weryfikacja

| Kontrola | Wynik |
| --- | --- |
| Node | 24.19.0 |
| npm ci --ignore-scripts --no-audit --no-fund | Powodzenie |
| npm test | 28/28 |
| npm run typecheck | Powodzenie; nie obejmuje extensions |
| npm run lint | Powodzenie; prosty skaner dwóch wzorców |
| npm run demo | Trzy zakończone zadania fake |
| Prawdziwe modele Pi | Nie sprawdzono; brak binarki Pi w tym środowisku |

Nie modyfikowano kodu wykonawczego ani zdalnego repozytorium. Ustalenia odnoszą się do wskazanego commita.

## Co jest zaimplementowane

- Kolejka DAG, priorytety, kontrola cykli, limit workerów.
- Procesy Fake/Pi, timeouty, retry, prosta kontrola zdrowia dostawców.
- Jawne pakiety zadań bez automatycznego dołączania historii rodzica.
- Profile Pi, lokalny chat Ollama i Mistral.
- Raporty AgentReport, JSONL i tekstowy status.
- Deterministyczny podział Markdown oraz podstawowa deduplikacja.
- Osobne moduły SQLite, daemon, worktrees, path locks i L0.

## Błędy i luki

P0 oznacza blokadę podstawowego przepływu, fałszywy wynik lub ryzyko utraty pracy. P1 oznacza istotny błąd poprawności albo brak integracji. P2 oznacza jakość diagnostyki lub funkcję do późniejszego etapu.

| Priorytet | Ustalenie | Dowód / skutek |
| --- | --- | --- |
| P0 | Niezgodny protokół rozszerzenia i daemona | extensions/index.ts wysyła komendy bez pól wymaganych przez parseMessageLine. Bezpośrednia reprodukcja zwróciła undefined. /many nie wykona planu tą ścieżką. |
| P0 | Daemon nie startuje w świeżym katalogu | Konstruktor otwiera SQLite przed mkdir w start(). Reprodukcja: unable to open database file. |
| P0 | Błędny proces może zostać oznaczony completed | wrapTextReport zwraca wyodrębniony raport bez wymuszenia błędu procesu. Reprodukcja z error i status failed zwróciła completed. |
| P0 | Niebezpieczny shutdown daemona | SIGTERM ustawia timer process.kill(0, SIGKILL), obejmujący bieżącą grupę procesu. Ocena statyczna; nie wykonywano tego sygnału. |
| P0 | Brak automatycznej izolacji zapisów | Orchestrator nie wywołuje WorktreeManager ani PathLockManager. Oddzielny proces nadal może pisać do wspólnego workspace. |
| P1 | Raport z nested changes nie jest parsowany | extractJsonReport bierze ostatnią otwierającą klamrę. Reprodukcja zwróciła undefined dla poprawnego JSON. |
| P1 | Anulowanie A może przerwać B | PiProvider.cancel i FakeProvider.cancel sprzątają cały współdzielony ProcessManager. Ollama.cancel jest puste. |
| P1 | Wspólny AbortController daemona | Abort obejmuje wszystkie run, a kontroler nie jest odtwarzany. Orchestrator i ProcessManager nie sprawdzają pre-aborted signal przed startem. |
| P1 | Klient gubi fragmentowane ramki | Każdy chunk danych jest dzielony niezależnie. Brak bufora między zdarzeniami data. Close socketu nie kończy oczekiwania na wynik. |
| P1 | Raporty zależności nie trafiają do następcy | Orchestrator przekazuje oryginalne task plus modelPolicy. Wyniki są tylko gromadzone w reports. Zadanie integrate nie zna poprzednich raportów. |
| P1 | Dedup psuje DAG | Referencje do usuniętych ID nie są przepisywane. Reprodukcja: task c depends on missing b. Fingerprint pomija workspace, context i permissions. |
| P1 | CLI ignoruje provider planu | run czyta wyłącznie raw.tasks i domyślnie wymusza fake. Pole provider:pi bez flagi CLI nie uruchomi modelu. |
| P1 | Model w telemetrii może różnić się od wykonania | routeTask używa defaultModel, a PiProvider dodaje --model wyłącznie z task.modelPolicy.model. |
| P1 | Brak walidacji limitu równoległości | Reprodukcja maxConcurrentWorkers:0 zwróciła pustą listę raportów bez błędu. |
| P1 | Wyjątki dostępności/spawn mogą wyrwać run | available() jest poza izolacją błędu zadania; spawn() znajduje się przed try w ManagedWorker.run. |
| P1 | Trwałość nie obejmuje rzeczywistego cyklu życia | Serwer nie wywołuje upsertTask. Raporty zapisuje po całym run. Klucz raportu to task_id bez runId, więc kolejne uruchomienia nadpisują historię. |
| P1 | Shutdown może zamknąć bazę przed pracą | shutdown abortuje i zamyka store, ale nie czeka na rozliczenie wszystkich aktywnych handleMessage/run. |
| P1 | Manager worktrees wymaga zabezpieczeń | Surowy taskId trafia do ścieżki; błędy already exists są ignorowane; cleanup używa --force i branch -D. Podłączenie tego bez zmian grozi skasowaniem pracy. |
| P2 | L0 nie uczestniczy w wykonaniu | Klasa L0Advisor jest wywoływana w testach, nie przez orkiestrator. Near-duplicate assist nie jest zaimplementowany w tym module. |
| P2 | Budżet tokenów nie jest egzekwowany | maxTokens trafia do planu, ale realne adaptery nie wymuszają limitu. Nie ma routera kosztowego ani dowodu oszczędności. |
| P2 | Katalog modeli nie jest w pełni weryfikowany | PiProfileProvider.available sprawdza nazwę providera; capabilities deklaruje wszystkim profilom contextWindow 1000000. |
| P2 | Mistral cold-start blokuje preflight | Orchestrator wymaga available przed execute, podczas gdy ensure uruchamiające Docker znajduje się dopiero w execute. |
| P2 | Uprawnienia są słabsze niż sandbox | Pi ogranicza listę narzędzi. network/git są deklaracjami, a shell umożliwia działania poza nimi. |
| P2 | Zielone testy mają luki | daemon.test sprawdza CRUD, worktree.test używa managera bez orkiestratora, extensions nie jest w tsconfig. |

## Kolejność wdrożenia

1. Wspólna walidacja planów oraz zgodny wybór adaptera/modelu.
2. Parser raportów z nadrzędnością wyniku procesu.
3. Izolowane anulowanie, pełne sprzątanie i raportowanie wyjątków.
4. Naprawiony protokół daemon-client i obsługa socketów.
5. Trwałość z runId i prawdziwymi stanami zadań.
6. Poprawny dedup i jawne przekazywanie raportów zależności.
7. Integracja zabezpieczonych worktrees bez auto-merge i kasowania zmian.
8. Testy całej ścieżki oraz aktualizacja dokumentacji.

L0, TUI, tmux i routing kosztowy pozostają poza tym etapem. JSON wdrożeniowy jest instrukcją dla głównego agenta, nie planem do uruchomienia przez obecne, niesprawne /many.

## Źródła

- Repozytorium peterwolf-pl/pi-many-agents, main, commit wskazany na początku.
- src/core/orchestrator.ts, scheduler.ts, task.ts, dedup.ts, worker-manager.ts.
- src/daemon/server.ts, store.ts; extensions/index.ts.
- src/protocol/messages.ts, report.ts; src/process/process-manager.ts.
- src/providers/pi.ts, fake.ts, ollama.ts, docker-mistral.ts, catalog.ts.
- src/worktree/manager.ts, lock.ts; src/l0/advisor.ts.
- src/cli/main.ts, src/config/config.ts, src/routing/rules.ts, src/index.ts, src/types.ts.
- package.json, tsconfig.json, scripts/lint.ts, test/*.test.ts, docs/*, plans/stage-next.json.
- Lokalne wykonanie testów i sześć opisanych reprodukcji.
