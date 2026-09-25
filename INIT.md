# Projekt techniczny `pi-many-agents`

## Konkluzja architektoniczna

Pomysł jest technicznie bardzo dobrze dopasowany do Pi, ale **nie budowałbym `pi-many-agents` jako kolejnego dużego agenta-orchestratora działającego wewnątrz jednego kontekstu LLM**.

Najlepsza architektura to:

> **Pi pozostaje głównym interfejsem użytkownika. `pi-many-agents` staje się warstwą control-plane, która uruchamia odizolowane procesy Pi i inne agenty, przydziela im modele, reasoning, budżety, katalog roboczy i narzędzia, zbiera wyniki oraz przekazuje do głównego Pi wyłącznie krótkie raporty.**

To jest zgodne z filozofią Pi. Pi celowo nie ma wbudowanego systemu subagentów. Autorzy przewidują budowanie takich mechanizmów poprzez extensions, osobne instancje Pi, SDK, RPC i tmux. Pi obsługuje też własne narzędzia, komendy, eventy, UI, providerów i dynamiczną zmianę modelu oraz poziomu thinking. citeturn3view0turn5view0

Najważniejsza decyzja dotycząca oszczędzania tokenów jest jeszcze bardziej radykalna:

**agent od `ls`, `git status`, `git diff`, sprawdzania czy plik istnieje, wykonywania testów czy monitorowania procesów nie potrzebuje modelu bez reasoningu. Najczęściej nie potrzebuje żadnego LLM.**

Schemat powinien wyglądać tak:

```text
                    UŻYTKOWNIK
                        │
                        ▼
                ┌───────────────┐
                │   MAIN PI     │
                │ rozmowa       │
                │ decyzje       │
                │ synteza       │
                └───────┬───────┘
                        │
                 pi-many-agents
                    extension
                        │
                        ▼
              ┌──────────────────┐
              │ PMA CONTROL PLANE│
              │ scheduler        │
              │ router           │
              │ budgets          │
              │ task DAG         │
              │ event bus        │
              │ persistence      │
              └────────┬─────────┘
                       │
       ┌───────────────┼──────────────────┐
       │               │                  │
       ▼               ▼                  ▼
 deterministic     Pi RPC pool       External agents
 executors         isolated Pi       Codex / Grok /
 no LLM            processes         Antigravity / ...
       │               │                  │
       │        ┌──────┼──────┐           │
       │        ▼      ▼      ▼           │
       │       local  cheap   strong      │
       │       LLM    model   model       │
       │                                  │
       └────────────────┬─────────────────┘
                        │
                        ▼
                 verification
                        │
                        ▼
               compact AgentReport
                        │
                        ▼
                     MAIN PI
```

Pi nadaje się do tego szczególnie dobrze, ponieważ tryb RPC uruchamia go jako długowieczny proces komunikujący się przez JSON po stdin/stdout. Dokumentacja wprost wskazuje RPC jako rozwiązanie do izolowanych subprocessów i własnych klientów. SDK jest natomiast odpowiednie wtedy, gdy sesja ma działać bezpośrednio wewnątrz procesu Node/Bun. citeturn6view0turn6view1

### Czym `pi-many-agents` powinien różnić się od obecnych projektów

Nie warto od zera kopiować `pi-orchestrator`.

Obecny `@redentor_dev/pi-orchestrator` ma już delegowanie do researcherów, implementorów i agentów niestandardowych, indywidualne modele/providerów/thinking, tryby wykonania, status widget oraz `/team` jako panel sterowania. citeturn9view2

Jeszcze bliżej Twojego pomysłu znajduje się `pi-subagents`. Ten projekt ma izolowane subagenty, wykonywanie równoległe, background tasks, sterowanie działającymi agentami, własne modele i thinking, workflow `parallel()` oraz `pipeline()`, liczniki tokenów i widok floty agentów. Domyślna konfiguracja pozwala już na znaczną współbieżność. citeturn9view0

`pi-team-agents` stosuje z kolei osobne konteksty agentów, event-driven mailboxes, task board, shared memory, batch parallelism i pipeline'y. citeturn9view1

Dlatego przewaga `pi-many-agents` nie powinna brzmieć:

> "Potrafi uruchomić wiele agentów."

Powinna brzmieć:

> **"Potrafi zdecydować, kiedy NIE uruchamiać agenta, którego agenta uruchomić, ile reasoning mu dać, ile kontekstu przekazać, jakiego providera użyć i kiedy zakończyć pracę, aby zoptymalizować koszt do czasu i jakości."**

To jest znacznie ciekawszy produkt.

---

## Architektura systemu

### Pi pozostaje nietknięte

`pi-many-agents` powinien składać się z trzech niezależnych elementów:

```text
pi-many-agents/
│
├── extension/
│   └── index.ts
│
├── daemon/
│   ├── scheduler.ts
│   ├── router.ts
│   ├── workers.ts
│   ├── budgets.ts
│   ├── event-bus.ts
│   └── persistence.ts
│
├── dashboard/
│   └── tui.ts
│
├── adapters/
│   ├── pi-rpc.ts
│   ├── deterministic.ts
│   ├── codex.ts
│   ├── grok-build.ts
│   ├── antigravity.ts
│   └── custom.ts
│
├── agents/
├── policies/
├── evals/
└── launcher/
    └── pma
```

Extension byłby bardzo cienki.

Jego zadania:

- rejestrowanie `/many`,
- przekazywanie zadań do daemona,
- odbieranie finalnych raportów,
- pokazywanie minimalnego statusu w samym Pi,
- dostarczanie głównemu agentowi narzędzia typu `delegate_task`,
- reagowanie na start i zamknięcie sesji.

Pi extensions mogą rejestrować narzędzia, komendy, skróty, flagi, event handlers, własnych providerów i komponenty UI. Extension może również zmieniać aktywne narzędzia, model oraz thinking. citeturn5view0

Dzięki temu **niczego nie patchujesz w Pi**.

Aktualizacja Pi nie wymaga utrzymywania forka.

### Osobny daemon jest lepszy od wszystkiego w extension

Polecam:

```text
Pi process
   │
   │ local IPC
   ▼
PMA daemon
```

zamiast:

```text
Pi process
   ├── scheduler
   ├── 10 workers
   ├── dashboard
   ├── persistence
   └── external CLIs
```

Powód jest praktyczny.

Restart lub reload extension nie powinien zabijać całej floty.

Daemon może:

- przeżyć reload UI,
- utrzymywać task graph,
- trzymać worker pool,
- logować wydarzenia,
- pilnować timeoutów,
- kontrolować procesy potomne,
- udostępniać dane kilku dashboardom jednocześnie.

To jest szczególnie istotne, bo istniejące projekty subagentowe napotykają problemy związane z reloadami, wiszącymi narzędziami, zajętymi slotami współbieżności oraz prezentowaniem wielu aktywnych agentów w TUI. citeturn8search1turn8search20turn8search29

### Worker Pi powinien domyślnie być headless

Nie uruchamiałbym:

```text
pi
pi
pi
pi
pi
pi
pi
pi
```

każdego z pełnym interaktywnym TUI.

Uruchamiałbym:

```text
pi --mode rpc --no-session
pi --mode rpc --no-session
pi --mode rpc --no-session
...
```

i kontrolował procesy programowo.

Pi RPC obsługuje między innymi wybór modelu, zmianę thinking, promptowanie, steering, stan sesji i statystyki. Dostępne poziomy thinking obejmują obecnie `off`, `minimal`, `low`, `medium`, `high`, `xhigh` i `max`, przy czym Pi filtruje poziomy nieobsługiwane przez konkretny model. citeturn7view0turn7view1

Dopiero gdy chcesz zobaczyć konkretnego workera:

```text
/many inspect coder-3
```

otwierasz jego widok.

Czyli:

> **proces istnieje zawsze, okno terminala tylko wtedy, gdy jest potrzebne.**

To zmniejsza bałagan i upraszcza sterowanie.

### Izolacja sesji

Każdy worker otrzymuje:

```yaml
task_id: task-72
agent_id: coder-3

backend:
  type: pi-rpc

workspace:
  type: git-worktree
  path: /tmp/pma/job-18/coder-3

model:
  provider: configured-provider
  model: configured-model
  reasoning: medium

limits:
  max_turns: 12
  wall_time: 900
  max_paid_tokens: 80000
  max_cost: configured
  tool_timeout: 180

tools:
  - read
  - write
  - edit
  - bash
```

Jeden worker nie powinien przypadkowo odziedziczyć całej historii głównej rozmowy.

To jest jedna z najważniejszych optymalizacji kosztowych.

### Task DAG zamiast "chatu agentów"

Centralnym obiektem nie powinien być conversation thread.

Powinien nim być graf zadań:

```text
USER TASK
   │
   ▼
analyse repository
   │
   ├───────────────┐
   ▼               ▼
frontend map    backend map
   │               │
   └───────┬───────┘
           ▼
        planning
           │
      ┌────┴────┐
      ▼         ▼
 implement A  implement B
      │         │
      └────┬────┘
           ▼
          tests
           │
           ▼
         review
           │
           ▼
         report
```

Status zadania:

```text
NEW
READY
RUNNING
WAITING
BLOCKED
VERIFYING
DONE
FAILED
CANCELLED
```

Agent jest wykonawcą zadania.

Nie jest zadaniem.

To rozróżnienie pozwala później:

- zamienić model w środku workflow,
- ponowić zadanie innym agentem,
- przerwać workera,
- uruchomić dwa rozwiązania równolegle,
- wykonać review przez innego providera,
- przejąć zadanie ręcznie.

### Jeden adapter dla wszystkich agentów

Podstawowy kontrakt:

```ts
interface AgentBackend {
  id: string;

  capabilities(): Promise<AgentCapabilities>;

  start(spec: TaskSpec): Promise<RunHandle>;

  events(
    handle: RunHandle
  ): AsyncIterable<AgentEvent>;

  steer(
    handle: RunHandle,
    message: string
  ): Promise<void>;

  cancel(
    handle: RunHandle
  ): Promise<void>;

  collect(
    handle: RunHandle
  ): Promise<AgentReport>;
}
```

Implementacje:

```text
PiRpcBackend
DeterministicBackend
CodexBackend
GrokBuildBackend
AntigravityBackend
CustomCliBackend
```

Dzięki temu scheduler nie interesuje się tym, czy agentem jest Gemini uruchomiony przez Pi, Codex czy lokalny model.

Interesują go możliwości:

```yaml
capabilities:
  code_edit: true
  shell: true
  web: false
  persistent_session: true
  steering: true
  structured_events: true
  reasoning_control: true
  local: false
```

### Modele LLM i produkty coding-agent to dwie różne warstwy

To ważne.

Gemini, OpenAI i xAI mogą działać bezpośrednio jako providerzy modeli w Pi. Oficjalna dokumentacja Pi wymienia między innymi OpenAI, Google, xAI oraz lokalne i kompatybilne endpointy, a dodatkowych providerów można definiować poprzez extension. citeturn3view0turn6view5

Dlatego dla zwykłego zadania:

```text
"sprawdź 4 pliki i znajdź przyczynę błędu"
```

lepiej zrobić:

```text
Pi RPC
  -> Google/OpenAI/xAI/local model
```

niż:

```text
uruchom pełny Codex
```

Codex, Grok Build czy Antigravity mają sens jako oddzielne backendy, kiedy chcesz skorzystać z ich własnego agent harnessu, sandboxu, workflow albo specjalnych funkcji.

Grok Build ma terminalowy agent codingowy i udostępnia również tryby nadające się do automatyzacji oraz integracji. xAI rozwija równoległe workflow agentów jako osobną warstwę produktu. citeturn10search1turn10search5turn10search15

Google Antigravity również rozwija obsługę subagentów, agent teams, zadań wykonywanych w tle oraz konfiguracji modeli. citeturn11search8turn11search14

Codex z kolei jest obecnie projektowany do równoległej pracy wielu agentów i izolowanych środowisk roboczych. citeturn13search2turn13search26

Nie integrowałbym natomiast `pi-many-agents` przez automatyczne sterowanie stronami:

```text
chatgpt.com
gemini web
grok web
```

Tam, gdzie istnieje API, CLI, SDK lub strukturalny protokół, adapter powinien używać właśnie jego.

---

## Router modeli, reasoning i oszczędzanie tokenów

To powinien być najważniejszy element całego projektu.

### Najtańszy agent to brak agenta

Przykład:

Użytkownik mówi:

```text
sprawdź czy testy przeszły
```

Zły pipeline:

```text
Main LLM
   ↓
small LLM
   ↓
agent terminal
   ↓
npm test
   ↓
LLM analizuje cały output
   ↓
main LLM
```

Dobry pipeline:

```text
deterministic executor
   ↓
npm test
   ↓
exit code + parser
   ↓
SUCCESS
```

LLM uruchamiasz dopiero, gdy:

```text
exit code != 0
```

i istnieje output wymagający interpretacji.

Podobnie:

| Operacja | LLM | Reasoning |
|---|---:|---:|
| `git status` | nie | brak |
| sprawdź czy plik istnieje | nie | brak |
| policz zmienione pliki | nie | brak |
| uruchom lint | nie | brak |
| pobierz ostatnie 100 linii logu | nie | brak |
| wykryj proces | nie | brak |
| podsumuj 3000 linii logu | lokalny | off/minimal |
| klasyfikuj typ błędu | lokalny/cheap | minimal |
| znajdź potencjalny plik odpowiedzialny za bug | cheap | low |
| prosta implementacja | coding model | low/medium |
| debugging niejednoznaczny | mocniejszy | medium/high |
| projekt architektury | mocniejszy | high |
| trudny konflikt kilku implementacji | mocniejszy | high |
| finalne review krytycznej zmiany | niezależny mocny model | medium/high |

Pi pozwala programowo sterować poziomem thinking workerów, więc taka polityka nie wymaga zmian w Pi. citeturn7view1

### Lokalne LLM jako "warstwa L0"

Lokalny model powinien pełnić kilka funkcji:

```text
L0 local
├── intent classification
├── complexity estimate
├── task decomposition validation
├── log summarisation
├── context compression
├── duplicate detection
├── stuck-agent detection
├── report normalisation
└── escalation recommendation
```

Nie dawałbym mu natomiast bezwarunkowej władzy nad całym systemem.

Lepszy podział:

```text
deterministic policy engine
             +
        local LLM
```

Na przykład:

```text
if task.type === "git-status":
    deterministic

else if task.risk === "low"
     && localRouter.confidence > threshold:
    cheap/local

else:
    escalate
```

Pi oficjalnie obsługuje lokalne modele poprzez llama.cpp router oraz kompatybilne endpointy takie jak Ollama, LM Studio, vLLM i SGLang. Router llama.cpp może również dynamicznie ładować i zdejmować różne modele GGUF. citeturn6view3turn7view3turn7view4

Daje to bardzo ciekawą konfigurację:

```text
tiny local model
    ↓
routing + supervision

medium local model
    ↓
summaries + cheap research

paid fast model
    ↓
routine coding

paid strong model
    ↓
hard debugging / architecture / review
```

### Router nie powinien patrzeć tylko na "trudność"

Decyzja powinna zależeć co najmniej od:

```text
task type
complexity
ambiguity
risk
parallelisability
expected output length
required context
number of affected files
whether writes are required
test status
number of failed attempts
previous agent confidence
provider availability
provider latency
remaining budget
current context usage
```

Przykładowy wynik routera:

```json
{
  "task": "find cause of failing checkout test",
  "class": "debugging",
  "complexity": 0.62,
  "risk": 0.35,
  "parallelism": 0.81,
  "confidence": 0.74,
  "route": {
    "agents": 2,
    "role": "explorer",
    "tier": "cheap",
    "reasoning": "low"
  },
  "escalation": {
    "after_failures": 1,
    "tier": "strong",
    "reasoning": "high"
  }
}
```

Dopiero gdy tani agent się nie sprawdzi:

```text
cheap-low
    ↓ failure
cheap-medium
    ↓ failure
strong-medium
    ↓ uncertain
strong-high
```

a nie:

```text
strong-high
strong-high
strong-high
strong-high
```

Badania nad routingiem LLM pokazują, że dobór mocniejszego lub słabszego modelu na poziomie zapytania może znacząco obniżać koszt przy utrzymaniu jakości na testowanych benchmarkach. Wyników takich jak RouteLLM nie należy jednak traktować jako gwarantowanych oszczędności dla pracy programistycznej. `pi-many-agents` powinien wytrenować lub skalibrować router na Twoich własnych zadaniach. citeturn12search4turn12search28

### Kontekst jest większym problemem niż liczba agentów

Wyobraź sobie rozmowę mającą 80 000 tokenów.

Uruchamiasz 8 agentów.

Jeżeli każdy dostaje cały conversation context:

```text
8 × 80k
```

już na wejściu masz potencjalnie ogromne zużycie tokenów.

Dlatego subagent powinien otrzymywać `ContextPacket`, a nie historię rozmowy.

```yaml
objective:
  Fix checkout race condition.

constraints:
  - do not change public API
  - preserve Node 22 support

relevant_files:
  - src/checkout.ts
  - src/queue.ts
  - tests/checkout.test.ts

observations:
  - test fails ~20% of runs
  - failure started after commit X

task:
  Determine likely root cause.
  Do not modify files.

output:
  AgentReport v1
```

To może mieć kilkaset lub kilka tysięcy tokenów zamiast dziesiątek tysięcy.

### Agent powinien zwracać raport, nie transcript

Nigdy:

```text
Main Pi <- pełne 14 000 tokenów rozmowy subagenta
```

Zamiast tego:

```json
{
  "status": "success",
  "summary": "Race originates in queue shutdown handling.",
  "findings": [
    {
      "file": "src/queue.ts",
      "lines": "118-143",
      "confidence": 0.91
    }
  ],
  "files_read": 7,
  "files_modified": [],
  "commands": [
    "npm test -- checkout"
  ],
  "tests": {
    "passed": 14,
    "failed": 1
  },
  "confidence": 0.89,
  "needs_escalation": false,
  "artifacts": [
    "jobs/42/agents/explorer-2/report.md"
  ]
}
```

Do głównego Pi wchodzi:

```text
Explorer-2 completed.
Root cause likely queue shutdown race in src/queue.ts.
Confidence: 0.89.
Full report available as artifact.
```

Pi już dzisiaj ma mechanizmy compaction, a extension może przejąć compaction i wygenerować podsumowanie własnym modelem. Dokumentacja wskazuje też, że wyniki narzędzi takich jak `read` i `bash` są istotnym źródłem wzrostu kontekstu. citeturn6view6turn7view5

RPC daje dodatkowo bardzo użyteczną możliwość wykonania bash z zachowaniem wyniku, ale bez dodawania go do kontekstu modelu poprzez `excludeFromContext`. citeturn7view2

To powinien być jeden z podstawowych mechanizmów PMA.

### Lokalny summariser przed płatnym modelem

Przykład:

```text
12 000 tokenów logów
         │
         ▼
 local summariser
         │
         ▼
700-token DiagnosticSummary
         │
         ▼
 expensive debugger
```

Płatny debugger nie powinien analizować:

```text
node_modules warning...
node_modules warning...
node_modules warning...
```

jeżeli lokalny proces może wcześniej odsiać 95 procent nieistotnego materiału.

### Koszt trzeba liczyć na żywo

Pi RPC udostępnia statystyki sesji obejmujące zużycie tokenów, cache, koszt i wykorzystanie context window. citeturn7view2

Dashboard powinien zatem pokazywać:

```text
JOB COST
Paid tokens       182k
Local tokens      940k
Cache read        410k
Current cost      ...
Budget used       34%
Estimated remain  66%
```

oraz osobno:

```text
coder-1     ...
reviewer-1  ...
explorer-2  ...
```

Wtedy router może naprawdę optymalizować.

Nie "wydaje mu się", że dany model jest tani.

Ma telemetry.

### Dwa wymiary routingu

Nie ograniczałbym polityki do:

```text
small model
medium model
big model
```

Powinny istnieć dwa niezależne wymiary:

```text
MODEL CAPABILITY
local -> cheap -> capable -> strongest

REASONING BUDGET
off -> minimal -> low -> medium -> high
```

Możesz wtedy mieć:

```text
strong model + low reasoning
```

dla krótkiego, ale specjalistycznego kodowania.

Albo:

```text
cheap model + medium reasoning
```

dla zadania wymagającego planowania, ale nie dużej wiedzy.

To jest znacznie lepsze niż sztywne profile.

---

## Scheduler i współpraca agentów

### Nie uruchamiaj kilkunastu agentów tylko dlatego, że możesz

System może obsługiwać:

```text
1
2
4
8
12+
```

agentów.

Ale scheduler powinien sam zdecydować, ilu faktycznie warto uruchomić.

Istniejące systemy Pi także zwracają uwagę, że multi-agent nie ma sensu dla jednego prostego pliku, krótkiego Q&A ani pracy, której nie można podzielić. citeturn9view3

Przykład:

```text
change button colour
```

Powinno dać:

```text
1 agent
```

Nie:

```text
planner
researcher
UI researcher
coder 1
coder 2
reviewer
tester
supervisor
```

Natomiast:

```text
migrate 40 modules from API v2 to v3
```

może dać:

```text
          Planner
             │
     ┌───────┼────────┐
     ▼       ▼        ▼
 worker-1 worker-2 worker-3
     │       │        │
     └───────┼────────┘
             ▼
          reviewer
             │
             ▼
            tests
```

### Dynamiczna liczba workerów

Proponuję:

```text
desired_workers =
    min(
        DAG_ready_tasks,
        global_concurrency_limit,
        provider_concurrency_limit,
        budget_limit,
        workspace_limit
    )
```

Default mógłby być ostrożny, na przykład kilka równoległych workerów, a maksymalny limit konfigurowalny do 12, 16 lub więcej.

Nie robiłbym domyślnie `12`.

### Typy agentów

Nie potrzebujesz 30 person.

Potrzebujesz kilku klas wykonawczych:

| Klasa | Funkcja | Typowy koszt |
|---|---|---|
| `executor` | terminal, git, testy, pliki | zero LLM |
| `sentinel` | monitoring i klasyfikacja | local |
| `explorer` | wyszukiwanie informacji w repo | local/cheap |
| `researcher` | dokumentacja, analiza | cheap/capable |
| `coder` | implementacja | capable |
| `debugger` | trudne problemy | capable/strong |
| `reviewer` | niezależna walidacja | capable/strong |
| `architect` | ważne decyzje | strong |

Profile można później rozszerzać deklaratywnie:

```yaml
name: seo-schema-reviewer
role: reviewer

preferred:
  tier: capable
  reasoning: medium

tools:
  - read
  - grep

write_access: false
```

Obecny `pi-orchestrator` pokazuje, że profile agentów z providerem, modelem, thinking, tools i execution mode dobrze pasują do modelu konfiguracji Pi. citeturn9view2

### Parallel first tylko wtedy, gdy zadania są niezależne

Scheduler przed `fan-out` powinien ustalić:

```text
A modifies auth.ts
B modifies checkout.ts
C modifies docs.md
```

Można:

```text
A || B || C
```

ale:

```text
A modifies auth.ts
B modifies auth.ts
```

powinno zwykle zostać:

```text
A -> B
```

albo oba rozwiązania powstają niezależnie i tylko jedno trafia później do merge.

### Git worktrees

Coding agents powinny domyślnie dostać osobne worktrees:

```text
repo/
worktrees/
├── task-42-coder-a/
├── task-42-coder-b/
└── task-42-review/
```

Dzięki temu:

- agent A nie widzi częściowo zapisanych zmian B,
- agent B nie niszczy zmian A,
- można porównać dwie implementacje,
- łatwo usunąć nieudaną próbę,
- merge jest kontrolowany.

Read-only explorerzy mogą współdzielić główny katalog.

### Single-writer rule

Dodatkowo wprowadziłbym resource locks:

```text
src/auth.ts
    owner: coder-2

package.json
    owner: migration-1
```

Scheduler blokuje drugiego write agenta albo tworzy mu osobny branch/worktree.

### Reviewer nie powinien wiedzieć wszystkiego

Dla bardziej niezależnego review:

```text
Coder report:
"I implemented X because Y"
```

nie powinien być pierwszą rzeczą, jaką dostanie reviewer.

Lepsze:

```text
Reviewer receives:
- objective
- constraints
- resulting diff
- tests

Reviewer does NOT initially receive:
- coder justification
- coder confidence
```

Dopiero później można porównać opinie.

Zmniejsza to anchoring.

### Escalation tree

Bardzo ważna funkcja:

```text
explorer-low
   │
   ├── confidence >= 0.8 -> DONE
   │
   └── confidence < 0.8
          │
          ▼
      debugger-medium
          │
          ├── solved -> DONE
          │
          └── failed
                 │
                 ▼
             strong-high
```

Tak powinien działać reasoning.

Nie ustawiasz `high` z góry.

Kupujesz go dopiero wtedy, kiedy pojawia się dowód, że jest potrzebny.

### Heartbeats i watchdog

Każdy agent:

```text
heartbeat every N seconds
```

Daemon śledzi:

```text
last_event
last_tool_call
current_tool
tool_runtime
tokens_since_progress
files_touched
```

Przykład:

```text
coder-4
RUNNING
tool: npm test
elapsed: 07:42
last output: 06:58 ago
```

To może wywołać:

```text
WARN
```

potem:

```text
INTERRUPT
```

a następnie:

```text
KILL + retry
```

To nie jest detal. W istniejącym `pi-subagents` opisano przypadek, w którym wiszący tool call zajmuje slot współbieżności, ponieważ limit turnów nie pomaga, jeśli samo wywołanie narzędzia nigdy nie kończy się. citeturn8search20

Potrzebujesz więc osobnych limitów:

```yaml
max_turns: 12
max_wall_time: 15m
max_tool_time: 3m
max_idle_time: 90s
max_paid_tokens: ...
max_cost: ...
```

### Brak cichego fallbacku providera

Krytyczna zasada:

```text
requested:
  provider: LOCAL

LOCAL unavailable
```

Nie wolno zrobić automatycznie:

```text
LOCAL unavailable
      ↓
OpenAI strong paid model
```

bez zgody polityki.

Podobny problem został zgłoszony w ekosystemie `pi-subagents`, gdzie nieprawidłowe przypięcie providera może prowadzić do użycia innej, potencjalnie płatnej ścieżki. citeturn8search14

PMA powinien mieć:

```yaml
fallback:
  allow_cross_provider: false
  allow_paid_upgrade: false

  explicit:
    local-small:
      - local-medium

    paid-fast:
      - paid-fast-secondary
```

oraz tryb:

```text
COST LOCK
```

Wtedy żaden agent nie może sam zwiększyć kosztu.

---

## Terminal, dashboard i doświadczenie użytkownika

Twoja koncepcja 2-3 kolumn jest dobra, ale nie implementowałbym wszystkich kolumn wewnątrz renderera Pi.

Pi ma własny system TUI i dokumentacja wyraźnie zaleca, aby extension nie uruchamiało drugiego renderera terminalowego wewnątrz tego samego UI. Komponenty powinny być lekkie i poprawnie reagować na zmianę szerokości terminala. citeturn5view1

Dlatego najlepiej rozdzielić:

```text
tmux
├── pane 1: native Pi
├── pane 2: pma fleet dashboard
└── pane 3: pma task/cost dashboard
```

Pi samo wskazuje tmux jako naturalny sposób pracy z dodatkowymi instancjami i background processes. citeturn3view0turn6view4

### Launcher

Uruchamiasz:

```text
pma
```

albo:

```text
pi-many-agents
```

Launcher:

```text
1. wykrywa terminal
2. odczytuje szerokość i wysokość
3. uruchamia/łączy PMA daemon
4. tworzy tmux session
5. uruchamia Pi z extension
6. uruchamia dashboard
7. układa layout
```

Przykładowo:

```bash
pma
```

efektywnie uruchamia logicznie:

```text
tmux new-session
    pi --extension pi-many-agents
```

plus procesy dashboardu.

### Maksymalizacja okna

Tutaj warto oddzielić dwie rzeczy:

```text
A. zajęcie całej powierzchni aktualnego terminala
B. maksymalizacja okna emulatora terminala na pulpicie
```

A jest proste.

B zależy od emulatora terminala i systemu operacyjnego.

Nie projektowałbym core PMA wokół emulatora konkretnego producenta.

Zamiast tego:

```yaml
ui:
  maximize: auto

  terminal_adapters:
    wezterm: ...
    kitty: ...
    custom: ...
```

oraz:

```yaml
ui:
  maximize_command: ""
```

Launcher próbuje adaptera. Jeżeli go nie ma, wykorzystuje całą dostępną przestrzeń terminala.

### Layout na szerokim ekranie

Przykład 3 kolumn:

```text
┌────────────────────────────────┬──────────────────────┬───────────────────────┐
│ MAIN PI                        │ AGENT FLEET          │ TASKS / COST / EVENTS │
│                                │                      │                       │
│ > implement payment retry      │ ● coder-1            │ JOB #128              │
│                                │   OpenAI / med       │ ███████░░░ 68%        │
│ I'll inspect...                │   editing retry.ts   │                       │
│                                │   01:42              │ $ budget    31%       │
│                                │                      │ paid tok     182k     │
│                                │ ● explore-2          │ local tok    904k     │
│                                │   local / off        │                       │
│                                │   grep/read          │ TASK DAG              │
│                                │                      │ ✓ explore repo        │
│                                │ ● reviewer-1         │ ✓ locate bug          │
│                                │   waiting            │ ● implementation      │
│                                │                      │ ○ tests               │
│                                │ 3 active / 8 slots   │ ○ review              │
│                                │                      │                       │
│                                │                      │ EVENTS                │
│                                │                      │ 14:31 coder started   │
│                                │                      │ 14:32 tests failed    │
│                                │                      │ 14:32 retry routed    │
└────────────────────────────────┴──────────────────────┴───────────────────────┘
```

Rekomendowałbym około:

```text
main Pi      55-60%
fleet        20-25%
tasks/cost   reszta
```

To są wartości projektowe, nie ograniczenia Pi.

### Layout na średnim ekranie

```text
┌────────────────────────────────────┬──────────────────────────┐
│ MAIN PI                            │ PMA DASHBOARD            │
│                                    │                          │
│                                    │ [Fleet] [Tasks] [Cost]  │
│                                    │                          │
│                                    │ coder-1 RUNNING         │
│                                    │ explorer-1 DONE          │
│                                    │ reviewer WAIT            │
│                                    │                          │
└────────────────────────────────────┴──────────────────────────┘
```

Panel po prawej przełącza zakładki:

```text
Fleet
Tasks
Graph
Cost
Events
Logs
```

### Proponowany algorytm layoutu

Na przykład:

```text
cols >= 180
    -> 3 columns

120 <= cols < 180
    -> 2 columns

cols < 120
    -> 2 narrow columns
       or configurable dashboard toggle
```

Nie kodowałbym breakpointów na sztywno.

```yaml
ui:
  layout:
    three_columns_min_width: 180
    two_columns_min_width: 120
```

### Fleet view

Najważniejszy ekran:

```text
AGENTS  4/10 running

ID       ROLE       BACKEND   MODEL   R    STATE      TIME   TOKENS
a-17     explore    pi/local  local   off  RUNNING    0:31   18k
a-18     explore    pi/x      fast    low  RUNNING    0:28   7k
a-19     coder      codex     ...     med  RUNNING    1:42   31k
a-20     review     pi/...    ...     high WAITING       -     -
```

Niżej:

```text
a-19
TASK   implement retry queue
TOOL   edit src/retry.ts
AGE    00:17
CTX    29%
COST   ...
```

Istniejące rozszerzenia Pi pokazują już przydatność live widgetów ze stanem narzędzi i tokenów, więc PMA powinien ten wzorzec rozwinąć, a nie wracać do zwykłego tekstowego logu. citeturn9view0

### Task view

```text
TASKS

✓ T1 inspect architecture
├─ ✓ T2 inspect API
├─ ✓ T3 inspect tests
│
● T4 implement retry
├─ worker coder-1
├─ 3 files
└─ 01:42
│
○ T5 run integration tests
○ T6 independent review
○ T7 final synthesis
```

### Cost view

```text
BUDGET

Cloud spend       37%
Paid input        128k
Paid output        31k
Cache read        441k
Local tokens       1.2m

SAVED BY ROUTER
No-LLM ops         47
Local routes       18
Cloud escalations   4
```

"SAVED" należy liczyć tylko na podstawie zdefiniowanego baseline, a nie wymyślać hipotetyczną kwotę.

### Inspect agent

```text
/many inspect a-19
```

powinno otworzyć popup albo chwilowy pane:

```text
┌─ coder-1 ─────────────────────────────────────────────┐
│ task: implement retry                                │
│ model: ...                                           │
│ reasoning: medium                                    │
│                                                      │
│ > reading src/retry.ts                               │
│ > reading tests/retry.test.ts                        │
│ > editing src/retry.ts                               │
│                                                      │
│ latest: ...                                          │
└──────────────────────────────────────────────────────┘
```

Ważne: panel nie powinien pokazywać ukrytego chain-of-thought modeli.

Wystarczy:

```text
task
status
tool
tool arguments
result
elapsed
files
tokens
confidence
report
```

### Komendy użytkownika

Minimalny zestaw:

```text
/many
/many status
/many agents
/many tasks
/many inspect <agent>
/many pause
/many resume
/many cancel <task>
/many kill <agent>
/many budget
/many graph
/many cost
/many route <task>
/many local-only on
/many cost-lock on
```

Bardzo przydatne byłyby też:

```text
/many why a-19
```

wynik:

```text
Why was coder-1 selected?

task type        code implementation
complexity       medium
risk             medium
local confidence insufficient
selected tier    capable
reasoning        medium
paid fallback    disabled
```

To zapewnia obserwowalność routera.

---

## Samorozwój bez modyfikowania Pi

Tutaj zdecydowanie odradzam system:

```text
agent wykrywa, że czegoś mu brakuje
    ↓
edytuje własny production code
    ↓
reload
    ↓
kontynuuje
```

To prędzej czy później zepsuje orchestrator podczas ważnej pracy.

"Samorozwijający się" powinien oznaczać trzy znacznie bezpieczniejsze mechanizmy.

### Samorozwój konfiguracji

PMA może sam tworzyć profile:

```text
agents/
  postgres-debugger.yaml
  react-reviewer.yaml
  seo-auditor.yaml
```

Agent główny zauważa:

```text
Robimy dużo PostgreSQL debugging.
```

i proponuje:

```yaml
name: postgres-debugger
tier: capable
reasoning: medium

tools:
  - read
  - bash

instructions:
  - inspect migrations first
  - never mutate production database
```

Nie zmienił się żaden kod PMA.

### Samouczenie routingu

PMA zapisuje telemetry:

```text
task characteristics
route chosen
model
reasoning
tokens
cost
latency
number of retries
tests passed
review score
user correction
accepted/rejected
```

Po kilkudziesięciu lub kilkuset zadaniach można odkryć:

```text
"For repo exploration local-medium succeeds in 94% accepted cases."
```

albo:

```text
"high reasoning provides no measurable improvement for lint fixes."
```

Wtedy system generuje propozycję:

```diff
routing:
  lint_fix:
-   model_tier: capable
-   reasoning: medium
+   model_tier: local
+   reasoning: low
```

Najpierw shadow evaluation.

Potem wdrożenie.

### Samorozwój kodu PMA

Dla samego projektu:

```text
telemetry
    ↓
detect weakness
    ↓
create improvement task
    ↓
agent creates branch
    ↓
tests
    ↓
PMA benchmark suite
    ↓
independent review
    ↓
candidate release
```

Nie:

```text
modify current running version
```

Czyli PMA może rozwijać własne repozytorium, ale dokładnie tak samo jak każdy inny projekt programistyczny.

### Versioned self-improvement

Struktura:

```text
~/.pi/agent/pi-many-agents/
├── config.yaml
├── agents/
├── policies/
├── state/
├── telemetry/
└── proposals/
```

Kod extension pozostaje wersjonowany osobno.

Każda zmiana policy:

```text
policy-v17
policy-v18
policy-v19
```

może być cofnięta.

### Persistence

Do stanu operacyjnego użyłbym SQLite.

Schemat logiczny:

```text
jobs
tasks
task_dependencies
agents
runs
events
artifacts
budgets
metrics
routing_decisions
provider_usage
```

Przykład:

```text
runs

id
task_id
agent_id
backend
provider
model
reasoning
started_at
finished_at
status
input_tokens
output_tokens
cache_tokens
cost
retry_of
```

Dzięki temu po awarii:

```text
pma
```

odtwarza:

```text
job #128

T1 DONE
T2 DONE
T3 RUNNING but worker missing
T4 WAITING
```

i może zapytać policy engine:

```text
resume T3
or
restart T3
```

### Extension nie może być traktowane jak sandbox

To kluczowy aspekt bezpieczeństwa.

Dokumentacja Pi podkreśla, że extensions działają z uprawnieniami procesu Pi i mogą uzyskać dostęp do promptów, tool calls, plików, credentials oraz historii sesji. Sam mechanizm extension nie jest sandboxem. citeturn4view0turn5view0

Dlatego w PMA powinny istnieć capability policies.

Przykład explorer:

```yaml
filesystem:
  read: repository
  write: false

shell:
  allow:
    - git
    - rg
    - find
    - cat
```

Coder:

```yaml
filesystem:
  read: worktree
  write: worktree

network:
  enabled: false
```

Reviewer:

```yaml
filesystem:
  read: true
  write: false
```

Agent od terminala absolutnie nie powinien automatycznie mieć:

```text
rm
sudo
ssh
curl arbitrary
git push
```

tylko dlatego, że jest tani.

### Policy enforcement ma być deterministyczny

Błąd architektoniczny:

```text
LLM:
"czy agent może wykonać rm -rf?"

LLM:
"tak"
```

Lepsze:

```text
PolicyEngine:
DENIED
```

LLM może zaproponować akcję.

Kod decyduje, czy wolno ją wykonać.

---

## Specyfikacja MVP i droga do wersji docelowej

Nie próbowałbym implementować Codex + Grok + Antigravity + Gemini + OpenAI + lokalne modele + samouczenie już w pierwszej wersji.

Najpierw trzeba udowodnić, że scheduler rzeczywiście działa.

### Rdzeń MVP

Pierwsze wydanie powinno obsługiwać wyłącznie:

```text
Main Pi
   +
pi-many-agents extension
   +
PMA daemon
   +
Pi RPC workers
   +
deterministic executor
   +
local Pi worker
```

Pi już zapewnia provider abstraction, dlatego poprzez same procesy Pi dostajesz dostęp do szerokiego zestawu providerów bez implementowania osobnego adaptera do każdego API. citeturn3view0turn6view5

MVP:

```text
/many
/many status
/many inspect

delegate_task()
Task DAG
worker pool
parallel execution
Pi RPC
model selection
reasoning selection
timeouts
budgets
AgentReport
SQLite state
basic dashboard
```

To już będzie użyteczne.

### Następny etap

Dodać:

```text
tmux adaptive layout
2/3 columns
worktrees
resource locks
provider quotas
cost lock
local sentinel
context packets
local summarisation
report compaction
retry/escalation policies
```

### Adaptery zewnętrzne

Dopiero później:

```text
CodexAdapter
GrokBuildAdapter
AntigravityAdapter
```

Każdy musi przejść capability discovery.

Na przykład:

```json
{
  "backend": "grok-build",
  "capabilities": {
    "headless": true,
    "structured_events": true,
    "steering": true,
    "resume": true,
    "sandbox": true
  }
}
```

Jeśli jakaś funkcja nie istnieje:

```text
false
```

Nie symulujesz jej przez parsowanie ANSI z interaktywnego terminala.

### Generic CLI adapter

Dla przyszłych narzędzi:

```yaml
backends:

  my-agent:
    command:
      - my-agent
      - run
      - --json

    input: stdin
    events: jsonl
    result: json

    cancel:
      signal: SIGTERM
```

To pozwala integrować nowe narzędzia bez zmiany core.

### Konfiguracja agentów

Przykład docelowego pliku:

```yaml
agents:

  filesystem:
    backend: deterministic

  local-sentinel:
    backend: pi
    provider: local
    model: configured-local-small
    reasoning: off
    permissions:
      write: false

  explorer:
    backend: pi
    tier: cheap
    reasoning: low
    permissions:
      write: false

  coder:
    backend: pi
    tier: capable
    reasoning: auto
    workspace: worktree

  debugger:
    backend: pi
    tier: strong
    reasoning: auto
    workspace: worktree

  reviewer:
    backend: pi
    tier: strong
    reasoning: medium
    permissions:
      write: false
```

### Router configuration

```yaml
routing:

  strategy: adaptive

  prefer:
    deterministic_first: true
    local_first: true

  escalation:
    enabled: true
    max_levels: 3

  reasoning:
    default: low
    allow_high_on:
      - architecture
      - hard_debugging
      - conflicting_results

  parallel:
    default_limit: 4
    hard_limit: 12

  fallback:
    cross_provider: false
    paid_upgrade: false
```

### Global budgets

```yaml
budgets:

  job:
    paid_tokens: ...
    cost: ...
    wall_time: 45m

  agent:
    turns: 20
    wall_time: 15m
    idle_time: 90s
    tool_time: 3m

  provider:
    concurrent: ...
```

### Raport standardowy

Warto od początku ustalić jeden protokół:

```ts
interface AgentReport {
  version: 1;

  taskId: string;
  agentId: string;

  status:
    | "success"
    | "partial"
    | "failed"
    | "blocked";

  summary: string;

  findings: Finding[];

  changes: {
    files: string[];
    worktree?: string;
    commit?: string;
  };

  validation: {
    commands: string[];
    passed: string[];
    failed: string[];
  };

  confidence: number;

  blockers: string[];

  suggestedNextActions: string[];

  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cost?: number;
    wallTimeMs: number;
  };

  artifacts: string[];
}
```

Dzięki temu główny Pi nie musi rozumieć:

```text
Codex output format
Grok output format
Antigravity output format
Pi RPC output format
```

Widzi tylko `AgentReport`.

### Właściwa pętla wykonawcza

Docelowo jedno polecenie użytkownika powinno przechodzić tak:

```text
1. User -> Main Pi

2. Main Pi identifies task

3. PMA receives TaskSpec

4. deterministic classifier checks:
   - can this be solved without LLM?

5. local router estimates:
   - complexity
   - risk
   - parallelism
   - context requirements

6. scheduler builds DAG

7. context builder creates minimal packets

8. scheduler dispatches READY nodes

9. workers emit events

10. sentinel monitors:
    - progress
    - tokens
    - duplication
    - stalls
    - cost

11. failures trigger escalation policy

12. coding outputs enter verification

13. reviewer checks accepted artifact

14. reports are compacted

15. only useful summary returns to Main Pi

16. Main Pi answers user
```

### Kluczowa zmiana względem klasycznego orchestratora

Nie:

```text
MAIN LLM
  continuously thinks about
  8 agents
  continuously receives
  their messages
```

Tylko:

```text
          deterministic control plane
                  │
             local sentinel
                  │
  ┌───────────────┼────────────────┐
 agent           agent            agent
  │               │                │
 events          events           events
  └───────────────┼────────────────┘
                  │
         relevant milestones only
                  │
                  ▼
               MAIN LLM
```

Główny model nie powinien płacić tokenami za:

```text
agent started
agent read file
agent read next file
agent is thinking
agent ran grep
agent ran git status
agent test still running
```

To jest telemetry dla daemona i dashboardu.

### Jak ocenić, czy PMA rzeczywiście działa

Nie mierzyłbym sukcesu liczbą uruchomionych agentów.

Najważniejsze metryki:

```text
time_to_verified_result
paid_cost_per_accepted_task
paid_tokens_per_accepted_task
success_rate
first_pass_success
retries_per_task
human_interventions
merge_conflicts
wasted_agent_runs
local_to_paid_ratio
```

Benchmark:

```text
50-100 rzeczywistych zadań z Twojej pracy
```

dla każdego:

```text
A: normal Pi
B: pi-many-agents
```

Porównujesz:

```text
             Pi        PMA
time
paid tokens
cost
quality
retries
manual fixes
```

**PMA jest lepszy tylko wtedy, gdy obniża czas lub koszt przy zachowaniu jakości.**

Jeżeli dla prostego zadania:

```text
Pi       40 s
PMA      75 s
```

router powinien się nauczyć:

```text
do not orchestrate this class
```

To jest właśnie właściwy "self-improving orchestrator".

### Docelowa hierarchia

Ostatecznie projekt powinien wyglądać mniej więcej tak:

```text
L0 - SYSTEM
deterministic scheduler
filesystem
git
process monitor
budgets
permissions
timeouts

L1 - LOCAL CONTROL
local classifier
local summariser
local sentinel
local context compressor

L2 - CHEAP AGENTS
explorers
researchers
routine tasks

L3 - CAPABLE AGENTS
coding
debugging
implementation

L4 - STRONG AGENTS
architecture
hard debugging
independent review
conflict resolution

L5 - MAIN PI
interaction with you
high-level decisions
final synthesis
```

To jest ważniejsze niż stworzenie hierarchii:

```text
boss
manager
team lead
developer
junior developer
research manager
```

Anthropomorfizacja agentów wygląda efektownie, ale niekoniecznie daje lepszy scheduler.

### Najważniejsze zasady projektowe

`pi-many-agents` powinien być budowany według kilku reguł:

1. **No LLM before cheap deterministic execution.**

2. **Local before paid, jeśli jakość zadania na to pozwala.**

3. **Low reasoning before high reasoning.**

4. **Minimal context, nie pełna historia.**

5. **Reports, nie transcripts.**

6. **Parallelise independent work only.**

7. **One writer per resource.**

8. **Separate implementation and verification.**

9. **Hard budgets and hard timeouts.**

10. **Never silently escalate to a paid provider.**

11. **Main Pi receives milestones, nie event stream.**

12. **Self-improvement through telemetry, evals and versioned proposals, nie live self-modification.**

Najbardziej wartościowym elementem tego projektu nie będzie więc możliwość pokazania:

```text
12 agents running
```

ale możliwość pokazania:

```text
Task completed

Wall time             4m 18s
Agents used            5
LLM-free operations   47
Local agents           3
Paid agents            2
High-reasoning calls   1
Paid context avoided   ...
Tests                  PASS
Independent review     PASS
```

Wtedy `pi-many-agents` staje się nie tylko multi-agent frameworkiem, ale **warstwą optymalizującą wykorzystanie inteligencji obliczeniowej**.

I właśnie ten kierunek odróżniałby go od zwykłego `pi-orchestrator`, `pi-subagents` czy systemu otwierającego kilkanaście sesji obok siebie.

## Źródła

- Pi - oficjalna strona i opis architektury, rozszerzeń, providerów, subagentów i tmux. citeturn3view0
- Pi Documentation - oficjalna dokumentacja terminal agent i modelu bezpieczeństwa extensions. citeturn4view0
- Pi Extensions - oficjalna dokumentacja Extension API, lifecycle, tools, events, UI i nested model calls. citeturn5view0
- Pi TUI - oficjalna dokumentacja terminalowego systemu komponentów i renderowania. citeturn5view1
- Pi SDK - oficjalna dokumentacja osadzania sesji Pi i AgentSession. citeturn6view0turn7view6
- Pi RPC - oficjalna dokumentacja procesu RPC i protokołu sterowania. citeturn6view1turn6view2
- Pi RPC commands - oficjalna dokumentacja dynamicznego modelu, thinking, bash oraz session statistics. citeturn7view0turn7view1turn7view2
- Pi Local Models - oficjalna dokumentacja llama.cpp oraz kompatybilnych lokalnych endpointów. citeturn6view3turn7view3turn7view4
- Pi Compaction - oficjalna dokumentacja zarządzania kontekstem i własnego compaction. citeturn6view6turn7view5
- `@redentor_dev/pi-orchestrator` - oficjalny wpis pakietu Pi. citeturn9view2
- `tintinweb/pi-subagents` - repozytorium projektu i jego model równoległych subagentów. citeturn9view0
- `pi-subagents` - zgłoszenia dotyczące wiszących tools, reload, UI i provider fallback. citeturn8search1turn8search14turn8search20turn8search29
- `pi-team-agents` - repozytorium systemu agent teams, mailboxów i task board. citeturn9view1
- Ant Colony for Pi - repozytorium wieloagentowego execution layer dla Pi. citeturn9view3
- Google Antigravity - oficjalna dokumentacja i materiały dotyczące subagentów, local models i teamwork. citeturn11search8turn11search14
- xAI Grok Build - oficjalne materiały i repozytorium dotyczące coding agenta oraz parallel workflows. citeturn10search1turn10search5turn10search15
- OpenAI Codex - oficjalne materiały dotyczące agentic coding i równoległej pracy agentów. citeturn13search2turn13search26
- RouteLLM - praca badawcza i implementacja dotycząca dynamicznego routingu pomiędzy modelami o różnym koszcie i możliwościach. citeturn12search4turn12search28
