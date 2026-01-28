# strategy-server

A lightweight TypeScript strategy/automation server used by Elite Entries.  
This repository contains connectors, strategies, and small utilities for executing algorithmic trading workflows (paper trading and live orders via an external `elite-entries` connector).

## Quick summary
- Language: TypeScript
- Purpose: Host connectors and automation logic that fetch prices, manage candles, and place orders.
- Expected runtime: Node.js (14+ recommended), TypeScript compiler for builds.

## Repository layout
- `package.json` — npm scripts and dependency metadata.
- `tsconfig.json` — TypeScript configuration.
- `index.ts` — application entry.
- `app.json` — application-level configuration (if used by deployment).
- `connectors/`
  - [`connectors/elite-entries.ts`](connectors/elite-entries.ts) — connector calling `elite-entries` package (price/order helpers).
  - [`connectors/strategies.ts`](connectors/strategies.ts) — strategy definitions (behaviour hooks).
- `lib/`
  - [`lib/discord.ts`](lib/discord.ts) — discord notification helper.
- `README.md` — this file.

(If you host this repo on GitHub/VS Code, the links above let you quickly open the files.)

## Contract (brief)
- Input: trigger parameters (symbols, notional, side, time_in_force, etc.) supplied by automations.
- Output: placed order responses from the `elite-entries` API or `placeOrder` wrapper.
- Errors: validation errors thrown for missing required params; upstream API errors are propagated.

## Requirements
- Node.js >= 14 (Node 16+ recommended)
- npm or yarn
- TypeScript (devDependency — `tsc` via `npm run build` or `npx tsc`)
- Dependency: `elite-entries` (must be installed or available as a local package)
  - If `elite-entries` is a private/local package, ensure you have it in `node_modules` or use `npm link` / monorepo config.

## Environment variables
- `PAPER` — if truthy, the connector should use paper trading mode (used in `connectors/elite-entries.ts`).
- Add additional secrets (API keys, webhook URLs) to environment or a secure vault and reference them at runtime.

## Install (first time)
```bash
# from project root
npm install
# or
yarn install
```

If `elite-entries` is not published to the registry and is a local package:
```bash
# Example using local path
npm install ../path-to-elite-entries
# or link it
npm link ../path-to-elite-entries
```

## Build / Type-check
Preferred: use the project's `tsconfig.json`.

```bash
# Type-check & compile to dist (reads tsconfig.json)
npx tsc -p .
# or
npm run build
```

Notes:
- Do NOT run `tsc .` — that can cause the error:
  > error TS6231: Could not resolve the path '' with the extensions: '.ts', '.tsx', ...
  
  The correct ways are `tsc` (which reads `tsconfig.json`), `tsc -p .` or `npx tsc -p tsconfig.json`. If you want to compile a single file, call it directly:
  ```bash
  npx tsc connectors/elite-entries.ts
  ```

## Run (development)
If you want to run directly with ts-node:
```bash
# install ts-node if you don't have it:
npm install --save-dev ts-node
# Run the entry file
npx ts-node --transpile-only index.ts
```

Or run the compiled output:
```bash
npm run build
node dist/index.js
```

Add helpful scripts to `package.json` (suggested):
```json
"scripts": {
  "build": "tsc -p .",
  "start": "node dist/index.js",
  "dev": "ts-node --files --transpile-only index.ts",
  "typecheck": "tsc -p . --noEmit"
}
```

## Development tips / workflow
- Use `npm run typecheck` frequently while editing.
- Add unit tests for core logic (recommended frameworks: vitest, jest).
- Keep connector side effects (I/O calls to exchanges/APIs) isolated to wrappers (e.g. `connectors/elite-entries.ts`) to make testing easier.

## Troubleshooting — common issues

1. TS6231 when running `tsc .`:
   - Cause: passing `.` as a root file to `tsc` is interpreted as a file path string rather than project dir, and the compiler tries to resolve an empty path.
   - Fix: run `npx tsc -p .` or `npx tsc` (reads `tsconfig.json`). Alternatively, compile a single file: `npx tsc connectors/elite-entries.ts`.

2. "Cannot find module 'elite-entries'":
   - Ensure `elite-entries` is installed or provide type declarations (either `@types/elite-entries` or a local `declarations.d.ts` with:
     ```ts
     declare module 'elite-entries';
     ```
     Place that file in a folder included by `tsconfig.json` (or add it to `include`).

3. Missing env variables or runtime errors:
   - Check process.env usage (e.g. `process.env.PAPER`), and provide a `.env` for local development (with `dotenv`).

## Tests
- There are no tests in the repo right now. Suggested minimal tests:
  - Unit test for `roundMax5` / `roundMax2`.
  - Mock `elite-entries` to test `trade` logic in `connectors/elite-entries.ts`.
- Suggested stack: vitest or jest + ts-jest.

## Suggested small improvements (proactive)
- Add a `types/` folder or `declarations.d.ts` declaring the external `elite-entries` module to avoid TypeScript `Cannot find module` errors.
- Add `npm run typecheck` and `npm run build` scripts to `package.json`.
- Add basic unit tests and a GitHub Action that runs typecheck + tests on push/PR.
- Add a small `README.dev.md` if you have extra setup for local connectors (like OAuth keys).

## How to add a new connector/strategy
1. Create a new file under `connectors/` (e.g. `connectors/my-connector.ts`) that exposes helper functions.
2. Import it in `index.ts` or in the strategies file.
3. Add tests that mock external calls.

## Linting / Quality gates
- Recommended: add ESLint + Prettier. Example commands:
```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npx eslint --init
```
- Add GH Actions to run:
  - Build/Typecheck: `npx tsc -p .`
  - Lint: `npx eslint . --ext .ts`
  - Tests: `npm test`

## "Try it" — quick commands
```bash
# install deps
npm install

# typecheck + build
npx tsc -p .

# run (dev)
npx ts-node --transpile-only index.ts
```

## Notes
- `connectors/elite-entries.ts` references `process.env.PAPER` — use `PAPER=true` in dev to simulate paper mode.
- If the `elite-entries` package is your internal package, consider turning this repository into a monorepo or using `npm link` for local development.

## Contact / Contributing
Create a PR with your changes, include unit tests, and add a short description of the behaviour you're changing.

---
Completion summary:
- This README documents the project layout, common commands, troubleshooting (including the `TS6231` error), and developer guidance.  
- Next suggested steps: save this file as `README.md`, add the suggested npm scripts to `package.json`, and (optionally) add a `declarations.d.ts` for `elite-entries`.