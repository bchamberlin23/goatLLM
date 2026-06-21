# OpenCode Go and Zen Model Discovery Design

## Goal

Keep both OpenCode model pickers current without hardcoding individual model
names. A configured OpenCode Go account must expose every model returned by
its live catalog, and the bundled Zen free tier must expose every free model
returned by its own live catalog.

## Architecture

The existing discovery pipeline remains the single path for fetching,
normalizing, caching, and displaying catalog data. The registry will mark the
built-in `opencode-go-free` provider as discovery-capable, and the chat store
will resolve its base URL and bundled credential when discovery runs. The
configured `opencode-go` provider keeps its existing behavior.

`discoverAllCloudModels` will include the built-in free provider in addition
to configured discovery-capable providers. It will deduplicate provider IDs so
the same catalog is never requested twice.

## Data Flow

1. On hydrated startup, cloud discovery requests `GET /models` for configured
   discovery-capable providers and for the built-in Zen free provider.
2. Zen discovery authenticates with the existing lazy bundled credential and
   requests `https://opencode.ai/zen/v1/models`.
3. The existing normalizer converts the provider response into the shared
   discovered-model shape.
4. The result is synchronously written to the localStorage discovery journal
   and asynchronously mirrored to SQLite using `persistDiscoveredModels`.
5. The model picker merges discovered entries into each provider's curated
   fallback catalog. Curated metadata still wins for overlapping IDs;
   newly-returned model IDs are appended in provider order.

## Fallbacks and Errors

The current curated OpenCode Go and Zen entries remain available when the
network request fails or before the first discovery completes. A Zen discovery
failure updates the same status/error state used by other providers but must
not prevent the free fallback models from being selectable. The configured
OpenCode Go provider remains hidden behind its user-supplied key as today;
the built-in Zen provider continues to use only the bundled credential.

## Scope Boundaries

This change does not add a UI control, alter provider credentials, or hardcode
specific free-model names. It only extends the established runtime discovery
and persistence mechanism to the free catalog.

## Testing

Tests will prove that the registry opts the Zen free provider into discovery,
that startup discovery calls it alongside configured providers, and that
discovered Zen entries appear in the built-in model picker while retaining the
curated fallback entries. Existing cache tests cover the required synchronous
journal write and asynchronous SQLite mirror; the new discovery result uses
that same persistence function.
