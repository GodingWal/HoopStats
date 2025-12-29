# NBA Sports Betting Analytics

## Overview

This is an NBA sports betting analytics dashboard that displays player statistics, hit rates for betting lines, matchup data, and performance trends. The application provides a data-dense interface for analyzing player props including points, rebounds, assists, and combined stats (PRA). Users can search players, view season/recent averages, analyze hit rates at various betting lines, and compare home/away splits.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state caching and synchronization
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS custom properties for theming (dark mode default)
- **Build Tool**: Vite with hot module replacement

The frontend follows a component-based architecture with:
- Page components in `client/src/pages/`
- Reusable UI components in `client/src/components/ui/` (Shadcn)
- Domain-specific components in `client/src/components/` (player cards, stats displays, charts)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful JSON API with `/api` prefix
- **Development**: Vite dev server middleware for HMR during development
- **Production**: Static file serving from built assets

### Data Layer
- **ORM**: Drizzle ORM configured for PostgreSQL
- **Schema**: Defined in `shared/schema.ts` using Zod for validation
- **Current Storage**: In-memory sample data in `server/storage.ts` (placeholder for database)
- **Database Config**: Drizzle Kit for migrations, expects `DATABASE_URL` environment variable

### Shared Code
- **Location**: `shared/` directory contains schemas and types used by both frontend and backend
- **Validation**: Zod schemas define data structures with runtime validation
- **Path Aliases**: `@shared/*` maps to shared directory in both environments

### Key Design Decisions
1. **Monorepo Structure**: Single repository with `client/`, `server/`, and `shared/` directories enables code sharing
2. **Type Safety**: End-to-end TypeScript with Zod schemas ensures data consistency
3. **Component Library**: Shadcn/ui provides accessible, customizable components without external dependencies
4. **Dark Mode First**: UI designed for dark theme with data-dense analytics displays

## External Dependencies

### Database
- **PostgreSQL**: Primary database (requires `DATABASE_URL` environment variable)
- **Drizzle ORM**: Database toolkit for TypeScript with migration support

### UI/Frontend Libraries
- **Radix UI**: Headless UI primitives for accessibility
- **TanStack React Query**: Server state management
- **Recharts**: Charting library for data visualization
- **Embla Carousel**: Carousel component
- **date-fns**: Date manipulation utilities

### Development Tools
- **Vite**: Build tool and dev server
- **Drizzle Kit**: Database migration tooling
- **esbuild**: Server bundling for production

### External Data (Reference)
- **NBA API**: Python script in `attached_assets/` shows intended data source using `nba_api` package for player stats, game logs, and matchup data