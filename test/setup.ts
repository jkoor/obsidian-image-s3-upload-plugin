import { vi } from "vitest";

// Node supplies Web Crypto and timers; expose the browser window used by Obsidian.
vi.stubGlobal("window", globalThis);
