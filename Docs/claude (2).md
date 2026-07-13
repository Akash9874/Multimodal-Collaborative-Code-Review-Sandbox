# Project: Multimodal Collaborative Code Review Sandbox

## Overview
This document provides the foundational context, architecture, and coding standards for the "Multimodal Collaborative Code Review Sandbox." It is intended to be used as a system prompt/context file for AI coding assistants.

## Core Tech Stack
* **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS
* **Code Editor:** Monaco Editor (`@monaco-editor/react`)
* **Real-time Sync / CRDT:** Yjs, `y-websocket`, `y-monaco`
* **Interactive Canvas:** Tldraw or `perfect-freehand`
* **Terminal Emulator:** Xterm.js (Frontend), Node-pty (Backend)
* **Backend WebSocket Server:** Node.js (Express/WS)
* **Execution Sandbox:** Docker (ephemeral containers) or Sandpack/Piston API

## Architecture & Implementation Rules

### 1. The Real-time Engine (Yjs)
* **Single Source of Truth:** All collaborative state must reside within a single `Y.Doc`.
* **State Trees:**
  * `ydoc.getText('monaco')`: Code content.
  * `ydoc.getMap('awareness')`: Cursor positions, selections, user metadata (name, color).
  * `ydoc.getMap('canvas')`: Drawing strokes and overlay data.
* **Network:** Use `y-websocket` to connect to the Node.js backend. The backend acts purely as a broadcast relay; it does not parse the Yjs document state.

### 2. Editor Integration (Monaco)
* **Hydration Protection:** Monaco CANNOT be server-side rendered. It must be dynamically imported with `ssr: false` in Next.js.
* **Binding:** Use `y-monaco` to bind the `Y.Text` instance to the Monaco model.
* **Awareness:** Inject the `y-websocket` awareness provider into the `y-monaco` binding to render remote user cursors.

### 3. Visual Canvas Overlay
* The canvas must sit on top of the editor (`z-index` higher than Monaco).
* Implement a Strict Mode Toggle:
  * **Code Mode:** Canvas container CSS `pointer-events: none`. Editor receives all interactions.
  * **Draw Mode:** Canvas container CSS `pointer-events: auto`. Editor is read-only or ignores clicks; canvas captures drawing events.
* Sync drawing operations immediately to the `y-canvas` map.

### 4. Secure Terminal Execution
* The web terminal (`xterm.js`) communicates via a dedicated WebSocket to a secure execution backend.
* **STRICT RULE:** Never execute raw code on the host machine. User code MUST run in an isolated environment (e.g., heavily restricted Docker container with no network access to internal VPC, low memory limit, and short timeout).

## Project Structure (Recommended)
```text
/
├── apps/
│   ├── web/ (Next.js Frontend)
│   │   ├── components/ (Editor, Canvas, Terminal, UI)
│   │   ├── lib/ (Yjs hooks, API clients)
│   │   └── app/ (Pages, routing)
│   └── ws-server/ (Node.js Yjs/Terminal Relay Server)
├── packages/
│   ├── types/ (Shared TS interfaces)
│   └── config/ (Shared linting/ts configs)
└── docker/ (Sandbox container definitions)
```

## AI Assistant Guidelines
* When writing Next.js components, prioritize React Server Components where possible, but acknowledge that the Editor/Canvas/Yjs layers MUST be Client Components (`'use client'`).
* Emphasize error handling for network disconnects and WebSocket reconnections.
* Keep styling modular using Tailwind classes.
