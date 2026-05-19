# Changelog

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
