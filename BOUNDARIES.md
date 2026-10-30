# BOUNDARIES.md

One section per milestone. Fill them in in order (the sketch before you write
anything about it, the copies next, the proposal last).

Draw Milestone 1's sketch from the code. A TA may ask where each arrow came
from.

Keep it short and specific. Point at modules, files, and callers.

---

## Milestone 1: The architecture as built

**The sketch.** Draw the modules, what each one writes, and the path an
availability request and a booking request each take from the entry point to
storage. Any form works (a Mermaid diagram in this file, or a photo of paper
kept beside it or linked here).

One page. The sketch is done when someone could use it to predict which module
a given change goes in.

Dotted arrows are compile-time dependencies (imports). Solid arrows labelled
**A#** are the availability path and **B#** the booking path.

```mermaid
flowchart TB
  client([HTTP client])

  subgraph HTTP["http-api"]
    Srv["HttpApiServer.route"]
    RH["RoomsHandler.availability"]
    BH["BookingsHandler.create"]
    RA["RequestAuth.require"]
  end
  subgraph ACC["accounts"]
    TOK["AuthorizationService → TokenService.byValue map"]
  end
  subgraph CORE["core-domain"]
    AS["AvailabilityService"]
    BS["BookingService.requestBooking"]
    CC["ConflictChecker → TimeInterval.overlaps"]
  end
  subgraph STO["storage"]
    BKS["InMemoryBookingStore — findConflicts is a 2nd overlap check"]
    WLS["InMemoryWaitlistStore + arrival counter"]
    PUB["EventLogPublisher → InMemoryEventLog list"]
  end
  subgraph NOT["notifications"]
    NS["NotificationService → InMemoryOutbox"]
  end
  subgraph BIL["billing"]
    INV["InvoiceService"]
  end
  subgraph CLIM["cli"]
    CTX["CliContext + commands"]
  end
  FILE[("events.jsonl")]
  PY["analytics - Python"]

  HTTP -.-> CORE
  HTTP -.-> STO
  HTTP -.-> ACC
  HTTP -.-> NOT
  STO -.-> CORE
  NOT -.-> CORE
  ACC -.-> CORE
  BIL -.-> CORE
  BIL -.-> STO
  CLIM -.-> CORE
  CLIM -.-> STO
  CLIM -.-> BIL
  CLIM -->|"export-events writes"| FILE
  FILE -->|"reads"| PY

  client -->|"A1 GET /rooms/id/availability"| Srv
  Srv -->|"A2"| RH
  RH -->|"A3 freeOnDate"| AS
  AS -->|"A4 findConflicts read"| BKS

  client -->|"B1 POST /bookings"| Srv
  Srv -->|"B2"| BH
  BH -->|"B3"| RA
  RA -->|"B4 token lookup"| TOK
  BH -->|"B5"| BS
  BS -->|"B6 conflict check"| CC
  BS -->|"B7a save if free"| BKS
  BS -->|"B7b save if taken"| WLS
  BS -->|"B8 publish"| PUB
  PUB -->|"B9 runtime subscriber"| NS
  ACC -->|"startup user sync"| STO
```

What each module writes, all of it in process memory:

- `storage`: bookings, waitlist rows, rooms and users (`InMemoryRecordStore.java:24`),
  and events (`InMemoryEventLog.java:26`).
- `core-domain`: decides every booking and waitlist write (`BookingService.java:124, 332`)
  but holds no data of its own.
- `accounts`: accounts (`AccountDirectory.java:24`) and tokens (`TokenService.java:31`),
  and it copies users into storage once at startup (`AccountDirectory.java:174`).
- `notifications`: queued messages (`InMemoryOutbox.java:28`).
- `cli`: `events.jsonl`, through `export-events` (`ExportEventsCommand.java:49`).

Evidence for the dotted arrows: each module's `pom.xml`, plus
`grep -rhoE '^import edu\.cmu\.cs214\.campusreserve\.[a-z]+' <module>/src/main | sort | uniq -c`.
The module-level arrows match `ARCHITECTURE.md` exactly.

**Where your sketch and `ARCHITECTURE.md` disagree.** List at least two
places where your drawing and the repository's drawing are not the same
picture, each in one line. Include things you drew that it does not, and things it draws
that you did not.

1. **Availability.** `ARCHITECTURE.md:85` and `AGENTS.md:45-46` say `TimeInterval.overlaps` is the only overlap
   check and availability uses it. In the code, availability uses a second, hand-written check in
   `InMemoryBookingStore.findConflicts` (`InMemoryBookingStore.java:61-62`).
2. **Event log.** `ARCHITECTURE.md:136, 194-196` says the event log outlives a process through
   `JsonlFileEventLogWriter`. In the code, both entry points use `StoreRegistry.inMemory()`, so the
   server's events are lost when it stops.
3. **BookCommand.** `ARCHITECTURE.md:77` names a `BookCommand`. In the code the class is
   `BookingCommands.Book` (`BookingCommands.java:33`).
4. **Drawn here, missing from the doc: the user sync.** `accounts` copies users into storage's user
   store once at startup (`AccountDirectory.java:174-181`, called at `CampusReserveServer.java:54`).
5. **Drawn here, missing from the doc: the subscriber link.** `storage` calls `notifications` at
   runtime through the `EventPublisher` interface, wired at `CampusReservePlatform.java:58`.
6. **Drawn here, missing from the doc: shared JSON escaping.** `http-api` builds its HTTP responses
   with the event log's JSON escaper (`JsonObject.java:3, 96`).

**How you decided which one is right.** For each disagreement above, name the
check that settled it (the imports you read, the callers you listed, the wiring
you traced, the test that pins the behavior). "It looked that way" is not a
check, and neither is "the document says so". Your agent may produce the trace,
but check it before you rely on it.

1. **Callers listed.**
   - `grep -rn '\.overlaps(' --include=*.java */src/main` finds calls only in `ConflictChecker.java`.
   - `grep -rln ConflictChecker --include=*.java */src/main` shows `AvailabilityService` never uses it.
   - `grep -rn findConflicts --include=*.java */src/main` shows `AvailabilityService.java:35, 41`
     calling the storage version.
   - Pinning test: storage's `FindConflictsTest`. Core's `AvailabilityServiceTest` uses a fake store
     (`InMemoryStores.java:109-112`) that does call `overlaps`, so it never runs the real check.
2. **Wiring traced.**
   - `grep -rnE 'withEventLogFile|new JsonlFileEventLogWriter|StoreRegistry\.(inMemory|with)\(' --include=*.java */src/main`
     shows `StoreRegistry.inMemory()` at `CampusReservePlatform.java:44` and `CliContext.java:54`.
   - The same grep finds no production caller of `withEventLogFile`.
   - The writer itself works (`EventLogTest.appendsOneLinePerEvent`); it just isn't wired in.
3. **Grep.** `grep -rn BookCommand --include=*.java .` finds nothing.
4. **Callers listed.** `grep -rn syncInto --include=*.java */src/main` leads to
   `CampusReservePlatform.java:144`, which `CampusReserveServer.java:54` calls once at startup.
5. **Wiring traced.** `CampusReservePlatform.java:58` (`stores.subscribe(notifications)`) feeds
   `EventLogPublisher.java:41` (`subscriber.publish`). Storage has no import of notifications.
6. **Import read.** `http-api/.../JsonObject.java:3` has `import edu.cmu.cs214.campusreserve.storage.JsonLine;`.

---

## Milestone 2: Run it as copies

**Your stack.** The command that brought the stack up with two copies, and how
many distinct `X-Upstream` values your runs saw.

### Finding 1: tokens

**The claim.** One sentence, the one your script checks.

**The script and its result.** The file in `load/`, its threshold, and what a
run printed.

**Why, from the code.** The class that keeps tokens and how it is wired into
each copy. Say how you found it.

**The kind of problem.** Use the vocabulary from lecture.

### Finding 2: bookings

**The claim.**

**The script and its result.** Say how it reaches each copy directly, and why
it has to.

**Why, from the code.**

**The kind of problem.**

### What you checked

One thing your agent proposed that you checked (what it proposed, how you
checked it, and what came of it).

---

## Milestone 3: One boundary

Take one problem from Milestone 1 or 2 and propose the boundary that fixes it.

**The boundary.** The port, what it promises, and which side implements it. Say what
moves and what stays.

**Who owns the data.** Name the module that owns the data this boundary is about,
and say what everybody else is allowed to do with it.

**The one invariant that must not cross.** Exactly one, stated so that a reader
can tell whether a given piece of code violates it.

**What the boundary costs.** An interface to keep, a second implementation to
maintain, a performance argument to have again. Include what it leaves unfixed.

Feel free to read the appendix on what a good proposal looks like in the Lab 3 handout
before you write this section.
