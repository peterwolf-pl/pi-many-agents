# pi-many-agents

Zewnętrzny orkiestrator agentów dla Pi. Uruchamia zadania równolegle, respektuje zależności i zbiera raporty workerów. Nie modyfikuje rdzenia Pi.

Projekt wykorzystuje TypeScript, procesy Node.js, adapter CLI Pi oraz lokalne adaptery HTTP. Wersja pakietu: `0.1.0`.

## Status

Stan opisany na podstawie commita `21c4f3eac30ae006bf0c24133d64362b0c877db5` z gałęzi `main`, sprawdzony 25.09.2026.

**Działa podstawowy runner CLI. Integracja daemon + `/many` wymaga naprawy.** Worktrees, blokady ścieżek i doradca L0 istnieją jako moduły, ale nie uczestniczą jeszcze w głównej pętli wykonania.

| Obszar | Stan implementacji |
| --- | --- |
| Kolejka zadań | Priorytety, zależności, wykrywanie cykli i limit równoległości |
| Obsługa błędów | Timeout, retry wybranych błędów, podstawowa ocena zdrowia providera |
| Dostawcy | Fake, proces Pi, profile Pi, Ollama, Mistral przez lokalne API |
| Raporty | `AgentReport`, zbieranie wyników, tekstowy status, telemetria JSONL |
| Dekompozycja | Deterministyczny podział Markdown według nagłówków i list |
| Deduplikacja | Fingerprint typu zadania, celu i listy plików; wymaga naprawy zależności |
| Daemon | Serwer Unix socket i SQLite; niezgodny protokół z rozszerzeniem |
| Worktrees | Osobny manager i blokady; brak podłączenia do orkiestratora |
| L0 | Klasyfikacja, kompresja i rekomendacja reasoningu; brak podłączenia do orkiestratora |

## Wymagania

- Manifest deklaruje Node.js `>=22`. Kod używa `--experimental-strip-types` i `node:sqlite`; nie każda wczesna wersja Node 22 spełnia te wymagania. Ten snapshot sprawdzono na Node `24.19.0`.
- npm do instalacji zależności deweloperskich i uruchamiania skryptów.
- Git dla testów i modułu worktrees.
- Pi w `PATH` lub własna wartość `piBinary`, jeśli uruchamiasz prawdziwych workerów.
- Dostęp do modeli i uwierzytelnianie konfiguruje się w Pi.
- Ollama lub Docker są opcjonalne, zależnie od wybranego adaptera.
- Unix socket i sygnały grup procesów wymagają osobnej weryfikacji na Windows.

## Szybki start

W katalogu sklonowanego repozytorium:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run demo
```

Demo korzysta z providera `fake`. Weryfikuje uruchamianie procesów, kolejkę i raportowanie. Nie wykonuje analizy kodu przez LLM i nie wymaga płatnego API.

## Uruchamianie planów

```bash
node bin/pi-many-agents.js run --plan plans/stage-2.json --provider fake --concurrency 2 --retries 1
node bin/pi-many-agents.js run --plan plans/stage-next.json --provider pi --concurrency 2
node bin/pi-many-agents.js graph --plan plans/stage-next.json
node bin/pi-many-agents.js decompose brief.md --integrate
```

`decompose` wypisuje JSON na stdout. `graph` wypisuje strukturę grafu w JSON. `run` wypisuje status i raporty; raport o statusie `failed` powoduje kod wyjścia 1.

**CLI obecnie domyślnie wybiera `fake` i ignoruje pole `provider` na poziomie planu.** Aby wykonać realną pracę, podaj jawnie `--provider pi` albo nazwę zarejestrowanego profilu. Rozszerzenie `/many` odczytuje to pole planu, lecz ma opisane niżej problemy integracyjne.

## Format zadania

Minimalny plan do kontroli przepływu:

```json
{
  "tasks": [
    {
      "id": "inspect-scheduler",
      "title": "Przegląd kolejki",
      "objective": "Sprawdź obsługę zależności i wskaż brakujące przypadki testowe.",
      "type": "inspect",
      "priority": 2,
      "dependencies": [],
      "relevantFiles": ["src/core/scheduler.ts"],
      "modelPolicy": {
        "reasoning": "none",
        "timeoutMs": 120000
      },
      "permissions": {
        "read": true,
        "write": false,
        "shell": false
      }
    }
  ]
}
```

Wymagane pola to `id`, `title`, `objective`. `createTask` uzupełnia pozostałe wartości.

| Pole | Znaczenie |
| --- | --- |
| `type` | `inspect`, `code`, `test`, `research`, `review`, `shell`, `other` |
| `priority` | Większa wartość daje pierwszeństwo wśród gotowych zadań |
| `dependencies` | Identyfikatory zadań, które muszą zakończyć się przed startem |
| `workspace` | Katalog roboczy; samo wskazanie katalogu nie tworzy izolacji |
| `context` | Jawnie przekazany tekst kontekstu |
| `relevantFiles` | Lista ścieżek umieszczana w promptach; nie załącza automatycznie zawartości |
| `constraints` | Instrukcje dla workera |
| `expectedOutput` | Oczekiwany rezultat |
| `modelPolicy.provider` | Dostawca modelu wewnątrz Pi; nie wybiera adaptera orkiestratora |
| `modelPolicy.model` | Model przekazywany do adaptera |
| `modelPolicy.reasoning` | `none`, `low`, `medium`, `high` |
| `modelPolicy.timeoutMs` | Limit czasu zadania |
| `modelPolicy.maxTokens` | Zadeklarowany budżet; obecnie nie jest egzekwowany dla realnych modeli |
| `permissions` | Wybór narzędzi Pi oraz deklaracje uprawnień |

Zależności obecnie sterują kolejnością. **Raport poprzednika nie trafia automatycznie do kontekstu następnego zadania.** Nie zakładaj, że zadanie `integrate` zna wcześniejsze wyniki.

## Konfiguracja

Plik `.pi-many-agents.json` w katalogu uruchomienia:

```json
{
  "maxConcurrentWorkers": 2,
  "defaultProvider": "fake",
  "defaultModel": "fake-deterministic",
  "defaultTimeoutMs": 120000,
  "maxRetries": 1,
  "unhealthyAfterFailures": 3,
  "piBinary": "pi",
  "telemetryPath": ".pi-many-agents/telemetry.jsonl"
}
```

Domyślny routing ustala minimalny reasoning: `none` dla `shell` i `inspect`, `low` dla `test`, `review`, `research`, `medium` dla `code` i `other`.

`createTask` bez jawnej wartości reasoningu ustawia `low`. Router wybiera wyższą wartość z żądanej i minimalnej, dlatego zadanie `inspect` bez konfiguracji nie otrzymuje automatycznie `none`.

Obecny adapter Pi przekazuje model tylko wtedy, gdy znajduje się w `task.modelPolicy.model`. Samo `defaultModel` może pojawić się w planie i telemetrii, ale nie trafić do argumentów procesu Pi.

## Dostawcy i modele

| Adapter / profil | Wykonanie | Ograniczenia |
| --- | --- | --- |
| `fake` | Deterministyczny proces testowy | Nie wykonuje pracy semantycznej ani edycji kodu |
| `pi` | `pi --print --mode json --no-session --no-extensions` | Wymaga lokalnego Pi i dostępnego modelu |
| Profile Pi | Ten sam adapter z ustawionym dostawcą i modelem | Dostępność profilu sprawdza nazwę dostawcy, nie pełną parę dostawca-model |
| `gemma4` | Ollama, port 11434, domyślnie `gemma4:latest` | Chat tekstowy, bez odczytu plików i narzędzi |
| `mistral` | API Ollama, port 11435, domyślnie `mistral` | Chat tekstowy; automatyczny start kontenera nie stanowi działającej ścieżki startowej runnera |

Katalog zawiera m.in. `antigravity`, `google-antigravity-2`, `google-antigravity-3`, `google-antigravity-4`, `xai`, `openai-codex` i aliasy modeli. Są to wpisy w kodzie, nie gwarancja dostępności na Twoim koncie. Sprawdź lokalny wynik `pi --list-models`.

Orkiestrator sprawdza `available()` przed wykonaniem. Niedostępny adapter kończy zadanie błędem. Nie ma automatycznego przejścia na płatny model.

## Raporty i telemetria

`AgentReport` zawiera `taskId`, `workerId`, `status`, `summary`, `findings`, `durationMs`. Opcjonalnie: `changes`, `artifacts`, `warnings`, `recommendedNextTasks`, `usage`, `error`.

- Status raportu: `completed`, `failed` albo `partial`.
- Zdarzenia i telemetria trafiają do pliku JSONL.
- Dane o tokenach i kosztach są opcjonalne. Nie stanowią kompletnego rozliczenia.
- Worker dostaje jawny pakiet zadania. Orkiestrator nie dołącza historii rozmowy głównego agenta.
- Adaptery lokalnego chatu widzą tekst pakietu, nie zawartość ścieżek z `relevantFiles`.

## Rozszerzenie Pi i daemon

Punkty wejścia istnieją:

```bash
node bin/pi-many-agents.js daemon
pi --extension ./extensions/index.ts
```

Komenda rozszerzenia: `/many <plan.json>`.

Daemon używa `.pi-many-agents/daemon.sock`, `.pi-many-agents/daemon.pid` i SQLite `.pi-many-agents/state.db`. Ścieżki zależą od bieżącego katalogu procesu.

**Ta ścieżka nie jest obecnie gotowa do użycia:**

- Konstruktor otwiera bazę przed utworzeniem katalogu danych. Świeży katalog kończy się błędem `unable to open database file`.
- Rozszerzenie wysyła `{type, tasks, options, requestId}`, a serwer przepuszcza to przez parser zdarzeń wymagający m.in. `version`, `workerId` i `timestamp`. Poprawne żądanie rozszerzenia zostaje odrzucone.
- Klient nie buforuje ramek JSONL rozdzielonych między porcje danych z socketu.
- Anulowanie używa jednego współdzielonego kontrolera dla wszystkich żądań.
- Store ma CRUD zadań, ale serwer nie zapisuje otrzymanych zadań przez `upsertTask`.

## Izolacja i znane ograniczenia

- Procesy workerów są oddzielne, ale orkiestrator nie tworzy dla nich worktrees. Równoległe zadania zapisujące mogą pracować w tym samym katalogu.
- `PathLockManager` i `WorktreeManager` nie są podłączone do schedulera. Nie polegaj na automatycznej ochronie zmian.
- `permissions` ogranicza dostępne narzędzia Pi. Nie jest sandboxem systemowym. Dostęp do `bash` nie zapewnia technicznego zakazu sieci, Git ani zapisu.
- `L0Advisor` nie jest wywoływany w głównym przepływie. Nie ma jeszcze automatycznej optymalizacji kosztu przez L0.
- Parser raportu nie obsługuje poprawnie zagnieżdżonych obiektów, np. `changes`. Raport workera może też nadpisać informację o błędzie procesu.
- Deduplikacja może usunąć zadanie bez przepisania referencji w `dependencies`.
- Anulowanie workera Pi/Fake sprząta procesy całego współdzielonego adaptera, a nie wyłącznie wskazanego zadania.
- Nie ma automatycznego scalania zmian, dashboardu TUI, otwierania okien terminala ani sterowania tmux.
- Nie ma kosztowego wyboru modeli, automatycznej eskalacji ani dynamicznego dopisywania rekomendowanych zadań do kolejki.

## Struktura kodu

| Katalog | Odpowiedzialność |
| --- | --- |
| `src/core` | Zadania, kolejka, orkiestrator, workery, graf, deduplikacja |
| `src/providers` | Adaptery Fake, Pi, Ollama, Docker Mistral i katalog profili |
| `src/process` | Uruchamianie procesów, timeout i sprzątanie |
| `src/protocol` | Zdarzenia JSONL i raporty |
| `src/daemon` | Unix socket i SQLite |
| `src/worktree` | Worktrees i blokady ścieżek |
| `src/l0` | Opcjonalny lokalny doradca |
| `src/telemetry` | Event bus, JSONL i status tekstowy |
| `extensions` | Komenda `/many` dla Pi |
| `plans` | Plany wcześniejszych etapów i przeglądów |
| `docs/decisions` | Decyzje architektoniczne |
| `test` | Testy oparte na `node:test` |

## Weryfikacja tego snapshotu

Na Node `24.19.0`: **28/28 testów**, `typecheck`, `lint` i `demo` zakończyły się powodzeniem.

To nie potwierdza działania całego systemu. Test `daemon.test.ts` sprawdza store, nie komunikację `/many` z daemonem. `tsconfig.json` nie obejmuje `extensions`. Skrypt lint wyszukuje dwa zabronione fragmenty tekstu, nie wykonuje pełnej analizy statycznej. Adapterów z realnymi modelami nie uruchamiano podczas tego przeglądu.

## Następny etap

1. Naprawić IPC, cykl życia daemona i anulowanie pojedynczych zadań.
2. Ujednolicić walidację planu, wybór providera/modelu i raporty.
3. Przekazywać wyniki zależności i bezpiecznie deduplikować graf.
4. Podłączyć worktrees i blokady, zachowując zmiany po zakończeniu pracy.
5. Dodać testy całej ścieżki, a następnie wrócić do L0 i routingu kosztowego.

Manifest deklaruje licencję MIT; w analizowanym drzewie nie ma osobnego pliku `LICENSE`.
