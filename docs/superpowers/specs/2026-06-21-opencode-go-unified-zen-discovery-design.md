# OpenCode Go Unified Zen Discovery Design

## Goal

Show OpenCode Zen free models in the configured OpenCode Go model picker and
refresh them whenever the user chooses **Discover** on the OpenCode Go card.

## Root Cause

The previous discovery change stored Zen free catalog data under the separate
`opencode-go-free` built-in provider. That provider is intentionally hidden
when a user configures an `opencode-go` key, while the configured OpenCode Go
picker only merges `discoveredModels["opencode-go"]`. The OpenCode Go card's
Discover button consequently refreshed only the paid Go endpoint.

## Architecture

OpenCode Go is the unified picker surface. Its model source merges the curated
Go fallback catalog, live Go discoveries, and live Zen free discoveries. The
standard merge helper remains responsible for retaining curated metadata and
deduplicating overlapping IDs.

The OpenCode Go Discover action refreshes both `opencode-go` and
`opencode-go-free` in parallel. The generic discovery function remains
single-provider, so startup and other provider discovery paths retain their
current, predictable behavior.

## Data Flow

1. User clicks Discover on configured OpenCode Go.
2. The card requests both the Go catalog with the user key and the Zen free
   catalog with the bundled credential.
3. Each response is normalized and dual-written to the discovery journal and
   SQLite mirror through the existing store action.
4. `getModels()` merges both cached discovery lists into the configured
   OpenCode Go model list.
5. Selecting an ID ending in `-free` continues to use the existing Zen base
   URL override when the request is sent.

## Testing

Tests will cover a configured OpenCode Go picker containing a Zen-discovered
model, and the Discover button dispatching both discovery requests. Existing
tests retain coverage for the bundled free provider and the durable discovery
cache.
