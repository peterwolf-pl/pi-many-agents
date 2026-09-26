# pi-many-agents

Zewnętrzny orkiestrator agentów dla Pi. Uruchamia zadania równolegle, respektuje zależności i zbiera raporty workerów. Nie modyfikuje rdzenia Pi.

Projekt wykorzystuje TypeScript, procesy Node.js, adapter CLI Pi oraz lokalne adaptery HTTP. Wersja pakietu: `0.1.0`.

## Status

Stan wdrożony po etapie **Stage 3A**:

**Działa runner CLI oraz daemon z rozszerzeniem `/many`.** Zaimplementowano odporny protokół IPC, izolowane anulowanie per-worker, trwałość z `runId` w SQLite, deduplikację z przepisywaniem zależności, przekazywanie raportów do następców oraz izolację zapisu przez Git worktrees i blokady ścieżek.

| Obszar | Stan implementacji |
| --- | --- |
| Kolejka zadań | Priorytety, zależności, graf DAG, limit równoległości i walidacja liczb |
| Obsługa błędów | Timeout, retry, priorytet błędu procesu nad `completed`, ochrona bufora |
| Dostawcy | Proces Pi, profile Pi, Ollama (Qwen4), Docker Model Runner (Mistral); per-worker AbortController |
| Raporty | `AgentReport` z zagnieżdżonymi `changes`, przekazywanie wyników do zależności |
| Dekompozycja | Deterministyczny podział Markdown według nagłówków i list |
| Deduplikacja | Semantyczny fingerprint (workspace, context, constraints, perms) + aliasy |
| Daemon | Serwer Unix socket, pojedyncza instancja, buforowane JSONL, SQLite z `runId` |
| Worktrees | Automatyczna izolacja zadań z `write: true`, blokady ścieżek, zachowanie zmian |
| L0 | Klasyfikacja, kompresja i rekomendacja reasoningu (moduł doradczy; router odroczony) |
| Dashboard | Terminal TUI (Stage 5) z snapshotami IPC, live events, admin run/abort, macOS Terminal.app launcher |

## Wymagania

- Node.js `>=22.6.0` (wymagane przez `node:sqlite` oraz `--experimental-strip-types`). Przetestowano na Node `v26.8.2` / `v24.19.0`.
- npm do instalacji zależności deweloperskich i uruchamiania skryptów.
- Git dla testów i izolacji zadań w worktrees.
- Pi w `PATH` lub własna wartość `piBinary`, jeśli uruchamiasz prawdziwych workerów.
- Dostęp do modeli i uwierzytelnianie konfiguruje się w Pi.
- Ollama lub Docker są opcjonalne, zależnie od wybranego adaptera.

## Szybki start

W katalogu sklonowanego repozytorium:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run demo
```

Demo uruchamia przykładowe zadania z użyciem skonfigurowanego dostawcy. Weryfikuje uruchamianie procesów, kolejkę i raportowanie.

## Uruchamianie planów

```bash
node bin/pi-many-agents.js run --plan plans/stage-2.json --provider pi --concurrency 2 --retries 1
node bin/pi-many-agents.js run --plan plans/stage-next.json --provider pi --concurrency 2
node bin/pi-many-agents.js graph --plan plans/stage-next.json
node bin/pi-many-agents.js decompose brief.md --integrate
```

`decompose` wypisuje JSON na stdout. `graph` wypisuje strukturę grafu w JSON. `run` wypisuje status i raporty; raport o statusie `failed` powoduje kod wyjścia 1.

Precedencja dostawcy: flaga CLI `--provider` ma pierwszeństwo, następnie pole `provider` w pliku planu, a na końcu `defaultProvider` z pliku konfiguracyjnego (`pi`).

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

Zależności sterują kolejnością. **Raporty zależności poprzedników (summary, findings, changes, artifacts) trafiają automatycznie do kontekstu kolejnych zadań**, z zachowaniem deterministycznego limitu wielkości.

## Konfiguracja

Plik `.pi-many-agents.json` w katalogu uruchomienia:

```json
{
  "maxConcurrentWorkers": 2,
  "defaultProvider": "pi",
  "defaultModel": "claude-sonnet-4-6",
  "defaultTimeoutMs": 120000,
  "maxRetries": 1,
  "unhealthyAfterFailures": 3,
  "piBinary": "pi",
  "telemetryPath": ".pi-many-agents/telemetry.jsonl",
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434"
  },
  "mistral": {
    "baseUrl": "http://127.0.0.1:12434/engines/v1",
    "model": "ai/mistral"
  }
}
```

Domyślny routing ustala minimalny reasoning: `none` dla `shell` i `inspect`, `low` dla `test`, `review`, `research`, `medium` dla `code` i `other`.

Jawny reasoning `none` jest rozróżniany od braku wartości (niepodana wartość przyjmuje regułę bazową). Precedencja wyboru dostawcy: flaga CLI (`--provider`) > pole `provider` w pliku planu > domyślna wartość w konfiguracji (`pi`).

## Dostawcy i modele

| Adapter / profil | Wykonanie | Ograniczenia |
| --- | --- | --- |
| `pi` | `pi --print --mode json --no-session --no-extensions` | Wymaga lokalnego Pi i dostępnego modelu |
| Profile Pi | Ten sam adapter z ustawionym dostawcą i modelem | Dostępność profilu sprawdza nazwę dostawcy, nie pełną parę dostawca-model |
| `qwen4` | Ollama, port 11434 (dynamiczny tag lub z konfiguracji) | Chat tekstowy, brak narzędzi, brak auto-pull |
| `gemma4` | Ollama, port 11434, domyślnie `gemma4:latest` | Chat tekstowy, alias kompatybilności wstecznej |
| `mistral` | Docker Model Runner, OpenAI API na porcie 12434 (`ai/mistral`) | Chat tekstowy, brak narzędzi, wymaga aktywnego Docker Model Runnera |

Katalog zawiera m.in. `antigravity`, `google-antigravity-2`, `google-antigravity-3`, `google-antigravity-4`, `xai`, `openai-codex` i aliasy modeli. Są to wpisy w kodzie, nie gwarancja dostępności na Twoim koncie. Sprawdź lokalny wynik `pi --list-models`.

Orkiestrator sprawdza `available()` przed wykonaniem. Niedostępny adapter kończy zadanie błędem. Nie ma automatycznego przejścia na płatny model.

## Raporty i telemetria

`AgentReport` zawiera `taskId`, `workerId`, `status`, `summary`, `findings`, `durationMs`. Opcjonalnie: `changes`, `artifacts`, `warnings`, `recommendedNextTasks`, `usage`, `error`.

- Status raportu: `completed`, `failed` albo `partial`.
- Błąd procesu, timeout lub anulowanie mają bezwzględne pierwszeństwo nad deklaracją `completed` z odpowiedzi LLM.
- Ekstraktor raportów obsługuje zagnieżdżone obiekty `changes` i nawiasy klamrowe w łańcuchach.
- Zdarzenia i telemetria trafiają do pliku JSONL oraz bazy SQLite (`runs`, `tasks`, `reports`, `events`).

## Rozszerzenie Pi i daemon

```bash
pi --extension ./extensions/index.ts
```

Komenda rozszerzenia: `/many <plan.json>`.

`/many` najpierw laczy sie z daemonem w `.pi-many-agents/daemon.sock` wzgledem workspace. Jesli socket nie istnieje albo pozostala po nim nieaktywna sciezka (`ENOENT` / `ECONNREFUSED`), rozszerzenie automatycznie uruchamia odłączony daemon w tym samym katalogu i ponawia polaczenie. Reczne uruchomienie `node bin/pi-many-agents.js daemon` nadal jest wspierane, ale nie jest wymagane dla normalnego uzycia `/many`.

Daemon zarządza stanem w `.pi-many-agents/daemon.sock`, `.pi-many-agents/daemon.pid` oraz SQLite `.pi-many-agents/state.db` w trybie WAL:
- Dedykowany, wersjonowany protokół IPC (`src/protocol/ipc.ts`).
- Ramki JSONL buforowane z obsługą fragmentacji i limitu rozmiaru bufora.
- Bezpieczny start sprawdzający aktywność socketu i tworzący katalog przed bazą.
- Każdy run identyfikowany przez `requestId` i posiadający niezależny `AbortController`.
- Zamknięcie daemona najpierw anuluje aktywne procesy, czeka na ich zakończenie, a następnie bezpiecznie zamyka bazę i pliki socket/pid.

## Terminal Dashboard (Stage 5)

Dashboard to klient TUI podłączony wyłącznie przez IPC do daemona (nie czyta SQLite bezpośrednio). Uruchomienie `pi-many-agents dashboard` na macOS otwiera nowe okno Terminal.app; flaga `--inline` wymusza uruchomienie w bieżącym terminalu (dla testów/CI/non-darwin).

```bash
pi-many-agents dashboard          # macOS: nowe okno Terminal.app
pi-many-agents dashboard --inline # bieżący terminal (zalecane w testach)
pi-many-agents dashboard --new-window # wymuś launcher nawet na non-darwin
```

Klawisze: ↑/k ↓/j wybór runu, Enter=szczegóły, r=refresh, n=uruchom plan (modal), a=abort selected (y/n confirm), x=abort-all (ABORT confirm), q=quit. Zamknięcie dashboardu nie zatrzymuje daemona ani aktywnych runów.

Admin panel pozwala uruchomić plan przez daemon IPC i bezpiecznie anulować wybrane/all runy z potwierdzeniem.

## Izolacja i znane ograniczenia

- Zadania z `permissions.write: true` uruchamiane są w odizolowanych Git worktrees (`.pi-many-agents/worktrees/<runId>/<taskId>`), z blokadami ścieżek przez `PathLockManager`.
- Worktrees z wprowadzonymi zmianami nie są kasowane automatycznie po zakończeniu pracy (brak utraty danych).
- Nie ma automatycznego scalania zmian (auto-merge); integracja kodu musi nastąpić jawnie przez zadanie integracyjne lub użytkownika.
- Uprawnienia `permissions` ograniczają dostępne narzędzia Pi, ale nie stanowią izolacji na poziomie jądra systemu (brak twardego sandboxa OS).
- `L0Advisor` pozostaje modułem pomocniczym (nie wpiętym w produkcyjny routing kosztowy).
- Budżet `maxTokens` nie jest twardo egzekwowany, jeśli dany backend modelu nie udostępnia parametru limitu.

## Skill do pisania promptów Many Agents

Repo zawiera skill `skills/writing-many-agents-prompts/SKILL.md` do przygotowywania wykonywalnych planów JSON dla `pi-many-agents`.

Używaj go przy tworzeniu kolejnych Stage, rozbijaniu większego zadania na DAG workerów, doborze poziomu reasoningu, uprawnień, `writeScope`, zależności i końcowej weryfikacji. Skill uwzględnia aktualne ograniczenia routingu providerów oraz lokalnych adapterów Qwen4 i Mistral.

## Struktura kodu

| Katalog | Odpowiedzialność |
| --- | --- |
| `src/core` | Zadania, plan, kolejka, orkiestrator, workery, graf, deduplikacja |
| `src/providers` | Adaptery Pi, Ollama, Docker Model Runner i katalog profili |
| `src/process` | Uruchamianie procesów, buforowanie stdio, timeout i bezpieczne sprzątanie |
| `src/protocol` | Zdarzenia JSONL, dedykowany protokół IPC i raporty |
| `src/daemon` | Unix socket IPC i trwały SQLite store z obsługą `runId` |
| `src/worktree` | Izolacja Git worktrees i blokady ścieżek |
| `src/l0` | Lokalny doradca reasoningu i kompresji |
| `src/telemetry` | Event bus, JSONL i status tekstowy |
| `extensions` | Komenda `/many` dla Pi z pełną kontrolą typów |
| `plans` | Przykładowe plany i wytyczne etapów |
| `docs/decisions` | Decyzje architektoniczne (ADR) |
| `test` | Testy oparte na `node:test` (52 testy) |

## Weryfikacja

Wszystkie bramki jakości przechodzą:
```bash
npm test       # 52/52 testów przechodzi
npm run typecheck # tsc bez błędów, obejmuje src, test, scripts, extensions
npm run lint   # pomyślnie
npm run demo   # pomyślnie
```
5. Dodać testy całej ścieżki, a następnie wrócić do L0 i routingu kosztowego.

Manifest deklaruje licencję MIT; w analizowanym drzewie nie ma osobnego pliku `LICENSE`.
