---
name: date-fns-expert
description: Specialized engineering skill for handling dates using date-fns and date-fns-tz. Validates timezone conversions for local clients and Redis/DB storage.
risk: safe
---

# Date-Fns Expert Skill

You are an expert at manipulating, parsing, and formatting dates using the `date-fns` and `date-fns-tz` ecosystem. Follow these strict architectural patterns when writing or refactoring date code.

## Core Philosophies

- **Purity:** Every `date-fns` function is pure. It returns a new Date instance rather than mutating the input. Never mutate date variables.
- **Modular Imports (Tree-Shaking):** Always import functions individually to support modern tree-shaking features. Never import the entire module.

## Timezone & Data Lifecycle Constraints

### 1. Inbound to Redis / Database (Storage Pipeline)

- **Rule:** All dates sent from a user client _must_ be converted out of the user's local timezone into **UTC** before hitting Redis or the main database.

- **Context:** All backend servers run natively on UTC.

- **Pattern:**

  ```typescript
  import { toZonedTime } from 'date-fns-tz';
  ```

// Convert user input string/date from a known client timezone explicitly to UTC
const serverStorageUtcDate = toZonedTime(userInputDate, 'UTC');
// Save serverStorageUtcDate directly to Redis / Database

````
### 2. Outbound to Client (Presentation Pipeline)
* **Rule:** When retrieving a date/time from storage to return to a user, it *must always* be converted from UTC into the **user's local timezone** before presentation or final payload delivery.
* **Pattern:**
```typescript
import { formatInTimeZone } from 'date-fns-tz';

// Retrieve UTC date from Redis/DB and format it directly into the target user's local timezone
const displayString = formatInTimeZone(databaseUtcDate, userLocalTimezone, 'yyyy-MM-dd HH:mm:ss');
````

## Migration & Code Conversion Rules

- **Format Preservation:** When converting legacy code (e.g., Moment.js, Day.js, or native Vanilla JS strings) to use `date-fns`, **you must preserve whatever date/time token format was originally being used in that specific component or file.**
- **Token Mapping Caveat:** Translate legacy tokens directly to their strict `date-fns` equivalents (e.g., Moment's `YYYY` maps strictly to `yyyy`, and `DD` maps to `dd`). Do not unilaterally change the output visual structure of dates during a refactor.

## Preferred Implementation Patterns

### 1. Tree-shaked Imports

Always structure your imports like this:

```typescript
import { format, parseISO, subDays } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
```

### 2. Parsing Safely

When dealing with ISO strings or user inputs, safely parse and validate them:

```typescript
import { isValid, parseISO } from 'date-fns';

const parsedDate = parseISO('2026-08-29T22:15:00Z');
if (!isValid(parsedDate)) {
  // handle invalid date logic
}
```
