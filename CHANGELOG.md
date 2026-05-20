# Changelog

## v3.0.0 - Scene-Synchronised Slideshows

This major release makes TMDB collection slides behave as one synchronised scene. A backdrop slideshow can now act as the scene source for poster, overview, cast, rating, logo, and dynamic-field layers, with every linked layer using the same movie or TV item during each slide.

### Highlights

- Reworked editor slideshow sync so linked layers receive one shared slide item from the collection source instead of updating as separate, independent fetches.
- Collection sources now preload enriched TMDB details for linked scene layers, including credits and images, so cast, logos, ratings, posters, and overview can update together.
- Global Scene Fade now fades the whole linked scene out, swaps backdrop and linked content while hidden, then fades the full scene back in.
- Protected poster scrolls and backdrop slideshows from being overwritten by single-item sync updates.
- Syncing an element to an already-loaded collection source now refreshes that source with enriched scene data.
- Fixed a sync race where adding a poster or detail layer to a collection slideshow could start an independent single-item fetch and briefly show artwork from a different TMDB item.
- Collection-mastered poster, overview, cast, rating, logo, and dynamic-field layers no longer auto-fetch separately as the slideshow rotates, and stale TMDB responses are ignored if the layer has already moved to a newer slide item.
- Generated PHP exports now use the same shared-scene model, enriched detail cache, collection item limit, and global fade timing.

### Practical Outcome

- A layout containing `Backdrop Slideshow`, `Poster`, `Overview`, `Cast`, and `Rating` can be linked to one collection source.
- When the active slide is Avatar, all linked layers render Avatar data.
- When the slide advances, the full scene fades out, swaps to the next TMDB item, and fades back in as one composed layout.

## v1.2.1 - Collection Limits And Scene Fade Sync

This patch improves slideshow and collection sync behavior so linked TMDB layers stay aligned with the active collection source.

### Highlights

- Added an `Items Shown` control for TMDB poster scrolls and backdrop slideshows.
- Synced collection layers now inherit the source collection's item count, keeping the linked group on one master value.
- Poster scrolls now render the configured number of TMDB results instead of being capped at 10 items.
- Collection fetches can now request extra TMDB result pages when the item count is above 20.
- Added a `Global Scene Fade` option for backdrop slideshows so the backdrop and synced TMDB layers fade together before swapping to the next item.
- Linked poster scrolls now propagate their first visible item to synced poster/title/detail layers, matching backdrop slideshow behavior.
- PHP exports now include collection item limits and global scene fade behavior.

## v1.2.0 - Canvas Presets, Backdrop Fit, And Layer Sync

This release improves the editor workflow for designing across TV, mobile, and tablet canvases. It adds real resolution presets, visible aspect ratio metadata, one-click backdrop sizing, and a discoverable Properties control for syncing TMDB layers to slideshows or other source layers.

### Highlights

- Default canvas is now TV landscape at `1280x720`.
- Added resolution presets for TV, common mobile devices, and common tablets.
- The toolbar now uses one compact resolution selector that shows current canvas size, aspect ratio, and preset name.
- Moved zoom and `Fit` controls into a bottom-right canvas viewport overlay.
- Added `Fill Width`, `Fill Height`, and `Cover Canvas` backdrop sizing actions that preserve TMDB's standard `16:9` backdrop aspect ratio.
- Added a Properties-panel `Sync with layer` dropdown for TMDB elements so posters, titles, overviews, cast, ratings, and dynamic fields can follow another TMDB source layer.

### Canvas Presets

- Replaced fixed canvas base sizes with grouped device resolution presets.
- Added `selectedResolutionId` to project autosave and JSON export.
- Preserved compatibility with older saved projects that do not contain a resolution id by falling back to each device category's default resolution.
- Switching device category, resolution, or orientation scales existing elements proportionally.
- `Fit` now calculates zoom from the actual available editor viewport space instead of using fixed per-device zoom values.

### Layer Sync And Backdrops

- Added visible backdrop fit controls for `tmdb-backdrop` and `tmdb-backdrop-slideshow`.
- Added a layer-sync dropdown that reuses the existing `linkGroup` model and drag-to-link behavior.
- Synced elements copy the selected source layer's current TMDB item where possible, including the active slideshow item.
- Backdrop slideshow state now keeps displayed backdrop images paired with the same TMDB result item, so synced posters and text fields update to the same movie or TV listing as the visible slide.
- Linked slideshow groups now propagate their first visible item immediately, not only after the first slide interval.

### Documentation

- Updated README usage notes for device resolution presets, aspect ratio display, backdrop fit buttons, and Sync with layer.

## v1.1.0 - PHP Export Concurrency And Editor Reliability

This release makes exported layouts safer for real production use. The generated PHP file now keeps TMDB credentials server-side, proxies TMDB requests through itself, and uses a local locked cache so multiple viewers can load the same layout without each browser hammering the TMDB API.

### Highlights

- Generated PHP exports now use a same-origin endpoint: `layout.php?tmdb_source=<id>`.
- TMDB credentials are no longer emitted into browser JavaScript.
- Concurrent viewers share cached TMDB responses guarded by `flock()` file locks.
- Linked slideshow layouts can update linked title, overview, rating, cast, logo, and dynamic-field elements as slides rotate.
- Project JSON import/export and autosave now match the README feature list.

### PHP Export Runtime

- Reworked the generated PHP file so TMDB requests are handled by the PHP file itself instead of browser JavaScript calling TMDB directly.
- Kept TMDB API credentials server-side in the generated PHP runtime. The browser now receives only generated source IDs and calls `layout.php?tmdb_source=<id>`.
- Added a generated PHP source registry so exported layouts only serve TMDB requests that were generated from the current layout.
- Added file-based TMDB response caching in the generated PHP file using `sys_get_temp_dir()`.
- Added per-cache-key file locking with `flock()` to prevent multiple concurrent viewers from stampeding the same TMDB endpoint.
- Added stale-cache fallback: if TMDB is temporarily unavailable but an older cache file exists, the generated PHP serves the stale response instead of failing the layout.
- Added separate default cache TTLs:
  - 6 hours for movie/TV/person detail responses.
  - 15 minutes for collection, trending, and discover responses.
- Added cache status response headers for easier debugging: `X-TMDB-Cache: HIT`, `HIT-AFTER-LOCK`, `MISS`, or `STALE`.
- Deduplicated generated TMDB sources so multiple elements using the same movie/show/collection share one browser request and one PHP cache entry.
- Added server-side detail enrichment for linked backdrop slideshows so linked title, overview, rating, cast, logo, and dynamic-field elements can update as the slideshow rotates.

### Export Security And Rendering

- Replaced direct TMDB browser calls in exported layouts with same-origin PHP proxy calls.
- Escaped generated static text, image URLs, data attributes, IDs, and common CSS values before writing them into the exported PHP/HTML.
- Replaced TMDB-driven `innerHTML` rendering in the exported JavaScript with DOM creation and `textContent` for titles, overviews, genres, cast names, ratings, and dynamic fields.
- Sanitized exported DOM IDs for CSS selector safety.
- Added defensive CSS value clamping for position, size, z-index, opacity, borders, radius, filters, shadows, rotation, font size, and font family.

### Editor Fixes

- Fixed API credential revalidation so repeated token/key changes trigger validation. The previous `Subject<void>` pipeline used `distinctUntilChanged()`, which could suppress later checks.
- Reduced unnecessary editor TMDB refetching by tracking only data-source fields instead of refetching in response to style/layout-only edits.
- Added RxJS teardown through `takeUntil()` for API/search subscriptions.
- Added immutable Discover genre toggling and changed `DiscoverFilters.genres` to `number[]`.
- Added JSON project export and import controls.
- Added automatic project autosave to `localStorage` under `tmdbLayoutProject`.
- Added a working Copy button for the generated PHP preview.
- Capped editor history at 50 snapshots to avoid unbounded memory growth.

### Tooling

- Expanded `.gitignore` for Angular/Vite caches, generated layout exports, local env files, logs, and common editor/OS noise.
- Verified the project builds successfully under Linux Node via `nvm`:
  - Node: `v24.15.0`
  - Command: `npm run build -- --output-path=/tmp/tmdb-wysiwyg-build`

### Notes

- The generated PHP file must be served through PHP for credentials to remain server-side. If the `.php` file is served as plain text by a misconfigured server, its embedded credentials would be visible.
- The PHP cache uses the server temp directory. If that directory is not writable, the generated layout still attempts live proxy requests but cannot cache or lock them.
- `npm ci` reported audit findings in the current dependency tree. Those were not changed in this update because dependency upgrades should be reviewed separately.
