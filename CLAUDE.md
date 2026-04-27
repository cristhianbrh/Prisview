# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start development server
pnpm build      # Build for production
pnpm preview    # Preview production build
```

No lint or test scripts are configured.

## Tech Stack

- **Astro** (v6) with React integration — Astro handles routing/SSG, React handles all interactive UI via `client:load`
- **React Flow** (v12) — interactive ER diagram canvas
- **Dagre** — automatic graph layout for nodes
- **CodeMirror 6** (`@uiw/react-codemirror`) — schema editor with custom linting and autocomplete
- **Tailwind CSS** (v4)
- **html-to-image** — PNG export to clipboard
- Node.js >= 22.12.0 required

## Architecture

This is a single-page client-side app. The only Astro page (`src/pages/index.astro`) renders `<ERDBoard client:load />`, making `ERDBoard.tsx` the effective root of the entire application.

### Core Data Flow

1. User types schema DSL in the CodeMirror editor
2. `parser.ts` tokenizes DSL into `TableSchema[]`
3. `schemaAnalysis.ts` validates and enriches the parsed data
4. `graph.ts` converts tables to React Flow nodes/edges and runs dagre layout
5. `TableNode.tsx` renders individual table cards with connection handles for React Flow
6. Positions are merged with any manually dragged positions (stored in localStorage)

### Key Files in `src/components/db/`

| File | Responsibility |
|------|---------------|
| `ERDBoard.tsx` | Root React component (~1000 lines); owns all state, orchestrates everything |
| `parser.ts` | DSL tokenizer → `TableSchema[]` |
| `schemaAnalysis.ts` | Post-parse semantic validation |
| `graph.ts` | React Flow node/edge builders + dagre layout |
| `TableNode.tsx` | Custom React Flow node component |
| `autocomplete.ts` | CodeMirror completion provider (keywords + dynamic table/field references) |
| `ormImport.ts` | Converts Prisma schema syntax to internal DSL |
| `sql.ts` | SQL code generation for PostgreSQL, MySQL, SQLite |
| `storage.ts` | SSR-safe `localStorage` abstraction |
| `types.ts` | Core interfaces: `Field`, `TableSchema`, `FieldReference` |

### Persistence

All state is persisted to `localStorage` under `erd-builder:*` keys (schema text, node positions, viewport, panel width, SQL dialect). `storage.ts` guards against SSR execution.

### Schema DSL

The app uses a custom DSL (not DBML) for defining tables and fields. `parser.ts` is the source of truth for the grammar. `autocomplete.ts` provides editor support for it.
