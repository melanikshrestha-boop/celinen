# FOTO (Celinen) Architecture Diagram

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FOTO Platform                            │
│                   (Photography Workspace + Business Tools)      │
└─────────────────────────────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│   Web UI     │        │ Native C++   │        │  Cloud       │
│  (React/TS)  │◄──────►│   Engine     │◄──────►│  Services    │
└──────────────┘        └──────────────┘        └──────────────┘
        │                         │                         │
        │                         │                         │
        ▼                         ▼                         ▼
  ┌──────────┐           ┌──────────┐           ┌──────────┐
  │ Studio   │           │ Develop  │           │ Supabase │
  │ Culling  │           │ Editing  │           │ Database │
  └──────────┘           └──────────┘           └──────────┘
```

## Core Architecture Layers

### 1. Frontend Layer (React + TypeScript)
```
┌──────────────────────────────────────────────────────────────┐
│                    Frontend Application                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  TanStack Router + React Query State Management        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Marketing  │  │   Workspace  │  │   Business   │      │
│  │    Pages     │  │   (Studio)   │  │    Tools     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

**Key Components:**
- **Router**: TanStack Router with file-based routing (`src/routes/`)
- **State**: React Query for server state, React Context for app state
- **UI**: Radix UI components + Tailwind CSS styling
- **Build**: Vite with TanStack Start + Nitro for SSR

### 2. Native Processing Layer (C++)
```
┌──────────────────────────────────────────────────────────────┐
│                    Native C++ Engine                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  LibRaw 0.22.2 (RAW Decode) + ImageIO (macOS)        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   RAW Decode │  │   Develop    │  │   Analysis   │      │
│  │  (128 MiB)   │  │   Editing    │  │   & Culling  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

**Native Capabilities:**
- **RAW Processing**: LibRaw for RAW file decoding (128 MiB limit)
- **Image Processing**: macOS ImageIO framework for raster operations
- **Develop Engine**: Exposure, color grading, curves, detail adjustments
- **Analysis**: Image quality scoring, burst grouping, face detection
- **Export**: JPEG encoding with quality control (up to 8,192px)

### 3. Backend/Services Layer
```
┌──────────────────────────────────────────────────────────────┐
│                    Cloud Services                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Supabase    │  │ Cloudflare   │  │   Stripe     │      │
│  │  (Auth/DB)   │  │  (Deployment)│  │ (Payments)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Canoncial   │  │   Social     │  │   Business   │      │
│  │  V2 API      │  │   Connectors │  │   Logic      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

## Application Flow

### Photo Import & Processing Pipeline
```
User Upload/Select
       │
       ▼
┌──────────────┐
│ File Handle  │
│ Registration │
└──────────────┘
       │
       ├─────────────────┐
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ Browser Path │  │ Native Path  │
│ (Fallback)   │  │ (Preferred)  │
└──────────────┘  └──────────────┘
       │                 │
       │                 ▼
       │         ┌──────────────┐
       │         │ LibRaw Decode │
       │         │ (RAW files)   │
       │         └──────────────┘
       │                 │
       │                 ▼
       │         ┌──────────────┐
       │         │ ImageIO      │
       │         │ (JPEG/RASTER)│
       │         └──────────────┘
       │                 │
       └─────────────────┤
                         ▼
                 ┌──────────────┐
                 │ Analysis     │
                 │ (Quality/    │
                 │  Metadata)   │
                 └──────────────┘
                         │
                         ▼
                 ┌──────────────┐
                 │ Store in     │
                 │ IndexedDB/   │
                 │ Supabase     │
                 └──────────────┘
```

### Develop Editing Workflow
```
┌──────────────┐
│  Library     │
│  View        │
└──────────────┘
       │
       ▼
┌──────────────┐
│  Photo       │
│  Selection   │
└──────────────┘
       │
       ▼
┌──────────────┐
│  Develop     │
│  Page        │
└──────────────┘
       │
       ├──────────────────────────────────┐
       │                                  │
       ▼                                  ▼
┌──────────────┐                  ┌──────────────┐
│   Browser   │                  │   Native     │
│   Render     │                  │   Render     │
│  (Fallback) │                  │  (Primary)   │
└──────────────┘                  └──────────────┘
       │                                  │
       │             ┌────────────────────┘
       │             │
       ▼             ▼
┌──────────────┐  ┌──────────────┐
│   Basic      │  │   Advanced   │
│   Adjustments│  │   Processing │
└──────────────┘  └──────────────┘
       │             │
       └─────────────┘
             │
             ▼
     ┌──────────────┐
     │   Recipe     │
     │   Storage   │
     └──────────────┘
             │
             ▼
     ┌──────────────┐
     │   Export     │
     │   JPEG       │
     └──────────────┘
```

## Key Technical Components

### 1. Route Structure (`src/routes/`)
```
/                    - Landing page
/auth               - Authentication
/shoots             - Photo shoot management
/shoots/$id/cull    - Culling interface
/shoots/$id/develop - Develop editing
/studio             - Legacy studio interface
/deliver            - Client delivery
/pricing            - Business pricing
/photographers      - Photographer directory
```

### 2. Native Plugin System (`src/server/`)
```
native-studio-plugin.ts    - Studio integration
native-develop.ts           - Develop processing
native-reference.ts         - Reference matching
native-crop.ts              - Crop operations
native-object-remove.ts    - AI object removal
native-gallery.ts           - Gallery generation
native-settings.ts          - Settings management
```

### 3. Core Libraries (`src/lib/`)
```
develop/           - Develop editing logic
  ├── contract.ts        - Data contracts
  ├── store.ts           - State management
  ├── import.ts          - Import handling
  ├── client.ts          - Native client
  └── histogram.ts       - Histogram logic

studio/            - Studio interface
  ├── editing.ts        - Editing logic
  ├── library.ts        - Library management
  └── metadata.ts       - Metadata handling

business/          - Business tools
  ├── finance.ts        - Financial tracking
  ├── earnings.ts       - Earnings calculation
  └── client.ts         - Client management
```

### 4. Component Architecture (`src/components/`)
```
develop/           - Develop UI components
studio/            - Studio UI components
business/          - Business UI components
marketing/         - Marketing pages
ui/                - Shared UI components
```

## Data Flow

### Photo Data Model
```
Photo Entity
├── Source (Original file)
├── Preview (Processed preview)
├── Metadata (EXIF/IPTC)
├── Treatment (Edit recipe)
├── History (Edit history)
└── Analysis (Quality scores)
```

### State Management
```
React Query (Server State)
├── Photo queries
├── Shoot queries
├── Client queries
└── Settings queries

React Context (App State)
├── Account context
├── Workspace context
└── Develop context
```

## Deployment Architecture

### Development
```
Local macOS Machine
├── Native C++ Engine (localhost:8085)
├── Vite Dev Server (React UI)
├── Supabase Local (Auth/DB)
└── Loopback Communication
```

### Production
```
Cloudflare Workers
├── Web Application (React + SSR)
├── API Endpoints (Nitro)
├── Cloudflare AI (Object removal)
└── CDN Distribution

Supabase Cloud
├── Authentication
├── Database (PostgreSQL)
└── Storage

Stripe
├── Payment Processing
└── Subscription Management
```

## Integration Points

### External Services
- **Supabase**: Authentication, database, storage
- **Stripe**: Payment processing, subscriptions
- **Cloudflare**: Deployment, AI services, CDN
- **Social Platforms**: Instagram, Facebook sharing
- **Lightroom**: Plugin integration, import/export

### Native Dependencies
- **LibRaw 0.22.2**: RAW file decoding
- **macOS Frameworks**: ImageIO, CoreGraphics, CoreFoundation
- **Custom C++ Engine**: Image processing, analysis

## Performance Optimizations

1. **Native Processing**: C++ engine for CPU-intensive operations
2. **Worker Pools**: Parallel processing for batch operations
3. **Caching Strategy**: LRU cache for analysis results
4. **Lazy Loading**: Route-based code splitting
5. **Image Optimization**: Progressive loading, thumbnail generation

## Security Model

1. **Authentication**: Supabase Auth with Google OAuth
2. **Authorization**: Account-scoped data access
3. **CSRF Protection**: Request middleware
4. **File Security**: Local processing, no external uploads
5. **Payment Security**: Stripe secure checkout

## Development Workflow

```bash
# Setup
npm i
sh native/bootstrap-libraw.sh
make -C native -j4

# Development
npm run dev:lab    # Local lab mode (127.0.0.1:8085)
npm run dev        # Production dev mode

# Building
npm run build      # Production build
npm run build:workers  # Cloudflare workers build
npm run build:pages    # Cloudflare pages build

# Testing
npm test           # Run tests
make -C native test    # Native C++ tests
```

## Current Status & Limitations

### Implemented Features
- ✅ RAW import and preview generation
- ✅ Basic develop editing (exposure, color, detail)
- ✅ Advanced editing (curves, grading, effects)
- ✅ Culling and library management
- ✅ Client management and delivery
- ✅ Business tools (earnings, calendar)
- ✅ Social media integration

### Known Limitations
- ⚠️ Native processing macOS-only
- ⚠️ 8-bit processing bottleneck
- ⚠️ JPEG-only export (no TIFF/PSD)
- ⚠️ Output resolution limits (8,192px)
- ⚠️ Limited camera RAW support
- ⚠️ No HDR/panorama support

### Planned Features
- 📋 High-bit depth processing
- 📋 Cross-platform native support
- 📋 Advanced color management
- 📋 Batch export queue
- 📋 Print soft proofing
