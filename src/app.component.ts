import { Component, ChangeDetectionStrategy, signal, effect, computed, inject, ChangeDetectorRef, HostListener, OnDestroy, AfterViewInit, OnInit, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { inject as vcinject } from '@vercel/analytics';
import { Observable, forkJoin, of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';
import { COUNTRIES, LANGUAGES } from './countries-languages';

vcinject();

// --- TYPE DEFINITIONS ---
interface Gradient { angle: number; from: string; to: string; }
interface Shadow { x: number; y: number; blur: number; color: string; }
interface DiscoverFilters { sortBy: string; genres: number[]; year: number | null; }

type TmdbItemType = 'movie' | 'tv' | 'person';
type TmdbCollectionType = 'movie' | 'tv' | 'mixed';
type CanvasPreset = 'mobile' | 'tablet' | 'tv';
type ElementType =
  | 'text' | 'image' | 'shape'
  | 'tmdb-poster' | 'tmdb-backdrop' | 'tmdb-title' | 'tmdb-overview'
  | 'tmdb-poster-scroll' | 'tmdb-backdrop-slideshow' | 'tmdb-tagline'
  | 'tmdb-release-date' | 'tmdb-runtime' | 'tmdb-genres' | 'tmdb-rating'
  | 'tmdb-cast' | 'tmdb-logo' | 'tmdb-network-logo' | 'tmdb-season-episode-count'
  | 'tmdb-dynamic-field';

type ImageFit = 'cover' | 'contain' | 'fill';
type BackdropFitMode = 'width' | 'height' | 'cover';
type SlideshowState = {idx1: number, idx2: number, fade: boolean, sceneFade: boolean, backdrops: string[], items: any[]};
type TmdbDetailEntry = { key: string; altKey: string; detail: any };

interface CanvasResolutionPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  aspectRatio: string;
}

interface CanvasElement {
  id: string;
  type: ElementType;
  x: number; y: number; width: number; height: number; rotation: number;
  zIndex: number; visible: boolean;
  content: string;
  styles: {
    backgroundColor: string;
    backgroundOpacity: number;
    color: string; fontFamily: string; fontSize: number;
    fontWeight: '400' | '500' | '600' | '700'; textAlign: 'left' | 'center' | 'right';
    borderRadius: number; borderWidth: number; borderColor: string;
    opacity: number;
    backgroundGradient?: Gradient;
    boxShadow?: Shadow; textShadow?: Shadow;
    filterBlur: number; filterGrayscale: number;
  };
  tmdbId?: string;
  tmdbItemType: TmdbItemType;
  tmdbCollectionType: TmdbCollectionType;
  tmdbEndpoint?: string;
  discoverFilters: DiscoverFilters;
  tmdbData?: any;
  linkGroup?: string;
  imageFit: ImageFit;
  collectionItemLimit?: number;
  globalSceneFade?: boolean;

  // For Dynamic Data Fields
  dataPath?: string;
  dataPrefix?: string;
  dataSuffix?: string;
}

interface HistoryState { elements: CanvasElement[]; selectedElementId: string | null; }
interface ContextMenuState { visible: boolean; x: number; y: number; elementId: string | null; }
interface TmdbGenre { id: number; name: string; }
interface TmdbUser { id: number; username: string; avatar_path: string | null; name: string; }

declare var interact: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule]
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private slideshowIntervals: Map<string, any> = new Map();
  private posterScrollIntervals: Map<string, any> = new Map();
  private searchTerms = new Subject<string>();
  private authCheckSubject = new Subject<void>();
  private destroy$ = new Subject<void>();
  private tmdbFetchSequence = 0;
  private tmdbFetchTokens: Map<string, number> = new Map();
  private readonly projectStorageKey = 'tmdbLayoutProject';
  private readonly maxHistoryStates = 50;
  private readonly defaultCollectionItemLimit = 20;
  private readonly maxCollectionItemLimit = 40;
  private readonly sceneFadeDurationMs = 650;
  private restoredProjectFromStorage = false;

  readonly Math = Math;
  readonly collectionItemLimitOptions = [5, 10, 15, 20, 30, 40];

  // --- CONSTANTS & STATIC DATA ---
  readonly countries = COUNTRIES;
  readonly languages = LANGUAGES;
  readonly fonts = ['Inter', 'Roboto', 'Montserrat', 'Lato', 'Oswald'];

  readonly tmdbEndpoints = {
    movie: [
      { key: 'movie/popular', name: 'Popular' }, { key: 'movie/top_rated', name: 'Top Rated' },
      { key: 'movie/upcoming', name: 'Upcoming' }, { key: 'movie/now_playing', name: 'Now Playing' },
      { key: 'discover/movie', name: 'Discover (Filtered)' }
    ],
    tv: [
      { key: 'tv/popular', name: 'Popular' }, { key: 'tv/top_rated', name: 'Top Rated' },
      { key: 'tv/on_the_air', name: 'On The Air' }, { key: 'tv/airing_today', name: 'Airing Today' },
      { key: 'discover/tv', name: 'Discover (Filtered)' }
    ],
    mixed: [
        { key: 'trending/all/day', name: 'Trending Today' },
        { key: 'trending/all/week', name: 'Trending This Week' }
    ]
  };
  readonly discoverSortOptions = {
    movie: [
      { key: 'popularity.desc', name: 'Popularity' }, { key: 'vote_average.desc', name: 'Rating' },
      { key: 'revenue.desc', name: 'Revenue' }, { key: 'primary_release_date.desc', name: 'Release Date' },
      { key: 'vote_count.desc', name: 'Vote Count' }
    ],
    tv: [
      { key: 'popularity.desc', name: 'Popularity' }, { key: 'vote_average.desc', name: 'Rating' },
      { key: 'first_air_date.desc', name: 'First Air Date' },
      { key: 'vote_count.desc', name: 'Vote Count' }
    ]
  };

  // --- STATE SIGNALS ---
  elements = signal<CanvasElement[]>([]);
  selectedElementId = signal<string | null>(null);

  // Auth Settings
  authMethod = signal<'v3' | 'v4'>((localStorage.getItem('tmdbAuthMethod') as 'v3' | 'v4') || 'v4');
  tmdbReadToken = signal<string>(localStorage.getItem('tmdbReadToken') || '');
  tmdbApiKey = signal<string>(localStorage.getItem('tmdbApiKey') || '');
  tmdbUser = signal<TmdbUser | null>(null);
  isAuthValid = signal<boolean>(false);

  // Other Settings
  watchRegion = signal<string>(localStorage.getItem('tmdbWatchRegion') || 'US');
  language = signal<string>(localStorage.getItem('tmdbLanguage') || 'en-US');
  includeAdult = signal<boolean>(localStorage.getItem('tmdbIncludeAdult') === 'true');

  // UI State
  readonly defaultResolutionByPreset: Record<CanvasPreset, string> = {
      mobile: 'iphone-12-13-14',
      tablet: 'ipad-air',
      tv: 'tv-720'
  };
  readonly canvasResolutionPresets: Record<CanvasPreset, CanvasResolutionPreset[]> = {
      mobile: [
          { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, aspectRatio: '9:16' },
          { id: 'iphone-12-13-14', name: 'iPhone 12/13/14', width: 390, height: 844, aspectRatio: '19.5:9' },
          { id: 'pixel-7', name: 'Pixel 7', width: 412, height: 915, aspectRatio: '20:9' },
          { id: 'galaxy-s20-ultra', name: 'Galaxy S20 Ultra', width: 412, height: 915, aspectRatio: '20:9' },
          { id: 'galaxy-fold', name: 'Galaxy Fold', width: 280, height: 653, aspectRatio: '21:9' }
      ],
      tablet: [
          { id: 'ipad-mini', name: 'iPad Mini', width: 768, height: 1024, aspectRatio: '3:4' },
          { id: 'ipad-air', name: 'iPad Air', width: 820, height: 1180, aspectRatio: '59:41' },
          { id: 'ipad-pro-11', name: 'iPad Pro 11"', width: 834, height: 1194, aspectRatio: '199:139' },
          { id: 'ipad-pro-12-9', name: 'iPad Pro 12.9"', width: 1024, height: 1366, aspectRatio: '4:3' },
          { id: 'surface-pro-7', name: 'Surface Pro 7', width: 912, height: 1368, aspectRatio: '3:2' }
      ],
      tv: [
          { id: 'tv-720', name: 'HD TV', width: 1280, height: 720, aspectRatio: '16:9' },
          { id: 'tv-768', name: 'WXGA TV', width: 1366, height: 768, aspectRatio: '16:9' },
          { id: 'tv-900', name: 'HD+ TV', width: 1600, height: 900, aspectRatio: '16:9' },
          { id: 'tv-1080', name: 'Full HD TV', width: 1920, height: 1080, aspectRatio: '16:9' }
      ]
  };
  selectedPreset = signal<CanvasPreset>('tv');
  selectedResolutionId = signal<string>(this.defaultResolutionByPreset.tv);
  orientation = signal<'portrait' | 'landscape'>('landscape');
  zoomLevel = signal<number>(1);

  history = signal<HistoryState[]>([]);
  historyIndex = signal<number>(-1);
  activeLeftPanelTab = signal<'elements' | 'settings'>('elements');
  activeRightPanelTab = signal<'properties' | 'layers' | 'export'>('properties');
  previewMode = signal(false);
  contextMenu = signal<ContextMenuState>({ visible: false, x: 0, y: 0, elementId: null });
  copiedStyles = signal<Partial<CanvasElement['styles']> | null>(null);

  slideshowState = signal<{[id: string]: SlideshowState}>({});

  draggedLayerId = signal<string | null>(null);
  dragOverLayerId = signal<string | null>(null);

  tmdbGenres = signal<{movie: TmdbGenre[], tv: TmdbGenre[]}>({ movie: [], tv: [] });
  tmdbSearchResults = signal<any[]>([]);
  isSearching = signal(false);

  // --- COMPUTED SIGNALS ---
  availableCanvasResolutions = computed(() => this.canvasResolutionPresets[this.selectedPreset()]);
  selectedResolution = computed(() => this.getResolutionPreset(this.selectedPreset(), this.selectedResolutionId()));
  canvasConfig = computed(() => {
      const base = this.selectedResolution();
      let w = base.width;
      let h = base.height;
      const baseIsLandscape = base.width >= base.height;

      if (this.orientation() === 'landscape' && !baseIsLandscape) { w = base.height; h = base.width; }
      if (this.orientation() === 'portrait' && baseIsLandscape) { w = base.height; h = base.width; }

      return { width: w, height: h, scale: this.zoomLevel(), aspectRatio: base.aspectRatio, name: base.name };
  });

  selectedElement = computed(() => this.elements().find(el => el.id === this.selectedElementId()));
  generatedPhpCode = signal('');
  copySuccess = signal(false);

  private tmdbDataFetchKey = computed(() => {
    const elements = this.elements();
    return JSON.stringify(
      elements
      .filter(el => el.type.startsWith('tmdb-'))
      .filter(el => this.isCollectionElement(el) || !this.getCollectionMasterForElement(el, elements))
      .map(el => ({
        id: el.id,
        type: el.type,
        tmdbId: el.tmdbId || '',
        tmdbItemType: el.tmdbItemType,
        tmdbCollectionType: el.tmdbCollectionType,
        tmdbEndpoint: el.tmdbEndpoint || '',
        discoverFilters: el.discoverFilters,
        collectionItemLimit: this.isCollectionElement(el) ? this.getEffectiveCollectionItemLimit(el) : '',
        linkGroup: el.linkGroup || ''
      }))
    );
  });

  availableCollectionEndpoints = computed(() => {
    const el = this.selectedElement();
    if (!el || !el.tmdbCollectionType) return [];
    return this.tmdbEndpoints[el.tmdbCollectionType] || [];
  });

  availableSortOptions = computed(() => {
    const el = this.selectedElement();
    if (!el || el.tmdbEndpoint !== `discover/${el.tmdbCollectionType}`) return [];
    return this.discoverSortOptions[el.tmdbCollectionType as 'movie' | 'tv'] || [];
  });

  availableGenres = computed(() => {
    const el = this.selectedElement();
    if (!el || el.tmdbEndpoint !== `discover/${el.tmdbCollectionType}`) return [];
    return this.tmdbGenres()[el.tmdbCollectionType as 'movie' | 'tv'] || [];
  });

  syncLayerOptions = computed(() => {
    const selected = this.selectedElement();
    if (!selected || !selected.type.startsWith('tmdb-')) return [];
    return this.elements()
      .filter(el => el.id !== selected.id && el.type.startsWith('tmdb-'))
      .sort((a, b) => {
        const priority = (el: CanvasElement) => el.type === 'tmdb-backdrop-slideshow' ? 0 : (el.type === 'tmdb-poster-scroll' ? 1 : 2);
        return priority(a) - priority(b) || a.zIndex - b.zIndex;
      });
  });

  selectedSyncLayerId(element: CanvasElement): string {
    if (!element.linkGroup) return '';
    return this.syncLayerOptions().find(option => option.linkGroup === element.linkGroup)?.id || '';
  }

  private isCollectionElementType(type: ElementType | string): boolean {
    return type === 'tmdb-backdrop-slideshow' || type === 'tmdb-poster-scroll';
  }

  isCollectionElement(element: CanvasElement): boolean {
    return this.isCollectionElementType(element.type);
  }

  private normalizeCollectionItemLimit(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return this.defaultCollectionItemLimit;
    return Math.max(1, Math.min(this.maxCollectionItemLimit, Math.round(parsed)));
  }

  private getCollectionMasterForElement(element: CanvasElement, elements = this.elements()): CanvasElement | null {
    if (!element.linkGroup) return this.isCollectionElement(element) ? element : null;

    const collectionPriority = (el: CanvasElement) => el.type === 'tmdb-backdrop-slideshow' ? 0 : 1;
    const candidates = elements
      .filter(el => el.linkGroup === element.linkGroup && this.isCollectionElement(el))
      .sort((a, b) => collectionPriority(a) - collectionPriority(b) || a.zIndex - b.zIndex);

    return candidates[0] || (this.isCollectionElement(element) ? element : null);
  }

  isCollectionMaster(element: CanvasElement): boolean {
    return this.getCollectionMasterForElement(element)?.id === element.id;
  }

  getEffectiveCollectionItemLimit(element: CanvasElement, elements = this.elements()): number {
    const master = this.getCollectionMasterForElement(element, elements);
    return this.normalizeCollectionItemLimit(master?.collectionItemLimit ?? element.collectionItemLimit);
  }

  getEffectiveGlobalSceneFade(element: CanvasElement, elements = this.elements()): boolean {
    const master = this.getCollectionMasterForElement(element, elements);
    return !!(master?.globalSceneFade ?? element.globalSceneFade);
  }

  getPosterScrollItems(element: CanvasElement): any[] {
    return this.getLimitedCollectionItems(element).filter((item: any) => item.poster_path);
  }

  private getCollectionDetailTargets(sourceEl: CanvasElement, elements = this.elements()): CanvasElement[] {
    if (!sourceEl.linkGroup) return [];
    return elements.filter(el =>
      el.id !== sourceEl.id &&
      el.linkGroup === sourceEl.linkGroup &&
      el.type.startsWith('tmdb-') &&
      !this.isCollectionElement(el)
    );
  }

  private hasLinkedDetailTargets(sourceEl: CanvasElement, elements = this.elements()): boolean {
    return this.getCollectionDetailTargets(sourceEl, elements).length > 0;
  }

  isElementInGlobalSceneFade(element: CanvasElement): boolean {
    const master = this.getCollectionMasterForElement(element);
    if (!master || master.type !== 'tmdb-backdrop-slideshow' || !this.getEffectiveGlobalSceneFade(master)) return false;
    if (element.id !== master.id && element.linkGroup !== master.linkGroup) return false;
    return !!this.slideshowState()[master.id]?.sceneFade;
  }

  isImageElement(elementId: string | null): boolean {
      if (!elementId) return false;
      const el = this.elements().find(e => e.id === elementId);
      if (!el) return false;
      const imageTypes = ['image', 'tmdb-poster', 'tmdb-backdrop', 'tmdb-logo', 'tmdb-network-logo'];
      return imageTypes.includes(el.type);
  }

  isApiConfigured(): boolean {
      return this.authMethod() === 'v3' ? !!this.tmdbApiKey() : !!this.tmdbReadToken();
  }

  constructor() {
    effect(() => localStorage.setItem('tmdbAuthMethod', this.authMethod()));
    effect(() => {
        localStorage.setItem('tmdbReadToken', this.tmdbReadToken());
        this.authCheckSubject.next();
    });
    effect(() => {
        localStorage.setItem('tmdbApiKey', this.tmdbApiKey());
        this.authCheckSubject.next();
    });
    effect(() => localStorage.setItem('tmdbWatchRegion', this.watchRegion()));
    effect(() => localStorage.setItem('tmdbLanguage', this.language()));
    effect(() => localStorage.setItem('tmdbIncludeAdult', this.includeAdult().toString()));

    this.loadProjectFromLocalStorage();

    effect(() => {
        const dataKey = this.tmdbDataFetchKey();
        const authReady = this.isApiConfigured() && this.isAuthValid();
        this.language();
        this.watchRegion();
        this.includeAdult();

        if (!authReady || dataKey === '[]') return;

        untracked(() => {
            this.fetchTmdbGenres();
            try {
                (JSON.parse(dataKey) as Array<{id: string}>).forEach(source => this.fetchTmdbDataForElement(source.id));
            } catch {
                this.elements().forEach(el => this.fetchTmdbDataForElement(el.id));
            }
        });
    }, { allowSignalWrites: true });

    effect(() => this.updatePhpCode());
    effect(() => this.saveProjectToLocalStorage());

    this.saveStateToHistory();
  }

  ngOnInit() {
    // Auth Verification Pipeline
    this.authCheckSubject.pipe(
        debounceTime(500),
        takeUntil(this.destroy$)
    ).subscribe(() => this.verifyApiConnection());

    // Search Pipeline
    this.searchTerms.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      switchMap((term: string) => {
        if (!term.trim() || !this.isApiConfigured() || !this.selectedElement()) return of({results: []});
        this.isSearching.set(true);
        const type = this.selectedElement()?.tmdbItemType || 'movie';

        let headers = new HttpHeaders({'Content-Type': 'application/json;charset=utf-8'});
        let params = new URLSearchParams({ language: this.language(), query: term });

        if (this.authMethod() === 'v4') {
            headers = headers.set('Authorization', `Bearer ${this.tmdbReadToken()}`);
        } else {
            params.append('api_key', this.tmdbApiKey());
        }

        return this.http.get<any>(`https://api.themoviedb.org/3/search/${type}?${params.toString()}`, { headers }).pipe(catchError(() => of({results: []})));
      }),
      takeUntil(this.destroy$)
    ).subscribe(response => {
      this.tmdbSearchResults.set(response.results);
      this.isSearching.set(false);
      this.cdr.detectChanges();
    });

    // Initial check if keys exist
    if(this.isApiConfigured()) this.authCheckSubject.next();
  }

  ngAfterViewInit() {
    this.setupInteract();
    if (!this.restoredProjectFromStorage) setTimeout(() => this.fitCanvasToScreen());
  }
  ngOnDestroy() {
      this.destroy$.next();
      this.destroy$.complete();
      this.slideshowIntervals.forEach(interval => clearInterval(interval));
      this.posterScrollIntervals.forEach(interval => clearInterval(interval));
  }

  // --- HOST LISTENERS ---
  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    const activeTag = document.activeElement?.tagName.toLowerCase();
    const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z') { event.preventDefault(); this.undo(); }
      if (event.key === 'y') { event.preventDefault(); this.redo(); }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedElementId() && !isInputActive) {
             event.preventDefault();
             this.deleteElement(this.selectedElementId()!);
      }
    } else if (!isInputActive && this.selectedElementId()) {
        const el = this.selectedElement();
        if (el) {
            const step = event.shiftKey ? 10 : 1;
            let newX = el.x;
            let newY = el.y;
            let handled = false;

            switch(event.key) {
                case 'ArrowUp': newY -= step; handled = true; break;
                case 'ArrowDown': newY += step; handled = true; break;
                case 'ArrowLeft': newX -= step; handled = true; break;
                case 'ArrowRight': newX += step; handled = true; break;
            }

            if (handled) {
                event.preventDefault();
                this.updateElementProperty('x', newX, true);
                this.updateElementProperty('y', newY, true);
            }
        }
    }
  }

  @HostListener('document:click')
  onDocumentClick() { this.contextMenu.update(cm => ({ ...cm, visible: false })); }

  // --- API AUTH & VERIFICATION ---
  verifyApiConnection() {
      if (!this.isApiConfigured()) {
          this.tmdbUser.set(null);
          this.isAuthValid.set(false);
          return;
      }

      let headers = new HttpHeaders({'Content-Type': 'application/json;charset=utf-8'});
      let url = 'https://api.themoviedb.org/3/account';

      if (this.authMethod() === 'v4') {
          headers = headers.set('Authorization', `Bearer ${this.tmdbReadToken()}`);
      } else {
          url += `?api_key=${this.tmdbApiKey()}`;
      }

      this.http.get<any>(url, { headers }).pipe(
          catchError(() => {
              this.isAuthValid.set(false);
              this.tmdbUser.set(null);
              return of(null);
          }),
          takeUntil(this.destroy$)
      ).subscribe(data => {
          if (data) {
              this.isAuthValid.set(true);
              this.tmdbUser.set({
                  id: data.id,
                  username: data.username,
                  name: data.name,
                  avatar_path: data.avatar?.tmdb?.avatar_path ? `https://image.tmdb.org/t/p/w150_and_h150_face${data.avatar.tmdb.avatar_path}` : null
              });
              this.fetchTmdbGenres();
          }
          this.cdr.detectChanges();
      });
  }

  openTmdbSettings() {
      window.open('https://www.themoviedb.org/settings/api', '_blank');
  }

  // --- CANVAS CONTROLS ---
  private getResolutionPreset(preset: CanvasPreset, resolutionId?: string): CanvasResolutionPreset {
      const presets = this.canvasResolutionPresets[preset];
      return presets.find(option => option.id === resolutionId) || presets.find(option => option.id === this.defaultResolutionByPreset[preset]) || presets[0];
  }

  private getCanvasDimensions(preset: CanvasPreset, resolutionId: string, orientation: 'portrait' | 'landscape') {
      const base = this.getResolutionPreset(preset, resolutionId);
      let width = base.width;
      let height = base.height;
      const baseIsLandscape = base.width >= base.height;

      if (orientation === 'landscape' && !baseIsLandscape) { width = base.height; height = base.width; }
      if (orientation === 'portrait' && baseIsLandscape) { width = base.height; height = base.width; }

      return { width, height };
  }

  private scaleElementsToCanvas(oldW: number, oldH: number, newW: number, newH: number) {
      if (oldW === newW && oldH === newH) return;
      const scaleX = newW / oldW;
      const scaleY = newH / oldH;

      this.elements.update(els => els.map(el => ({
          ...el,
          x: el.x * scaleX,
          y: el.y * scaleY,
          width: el.width * scaleX,
          height: el.height * scaleY,
          styles: {
              ...el.styles,
              fontSize: el.styles.fontSize * ((scaleX + scaleY) / 2)
          }
      })));
  }

  changeCanvasMode(newPreset?: CanvasPreset, newOrientation?: 'portrait' | 'landscape') {
      const currentConfig = this.canvasConfig();
      const oldW = currentConfig.width;
      const oldH = currentConfig.height;

      const targetPreset = newPreset || this.selectedPreset();
      const targetOrientation = newOrientation || this.orientation();
      const targetResolution = newPreset ? this.defaultResolutionByPreset[targetPreset] : this.selectedResolutionId();
      const { width: newW, height: newH } = this.getCanvasDimensions(targetPreset, targetResolution, targetOrientation);

      if(newPreset) this.selectedPreset.set(newPreset);
      if(newPreset) this.selectedResolutionId.set(targetResolution);
      if(newOrientation) this.orientation.set(newOrientation);

      this.scaleElementsToCanvas(oldW, oldH, newW, newH);
      this.fitCanvasToScreen(targetPreset);
      this.saveStateToHistory();
  }

  changeCanvasResolution(resolutionId: string) {
      const currentConfig = this.canvasConfig();
      const { width: newW, height: newH } = this.getCanvasDimensions(this.selectedPreset(), resolutionId, this.orientation());

      this.selectedResolutionId.set(resolutionId);
      this.scaleElementsToCanvas(currentConfig.width, currentConfig.height, newW, newH);
      this.fitCanvasToScreen();
      this.saveStateToHistory();
  }

  fitCanvasToScreen(presetOverride?: CanvasPreset) {
      const viewport = document.getElementById('canvas-bg');
      const { width, height } = this.canvasConfig();

      if (!viewport) {
          const preset = presetOverride || this.selectedPreset();
          if (preset === 'tv') this.zoomLevel.set(0.45);
          else if (preset === 'tablet') this.zoomLevel.set(0.75);
          else this.zoomLevel.set(1.0);
          return;
      }

      const styles = window.getComputedStyle(viewport);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const availableWidth = Math.max(1, viewport.clientWidth - paddingX - 48);
      const availableHeight = Math.max(1, viewport.clientHeight - paddingY - 72);
      const fitScale = Math.min(availableWidth / width, availableHeight / height);
      const clampedScale = Math.min(2, Math.max(0.1, fitScale));
      this.zoomLevel.set(Math.round(clampedScale * 100) / 100);
  }

  // --- PROJECT PERSISTENCE ---
  private getProjectSnapshot() {
    return {
      version: 1,
      canvas: {
        selectedPreset: this.selectedPreset(),
        selectedResolutionId: this.selectedResolutionId(),
        orientation: this.orientation(),
        zoomLevel: this.zoomLevel()
      },
      settings: {
        watchRegion: this.watchRegion(),
        language: this.language(),
        includeAdult: this.includeAdult()
      },
      elements: this.elements().map(el => this.normalizeElementForProject(el))
    };
  }

  private normalizeElementForProject(element: CanvasElement): CanvasElement {
    const { tmdbData, ...rest } = element;
    const normalized: CanvasElement = {
      ...rest,
      discoverFilters: {
        sortBy: element.discoverFilters?.sortBy || 'popularity.desc',
        genres: (element.discoverFilters?.genres || []).map(Number).filter(Number.isFinite),
        year: element.discoverFilters?.year ? Number(element.discoverFilters.year) : null
      }
    };
    if (this.isCollectionElementType(normalized.type)) {
      normalized.collectionItemLimit = this.normalizeCollectionItemLimit(element.collectionItemLimit);
      normalized.globalSceneFade = !!element.globalSceneFade;
      normalized.tmdbId = undefined;
    }
    return normalized;
  }

  private restoreProject(project: any): boolean {
    if (!project || !Array.isArray(project.elements)) return false;

    const validPresets = ['mobile', 'tablet', 'tv'] as const;
    const validOrientations = ['portrait', 'landscape'] as const;
    const preset = validPresets.includes(project.canvas?.selectedPreset) ? project.canvas.selectedPreset as CanvasPreset : this.selectedPreset();
    const resolutionId = project.canvas?.selectedResolutionId;
    const orientation = project.canvas?.orientation;

    this.selectedPreset.set(preset);
    this.selectedResolutionId.set(this.getResolutionPreset(preset, resolutionId).id);
    if (validOrientations.includes(orientation)) this.orientation.set(orientation);
    if (typeof project.canvas?.zoomLevel === 'number') this.zoomLevel.set(project.canvas.zoomLevel);

    if (typeof project.settings?.watchRegion === 'string') this.watchRegion.set(project.settings.watchRegion);
    if (typeof project.settings?.language === 'string') this.language.set(project.settings.language);
    if (typeof project.settings?.includeAdult === 'boolean') this.includeAdult.set(project.settings.includeAdult);

    this.elements.set(project.elements.map((el: CanvasElement) => this.normalizeElementForProject(el)));
    this.selectedElementId.set(null);
    this.history.set([]);
    this.historyIndex.set(-1);
    this.saveStateToHistory();
    return true;
  }

  private loadProjectFromLocalStorage() {
    const savedProject = localStorage.getItem(this.projectStorageKey);
    if (!savedProject) return;

    try {
      this.restoredProjectFromStorage = this.restoreProject(JSON.parse(savedProject));
    } catch {
      localStorage.removeItem(this.projectStorageKey);
    }
  }

  private saveProjectToLocalStorage() {
    try {
      localStorage.setItem(this.projectStorageKey, JSON.stringify(this.getProjectSnapshot()));
    } catch {
      // Ignore quota/security errors so the editor remains usable.
    }
  }

  exportProjectJson() {
    const blob = new Blob([JSON.stringify(this.getProjectSnapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tmdb-layout-project.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  importProjectJson(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = JSON.parse(String(reader.result || ''));
        if (!this.restoreProject(project)) throw new Error('Invalid project file');
        this.saveProjectToLocalStorage();
      } catch {
        alert('Unable to import this project JSON file.');
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  // --- HISTORY MANAGEMENT ---
  saveStateToHistory() {
    setTimeout(() => {
      const currentState: HistoryState = { elements: JSON.parse(JSON.stringify(this.elements())), selectedElementId: this.selectedElementId() };
      const lastState = this.history()[this.historyIndex()];
      if (lastState && JSON.stringify(lastState.elements) === JSON.stringify(currentState.elements)) return;

      const newHistory = this.history().slice(0, this.historyIndex() + 1);
      newHistory.push(currentState);
      if (newHistory.length > this.maxHistoryStates) newHistory.shift();
      this.history.set(newHistory);
      this.historyIndex.set(newHistory.length - 1);
    }, 300);
  }

  undo() { if (this.historyIndex() > 0) { this.historyIndex.update(i => i - 1); this.restoreStateFromHistory(); } }
  redo() { if (this.historyIndex() < this.history().length - 1) { this.historyIndex.update(i => i + 1); this.restoreStateFromHistory(); } }

  restoreStateFromHistory() {
    const state = this.history()[this.historyIndex()];
    if (state) {
      this.elements.set(state.elements);
      this.selectedElementId.set(state.selectedElementId);
      state.elements.forEach(el => {
        if (el.type === 'tmdb-backdrop-slideshow') this.setupSlideshow(el.id);
        if (el.type === 'tmdb-poster-scroll') this.setupPosterScroll(el.id);
      });
    }
  }

  // --- ELEMENT MANIPULATION ---
  addElement(type: ElementType, itemType: TmdbItemType = 'movie', collectionType: TmdbCollectionType = 'movie') {
    const isLogo = type === 'tmdb-logo' || type === 'tmdb-network-logo';
    const currentScale = this.canvasConfig().width / 1920;
    const baseScale = this.selectedPreset() === 'mobile' ? 1 : (this.selectedPreset() === 'tablet' ? 1.5 : 2.5);

    const newElement: CanvasElement = {
      id: `el_${Date.now()}`, type, x: 50, y: 50,
      width: (type.includes('scroll') || type.includes('slideshow') ? 350 : (type.includes('backdrop') ? 300 : (type.includes('cast') ? 350 : (isLogo ? 120 : 150)))) * baseScale,
      height: (type.includes('text') || type.includes('title') || type.includes('tagline') || type.includes('dynamic') ? 50 : (type.includes('backdrop') || type.includes('slideshow') ? 169 : (type.includes('cast') ? 100 : (isLogo ? 60 : 225)))) * baseScale,
      rotation: 0,
      zIndex: this.elements().length + 1, content: 'New Element', visible: true,
      styles: {
          backgroundColor: type === 'tmdb-dynamic-field' ? '#0d253f' : '#1b3a57', // TMDB Dark Blue and Surface
          backgroundOpacity: type === 'tmdb-dynamic-field' ? 0 : 1,
          color: '#f1f5f9', fontFamily: 'Inter', fontSize: 16 * baseScale, fontWeight: '400', textAlign: 'left', borderRadius: 8, borderWidth: 0, borderColor: '#f1f5f9', opacity: 1, filterBlur: 0, filterGrayscale: 0
      },
      tmdbItemType: itemType,
      tmdbCollectionType: collectionType,
      discoverFilters: { sortBy: 'popularity.desc', genres: [], year: null },
      imageFit: isLogo ? 'contain' : 'cover',
      collectionItemLimit: this.isCollectionElementType(type) ? this.defaultCollectionItemLimit : undefined,
      globalSceneFade: false,
      linkGroup: '',
      dataPath: '',
      dataPrefix: '',
      dataSuffix: ''
    };

    if (type === 'tmdb-dynamic-field') {
        newElement.content = 'Dynamic Data';
        newElement.dataPath = 'vote_count';
        newElement.dataPrefix = 'Votes: ';
    }

    if (type === 'image') newElement.content = 'https://picsum.photos/200/300';
    if (type === 'shape') newElement.height = 100 * baseScale;
    this.elements.update(els => [...els, newElement]);
    this.selectElement(newElement.id);
    this.activeRightPanelTab.set('properties');
    this.saveStateToHistory();
  }

  deleteElement(id: string) {
    this.elements.update(els => els.filter(el => el.id !== id));
    if (this.selectedElementId() === id) this.selectedElementId.set(null);
    if(this.slideshowIntervals.has(id)) { clearInterval(this.slideshowIntervals.get(id)); this.slideshowIntervals.delete(id); }
    if(this.posterScrollIntervals.has(id)) { clearInterval(this.posterScrollIntervals.get(id)); this.posterScrollIntervals.delete(id); }
    this.saveStateToHistory();
  }

  selectElement(id: string | null) {
    this.selectedElementId.set(id);
    if(id) {
        this.tmdbSearchResults.set([]);
    }
  }

  deselectCanvas(event: MouseEvent) { if ((event.target as HTMLElement).id === 'canvas-bg') this.selectedElementId.set(null); }

  bringToFront(id: string, saveHistory = true) {
    const maxZ = Math.max(...this.elements().map(e => e.zIndex), 0);
    this.elements.update(els => els.map(el => el.id === id ? { ...el, zIndex: maxZ + 1 } : el));
    if(saveHistory) this.saveStateToHistory();
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  sendToBack(id: string, saveHistory = true) {
    const minZ = Math.min(...this.elements().map(e => e.zIndex), 0);
    this.elements.update(els => els.map(el => el.id === id ? { ...el, zIndex: minZ - 1 } : el));
    if (saveHistory) this.saveStateToHistory();
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  updateElementStyle(prop: keyof CanvasElement['styles'], value: any) { this.updateSelectedElement(el => { el.styles = { ...el.styles, [prop]: value }; }); }

  updateElementProperty(prop: keyof CanvasElement, value: any, noHistory = false) {
      this.updateSelectedElement(el => { (el as any)[prop] = value; }, noHistory);

      if (prop === 'tmdbId') {
         const el = this.selectedElement();
         if(el && el.linkGroup) {
             this.propagateTmdbId(el.linkGroup, value, el.tmdbItemType);
         } else if(el) {
	         this.fetchTmdbDataForElement(el.id);
	     }
      }
  }

  updateCollectionItemLimit(elementId: string, value: number) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected) return;

    const master = this.getCollectionMasterForElement(selected) || selected;
    const nextLimit = this.normalizeCollectionItemLimit(value);

    this.elements.update(els => els.map(el => el.id === master.id ? { ...el, collectionItemLimit: nextLimit, tmdbData: null } : el));
    this.fetchTmdbDataForElement(master.id);
    this.saveStateToHistory();
  }

  updateGlobalSceneFade(elementId: string, value: boolean) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected) return;

    const master = this.getCollectionMasterForElement(selected) || selected;
    this.elements.update(els => els.map(el => el.id === master.id ? { ...el, globalSceneFade: value } : el));
    this.saveStateToHistory();
  }

  setImageFit(id: string, fit: ImageFit) {
      this.elements.update(els => els.map(el => el.id === id ? { ...el, imageFit: fit } : el));
      this.saveStateToHistory();
      this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  fitBackdropToCanvas(id: string, mode: BackdropFitMode) {
    const { width: canvasW, height: canvasH } = this.canvasConfig();
    const backdropRatio = 16 / 9;
    let width = canvasW;
    let height = canvasW / backdropRatio;

    if (mode === 'height') {
      height = canvasH;
      width = canvasH * backdropRatio;
    } else if (mode === 'cover') {
      const widthBasedHeight = canvasW / backdropRatio;
      const heightBasedWidth = canvasH * backdropRatio;
      if (widthBasedHeight >= canvasH) {
        width = canvasW;
        height = widthBasedHeight;
      } else {
        width = heightBasedWidth;
        height = canvasH;
      }
    }

    this.elements.update(els => els.map(el => {
      if (el.id !== id) return el;
      return {
        ...el,
        x: (canvasW - width) / 2,
        y: (canvasH - height) / 2,
        width,
        height
      };
    }));
    this.saveStateToHistory();
  }

  updateDiscoverFilter(prop: keyof DiscoverFilters, value: any) { this.updateSelectedElement(el => { el.discoverFilters = { ...el.discoverFilters, [prop]: value }; }); }

  toggleDiscoverGenre(elementId: string, genreId: number, checked: boolean) {
    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;

      const currentGenres = (el.discoverFilters.genres || []).map(Number);
      const nextGenres = checked
        ? Array.from(new Set([...currentGenres, genreId]))
        : currentGenres.filter(id => id !== genreId);

      return {
        ...el,
        discoverFilters: {
          ...el.discoverFilters,
          genres: nextGenres
        },
        tmdbData: null
      };
    }));
    this.fetchTmdbDataForElement(elementId);
    this.saveStateToHistory();
  }

  private updateSelectedElement(updateFn: (el: CanvasElement) => void, noHistory = false) {
    const id = this.selectedElementId();
    if (!id) return;
    this.elements.update(els => els.map(el => {
      if (el.id === id) { const newEl = { ...el }; updateFn(newEl); return newEl; }
      return el;
    }));
    if(!noHistory) this.saveStateToHistory();
  }

  toggleVisibility(id: string) {
    this.elements.update(els => els.map(el => el.id === id ? {...el, visible: !el.visible} : el));
    this.saveStateToHistory();
  }

  private getLimitedCollectionItems(element: CanvasElement): any[] {
    const results = element.tmdbData?.results;
    if (!Array.isArray(results) || results.length === 0) return [];

    return this.getLimitedCollectionItemsFromResults(element, results);
  }

  private getLimitedCollectionItemsFromResults(element: CanvasElement, results: any[]): any[] {
    if (!Array.isArray(results) || results.length === 0) return [];
    const limit = this.getEffectiveCollectionItemLimit(element);
    if (element.type === 'tmdb-backdrop-slideshow') return results.filter((item: any) => item.backdrop_path).slice(0, limit);
    if (element.type === 'tmdb-poster-scroll') return results.filter((item: any) => item.poster_path).slice(0, limit);
    return results.slice(0, limit);
  }

  private getCurrentTmdbSourceItem(elementId: string, element: CanvasElement): any | null {
    const slideshow = this.slideshowState()[elementId];
    if (slideshow?.items?.length) return slideshow.items[slideshow.idx1] || slideshow.items[0];

    const items = this.getLimitedCollectionItems(element);
    if (items.length > 0) return items[0];
    return element.tmdbData || null;
  }

  private resolveItemTypeFromSourceItem(item: any, fallback?: TmdbCollectionType | TmdbItemType): TmdbItemType {
    const mediaType = item?.media_type;
    if (mediaType === 'movie' || mediaType === 'tv' || mediaType === 'person') return mediaType;
    if (fallback === 'tv' || fallback === 'person') return fallback;
    return 'movie';
  }

  private detailKeyForItem(item: any, fallback?: TmdbCollectionType | TmdbItemType): string {
    if (!item?.id) return '';
    return `${this.resolveItemTypeFromSourceItem(item, fallback)}:${item.id}`;
  }

  private getCollectionItemDetail(sourceEl: CanvasElement, item: any): any {
    if (!item) return null;
    const details = sourceEl.tmdbData?.__detailsById || {};
    const key = this.detailKeyForItem(item, sourceEl.tmdbCollectionType || sourceEl.tmdbItemType);
    return details[key] || details[String(item.id)] || item;
  }

  private resolveTmdbSourceSelection(sourceEl: CanvasElement, sourceElementId: string, fallbackEl?: CanvasElement): { tmdbId: string; itemType: TmdbItemType } {
    const currentItem = this.getCurrentTmdbSourceItem(sourceElementId, sourceEl);
    const rawId = currentItem?.id ?? sourceEl.tmdbId ?? sourceEl.tmdbData?.id ?? fallbackEl?.tmdbId ?? '';
    const fallbackType = currentItem ? (sourceEl.tmdbCollectionType || sourceEl.tmdbItemType) : (sourceEl.tmdbItemType || fallbackEl?.tmdbItemType || 'movie');

    return {
      tmdbId: rawId ? String(rawId) : '',
      itemType: this.resolveItemTypeFromSourceItem(currentItem, fallbackType)
    };
  }

  private propagateSourceItemToLinkedGroup(sourceElementId: string, sourceEl: CanvasElement, item: any) {
    if (!sourceEl.linkGroup || !item?.id) return;
    const itemType = this.resolveItemTypeFromSourceItem(item, sourceEl.tmdbCollectionType || sourceEl.tmdbItemType);
    const detail = this.getCollectionItemDetail(sourceEl, item);
    const hasEnrichedDetail = detail && !Array.isArray(detail.results) && (
      !!detail.credits ||
      !!detail.images ||
      !!detail.runtime ||
      !!detail.tagline ||
      !!detail.genres
    );

    this.elements.update(els => els.map(el => {
      if (el.linkGroup !== sourceEl.linkGroup || el.id === sourceElementId || this.isCollectionElement(el)) return el;
      return {
        ...el,
        tmdbId: String(item.id),
        tmdbItemType: itemType,
        tmdbData: detail || item
      };
    }));

    if (!hasEnrichedDetail) {
      this.elements().forEach(el => {
        if (el.linkGroup === sourceEl.linkGroup && el.id !== sourceElementId && !this.isCollectionElement(el)) {
          this.fetchTmdbDataForElement(el.id);
        }
      });
    }
  }

  syncElementWithLayer(elementId: string, targetId: string) {
    if (!targetId) {
      this.elements.update(els => els.map(el => el.id === elementId ? { ...el, linkGroup: '', tmdbData: null } : el));
      this.saveStateToHistory();
      return;
    }

    const allElements = this.elements();
    const targetEl = allElements.find(el => el.id === targetId);
    const sourceEl = allElements.find(el => el.id === elementId);
    if (!targetEl || !sourceEl) return;

    const groupId = targetEl.linkGroup || ('group_' + Date.now().toString(36));
    const { tmdbId, itemType } = this.resolveTmdbSourceSelection(targetEl, targetId, sourceEl);

    this.elements.update(els => els.map(el => {
      if (el.id === targetId) return { ...el, linkGroup: groupId };
      if (el.id === elementId) {
        if (this.isCollectionElement(el)) {
          return {
            ...el,
            linkGroup: groupId,
            tmdbData: null
          };
        }
        return {
          ...el,
          linkGroup: groupId,
          tmdbId,
          tmdbItemType: itemType,
          tmdbData: null
        };
      }
      return el;
    }));

    if (this.isCollectionElement(targetEl)) {
      this.fetchTmdbDataForElement(targetId);
      this.saveStateToHistory();
      return;
    }

    if (this.isCollectionElement(sourceEl)) this.fetchTmdbDataForElement(elementId);
    else if (tmdbId) this.propagateTmdbId(groupId, tmdbId, itemType, targetId);
    else this.fetchTmdbDataForElement(elementId);
    this.saveStateToHistory();
  }

  // --- DRAG & DROP LAYERS (GROUPING) ---
  onLayerDragStart(event: DragEvent, elementId: string) {
    this.draggedLayerId.set(elementId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'link';
      event.dataTransfer.setData('text/plain', elementId);
    }
  }

  onLayerDragOver(event: DragEvent, targetId: string) {
    event.preventDefault();
    const draggedId = this.draggedLayerId();
    if (!draggedId || draggedId === targetId) return;
    this.dragOverLayerId.set(targetId);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
  }

  onLayerDragLeave(event: DragEvent) { this.dragOverLayerId.set(null); }

  onLayerDrop(event: DragEvent, targetId: string) {
    event.preventDefault();
    this.dragOverLayerId.set(null);
    const draggedId = this.draggedLayerId();
    if (!draggedId || draggedId === targetId) return;
    this.linkElements(draggedId, targetId);
    this.draggedLayerId.set(null);
  }

  linkElements(sourceId: string, targetId: string) {
    this.syncElementWithLayer(sourceId, targetId);
  }

  unlinkElement(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.elements.update(els => els.map(el => el.id === id ? { ...el, linkGroup: '' } : el));
    this.saveStateToHistory();
  }

  // --- TMDB API IMPLEMENTATION ---

  fetchTmdbGenres() {
    if(!this.isApiConfigured()) return;

    let headers = new HttpHeaders({'Content-Type': 'application/json;charset=utf-8'});
    let params = new URLSearchParams();

    if (this.authMethod() === 'v4') {
        headers = headers.set('Authorization', `Bearer ${this.tmdbReadToken()}`);
    } else {
        params.append('api_key', this.tmdbApiKey());
    }

    const movieUrl = `https://api.themoviedb.org/3/genre/movie/list?${params.toString()}`;
    const tvUrl = `https://api.themoviedb.org/3/genre/tv/list?${params.toString()}`;

    this.http.get<any>(movieUrl, { headers }).pipe(catchError(() => of({genres: []})), takeUntil(this.destroy$)).subscribe(data => this.tmdbGenres.update(g => ({...g, movie: data.genres})));
    this.http.get<any>(tvUrl, { headers }).pipe(catchError(() => of({genres: []})), takeUntil(this.destroy$)).subscribe(data => this.tmdbGenres.update(g => ({...g, tv: data.genres})));
  }

  private buildTmdbDetailUrl(item: any, fallbackType: TmdbCollectionType | TmdbItemType): string {
    const itemType = this.resolveItemTypeFromSourceItem(item, fallbackType);
    const params = new URLSearchParams({
      language: this.language(),
      include_adult: this.includeAdult().toString(),
      append_to_response: [
        'credits', 'images', 'videos', 'content_ratings', 'release_dates',
        'keywords', 'external_ids', 'recommendations', 'similar', 'reviews',
        'lists', 'translations', 'watch/providers'
      ].join(',')
    });

    if (this.authMethod() === 'v3') params.append('api_key', this.tmdbApiKey());
    return `https://api.themoviedb.org/3/${itemType}/${item.id}?${params.toString()}`;
  }

  private enrichCollectionDataForLinkedScene(element: CanvasElement, data: any, headers: HttpHeaders): Observable<any> {
    if (!data || !Array.isArray(data.results) || !this.hasLinkedDetailTargets(element)) return of(data);

    const items = this.getLimitedCollectionItemsFromResults(element, data.results)
      .filter((item: any) => item?.id)
      .slice(0, this.getEffectiveCollectionItemLimit(element));

    if (items.length === 0) return of(data);

    const fallbackType = element.tmdbCollectionType || element.tmdbItemType || 'movie';
    const requests = items.map((item: any) =>
      this.http.get<any>(this.buildTmdbDetailUrl(item, fallbackType), { headers }).pipe(
        catchError(() => of(item)),
        map(detail => ({
          key: this.detailKeyForItem(item, fallbackType),
          altKey: String(item.id),
          detail
        } as TmdbDetailEntry))
      )
    );

    return forkJoin(requests).pipe(
      map(entries => {
        const detailsById = entries.reduce((acc, entry) => {
          if (entry.key) acc[entry.key] = entry.detail;
          if (entry.altKey) acc[entry.altKey] = entry.detail;
          return acc;
        }, {} as Record<string, any>);

        return {
          ...data,
          __detailsById: detailsById
        };
      })
    );
  }

  searchTmdb(query: string) { this.searchTerms.next(query); }

  selectTmdbItem(item: any) {
    const current = this.selectedElement();
    if (!current) return;
    const newItemType = current.tmdbItemType;
    if (current.linkGroup) {
        this.propagateTmdbId(current.linkGroup, item.id, newItemType);
    } else {
        this.updateElementProperty('tmdbId', item.id);
        this.fetchTmdbDataForElement(current.id);
    }
    this.tmdbSearchResults.set([]);
  }

  propagateTmdbId(groupName: string, tmdbId: string, itemType: TmdbItemType, excludeElementId?: string) {
      this.elements.update(els => els.map(el => {
          if (el.linkGroup === groupName && el.id !== excludeElementId && !this.isCollectionElement(el)) {
              return { ...el, tmdbId: tmdbId, tmdbItemType: itemType, tmdbData: null };
          }
          return el;
      }));
      this.elements().forEach(el => {
          if (el.linkGroup === groupName && el.id !== excludeElementId && !this.isCollectionElement(el)) this.fetchTmdbDataForElement(el.id);
      });
      if (!excludeElementId) this.saveStateToHistory();
  }

  fetchTmdbDataForElement(id: string, isInitial = false) {
    const element = this.elements().find(el => el.id === id);
    if (!element || !this.isApiConfigured() || (isInitial && element.tmdbData)) return;
    const requestToken = ++this.tmdbFetchSequence;
    this.tmdbFetchTokens.set(id, requestToken);
    const requestTmdbId = element.tmdbId ? String(element.tmdbId) : '';
    const requestItemType = element.tmdbItemType;
    const requestEndpoint = element.tmdbEndpoint || '';

    let headers = new HttpHeaders({'Content-Type': 'application/json;charset=utf-8'});
    const params = new URLSearchParams({ language: this.language(), include_adult: this.includeAdult().toString() });

    if (this.authMethod() === 'v4') {
        headers = headers.set('Authorization', `Bearer ${this.tmdbReadToken()}`);
    } else {
        params.append('api_key', this.tmdbApiKey());
    }

    let obs: Observable<any>;

    if (element.tmdbId && element.tmdbItemType && !this.isCollectionElement(element)) {
        const append = [
            'credits', 'images', 'videos', 'content_ratings', 'release_dates',
            'keywords', 'external_ids', 'recommendations', 'similar', 'reviews',
            'lists', 'translations', 'watch/providers'
        ].join(',');

        params.append('append_to_response', append);
        obs = this.http.get(`https://api.themoviedb.org/3/${element.tmdbItemType}/${element.tmdbId}?${params.toString()}`, { headers });
    } else if (element.tmdbEndpoint) {
        if (element.tmdbEndpoint.startsWith('discover')) {
          params.append('sort_by', element.discoverFilters.sortBy);
          if (element.discoverFilters.genres.length > 0) params.append('with_genres', element.discoverFilters.genres.join(','));
          const yearKey = element.tmdbCollectionType === 'movie' ? 'primary_release_year' : 'first_air_date_year';
          if (element.discoverFilters.year) params.append(yearKey, element.discoverFilters.year.toString());
        }
        params.append('watch_region', this.watchRegion());
        const itemLimit = this.getEffectiveCollectionItemLimit(element);
        const pageCount = Math.ceil(itemLimit / 20);
        const buildCollectionUrl = (page: number) => {
          const pageParams = new URLSearchParams(params.toString());
          pageParams.set('page', page.toString());
          return `https://api.themoviedb.org/3/${element.tmdbEndpoint}?${pageParams.toString()}`;
        };

        if (pageCount > 1) {
          obs = forkJoin(Array.from({ length: pageCount }, (_, index) => this.http.get<any>(buildCollectionUrl(index + 1), { headers }))).pipe(
            map(responses => {
              const first = responses[0] || {};
              return {
                ...first,
                results: responses.flatMap(response => Array.isArray(response?.results) ? response.results : []).slice(0, itemLimit)
              };
            })
          );
        } else {
          obs = this.http.get(buildCollectionUrl(1), { headers });
        }

        obs = obs.pipe(switchMap(data => this.enrichCollectionDataForLinkedScene(element, data, headers)));
    } else { return; }

    obs.pipe(catchError(() => of(null)), takeUntil(this.destroy$)).subscribe(data => {
      if (!data) return;
      if (this.tmdbFetchTokens.get(id) !== requestToken) return;
      const latest = this.elements().find(el => el.id === id);
      if (!latest) return;
      if (!this.isCollectionElement(latest)) {
        if (requestTmdbId && String(latest.tmdbId || '') !== requestTmdbId) return;
        if (latest.tmdbItemType !== requestItemType) return;
      } else if ((latest.tmdbEndpoint || '') !== requestEndpoint) {
        return;
      }

      this.elements.update(els => els.map(el => el.id === id ? {...el, tmdbData: data} : el));
      if (element.type === 'tmdb-backdrop-slideshow') this.setupSlideshow(id);
      if (element.type === 'tmdb-poster-scroll') this.setupPosterScroll(id);
      this.cdr.detectChanges();
    });
  }

  // Dynamic Data Path Resolver (e.g. "credits.cast.0.name")
  resolveDataPath(data: any, path: string): string {
      if (!data || !path) return '';
      try {
          const parts = path.split('.');
          let current = data;
          for (const part of parts) {
              if (current === undefined || current === null) return '';
              current = current[part];
          }
          if (typeof current === 'object') return JSON.stringify(current);
          return String(current);
      } catch (e) { return ''; }
  }

  setupPosterScroll(elementId: string) {
      if (this.posterScrollIntervals.has(elementId)) clearInterval(this.posterScrollIntervals.get(elementId));
      const element = this.elements().find(e => e.id === elementId);
      if (element) {
        this.propagateSourceItemToLinkedGroup(elementId, element, this.getLimitedCollectionItems(element)[0]);
      }

      // Simple auto-scroll simulation for editor
      const interval = setInterval(() => {
          const el = document.getElementById(elementId);
          if (el && el.firstElementChild) {
              const container = el.firstElementChild as HTMLElement;
              if(container.scrollLeft >= (container.scrollWidth - container.clientWidth)) {
                  container.scrollLeft = 0;
              } else {
                  container.scrollLeft += 1;
              }
          }
      }, 30);
      this.posterScrollIntervals.set(elementId, interval);
  }

  setupSlideshow(elementId: string) {
    if (this.slideshowIntervals.has(elementId)) clearInterval(this.slideshowIntervals.get(elementId));

    const element = this.elements().find(e => e.id === elementId);
    if (!element?.tmdbData?.results) return;

    const slideItems = this.getLimitedCollectionItems(element);
    const backdrops = slideItems.map((item: any) => 'https://image.tmdb.org/t/p/w1280' + item.backdrop_path);
    if (backdrops.length === 0) return;

    this.slideshowState.update(s => ({...s, [elementId]: { idx1: 0, idx2: backdrops.length > 1 ? 1 : 0, fade: false, sceneFade: false, backdrops, items: slideItems }}));
    this.propagateSourceItemToLinkedGroup(elementId, element, slideItems[0]);

    if (backdrops.length < 2) return;

    const advanceSlide = () => {
        const el = this.elements().find(e => e.id === elementId);
        const state = this.slideshowState()[elementId];
        if (!state) return;

        const nextItem = state.items[state.idx2];
        if (el && nextItem) this.propagateSourceItemToLinkedGroup(elementId, el, nextItem);

        this.slideshowState.update(s => {
            const current = s[elementId];
            if (!current) return s;
            const nextNextIdx = (current.idx2 + 1) % current.backdrops.length;
            return {...s, [elementId]: { ...current, idx1: current.idx2, idx2: nextNextIdx, fade: false, sceneFade: false } };
        });
        this.cdr.detectChanges();
    };

    const interval = setInterval(() => {
        const el = this.elements().find(e => e.id === elementId);
        if (el && this.getEffectiveGlobalSceneFade(el)) {
            this.slideshowState.update(s => {
                const current = s[elementId];
                if (!current) return s;
                return {...s, [elementId]: { ...current, sceneFade: true, fade: false } };
            });
            this.cdr.detectChanges();
            setTimeout(() => advanceSlide(), this.sceneFadeDurationMs);
            return;
        }

        this.slideshowState.update(s => {
            const current = s[elementId];
            if (!current) return s;
            return {...s, [elementId]: { ...current, fade: true } };
        });
        this.cdr.detectChanges();

        const state = this.slideshowState()[elementId];
        if (el && state.items && state.items.length > state.idx2) {
            const nextItem = state.items[state.idx2];
            if (nextItem) this.propagateSourceItemToLinkedGroup(elementId, el, nextItem);
        }

        setTimeout(() => {
            this.slideshowState.update(s => {
                const current = s[elementId];
                if (!current) return s;
                return {...s, [elementId]: { ...current, idx1: current.idx2, fade: false } };
            });
            this.cdr.detectChanges();

            setTimeout(() => {
                 this.slideshowState.update(s => {
                    const current = s[elementId];
                    if (!current) return s;
                    const nextNextIdx = (current.idx2 + 1) % current.backdrops.length;
                    return {...s, [elementId]: { ...current, idx2: nextNextIdx } };
                 });
                 this.cdr.detectChanges();
            }, 900);
        }, 1100);

    }, 5000);
    this.slideshowIntervals.set(elementId, interval);
  }

  // --- UI & INTERACTION ---
  private setupInteract() {
    if (typeof interact === 'undefined') return;

    const snapModifiers = [
        interact.modifiers.snap({ targets: [], range: Infinity, relativePoints: [{ x: 0.5, y: 0.5 }] }),
        interact.modifiers.restrictRect({ restriction: 'parent', endOnly: false })
    ];

    interact('.draggable-element').unset();
    interact('.draggable-element').draggable({
      listeners: {
        move: (event: any) => {
          const scale = this.canvasConfig().scale;
          const target = event.target;
          const currentDataX = (parseFloat(target.getAttribute('data-x')) || 0);
          const currentDataY = (parseFloat(target.getAttribute('data-y')) || 0);
          const x = currentDataX + (event.dx / scale);
          const y = currentDataY + (event.dy / scale);

          const element = this.elements().find(el => el.id === target.id);
          const rotation = element?.rotation || 0;

          target.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
        },
        end: (event: any) => {
          const target = event.target;
          const element = this.elements().find(el => el.id === target.id);
          if (element) {
            const xOffset = (parseFloat(target.getAttribute('data-x')) || 0);
            const yOffset = (parseFloat(target.getAttribute('data-y')) || 0);
            const newX = element.x + xOffset;
            const newY = element.y + yOffset;

            this.updateElementProperty('x', newX, true);
            this.updateElementProperty('y', newY, true);

            target.style.transform = `rotate(${element.rotation}deg)`;
            target.removeAttribute('data-x');
            target.removeAttribute('data-y');
            this.saveStateToHistory();
          }
        }
      },
      modifiers: snapModifiers,
      inertia: false
    }).resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      listeners: {
        move: (event: any) => {
          const id = event.target.id;
          const scale = this.canvasConfig().scale;
          this.elements.update(els =>
            els.map(el => {
              if (el.id === id) {
                return {
                    ...el,
                    width: Math.max(20, el.width + (event.deltaRect.width / scale)),
                    height: Math.max(20, el.height + (event.deltaRect.height / scale)),
                    x: el.x + (event.deltaRect.left / scale),
                    y: el.y + (event.deltaRect.top / scale),
                };
              }
              return el;
            })
          );
        },
        end: () => this.saveStateToHistory()
      },
      modifiers: [interact.modifiers.restrictSize({ min: { width: 20, height: 20 } })],
      inertia: false
    });
  }

  openContextMenu(event: MouseEvent, elementId: string) {
    event.preventDefault(); event.stopPropagation();
    this.selectElement(elementId);
    const menuWidth = 200;
    const menuHeight = 300;
    const x = event.clientX + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 10 : event.clientX;
    const y = event.clientY + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 10 : event.clientY;
    this.contextMenu.set({ visible: true, x, y, elementId });
  }

  duplicateElement(id: string) {
    const elToDup = this.elements().find(el => el.id === id);
    if (!elToDup) return;
    const newEl: CanvasElement = { ...JSON.parse(JSON.stringify(elToDup)), id: `el_${Date.now()}`, x: elToDup.x + 20, y: elToDup.y + 20, zIndex: this.elements().length + 1 };
    this.elements.update(els => [...els, newEl]);
    this.selectElement(newEl.id);
    this.saveStateToHistory();
  }

  copyStyles(id: string) { const el = this.elements().find(e => e.id === id); if (el) this.copiedStyles.set(JSON.parse(JSON.stringify(el.styles))); }
  pasteStyles(id: string) { const styles = this.copiedStyles(); if (!styles) return; this.elements.update(els => els.map(el => el.id === id ? { ...el, styles: { ...el.styles, ...styles } } : el)); this.saveStateToHistory(); }

  alignElement(id: string, type: 'fill' | 'fitW' | 'fitH' | 'center' | 'centerH' | 'centerV' | 'top' | 'bottom' | 'left' | 'right') {
    const { width, height } = this.canvasConfig();
    this.elements.update(els => els.map(el => {
      if (el.id !== id) return el;
      switch(type) {
        case 'fill': return { ...el, x: 0, y: 0, width: width, height: height };
        case 'fitW': return { ...el, x: 0, width: width };
        case 'fitH': return { ...el, y: 0, height: height };
        case 'center': return { ...el, x: (width - el.width) / 2, y: (height - el.height) / 2 };
        case 'centerH': return { ...el, x: (width - el.width) / 2 };
        case 'centerV': return { ...el, y: (height - el.height) / 2 };
        case 'top': return { ...el, y: 0 };
        case 'bottom': return { ...el, y: height - el.height };
        case 'left': return { ...el, x: 0 };
        case 'right': return { ...el, x: width - el.width };
      }
      return el;
    }));
    this.saveStateToHistory();
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  formatTypeName(type: string): string { return type.replace('tmdb-', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); }

  getBestLogo(element: CanvasElement): string | null {
    const logos = element.tmdbData?.images?.logos;
    if (!logos || logos.length === 0) return null;
    const langLogo = logos.find((l: any) => l.iso_639_1 === this.language().substring(0,2));
    const englishLogo = logos.find((l: any) => l.iso_639_1 === 'en');
    const chosenLogo = langLogo || englishLogo || logos[0];
    return 'https://image.tmdb.org/t/p/w500' + chosenLogo.file_path;
  }

  getBestNetworkLogo(element: CanvasElement): string | null {
      const networks = element.tmdbData?.networks;
      if (!networks || networks.length === 0) return null;
      return 'https://image.tmdb.org/t/p/w300' + networks[0].logo_path;
  }

  hexToRgba(hex: string, alpha: number): string {
      let r = 0, g = 0, b = 0;
      if (hex.length === 4) {
          r = parseInt('0x' + hex[1] + hex[1]);
          g = parseInt('0x' + hex[2] + hex[2]);
          b = parseInt('0x' + hex[3] + hex[3]);
      } else if (hex.length === 7) {
          r = parseInt('0x' + hex[1] + hex[2]);
          g = parseInt('0x' + hex[3] + hex[4]);
          b = parseInt('0x' + hex[5] + hex[6]);
      }
      return `rgba(${r},${g},${b},${alpha})`;
  }

  // --- PHP EXPORT ---
  updatePhpCode() { this.generatedPhpCode.set(this.generatePHP()); }

  private escapeHtml(value: any): string {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char] || char));
  }

  private escapePhpSingleQuoted(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private safeElementId(id: string): string {
    const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return safe || 'el_export';
  }

  private clampNumber(value: any, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private safeCssColor(value: any, fallback = '#000000'): string {
    const raw = String(value || '').trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;
    if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i.test(raw)) return raw;
    return fallback;
  }

  private safeFontFamily(font: string): string {
    return this.fonts.includes(font) ? font : 'Inter';
  }

  private normalizeExportDiscoverFilters(filters: DiscoverFilters | undefined): DiscoverFilters {
    return {
      sortBy: filters?.sortBy || 'popularity.desc',
      genres: (filters?.genres || []).map(Number).filter(Number.isFinite),
      year: filters?.year ? Number(filters.year) : null
    };
  }

  private buildExportSources(elements: CanvasElement[]) {
    const sources: Record<string, any> = {};
    const elementSources = new Map<string, string>();
    const sourceKeys = new Map<string, string>();
    let sourceIndex = 1;

    const linkedCollectionGroups = new Set(
      elements
        .filter(el => ['tmdb-backdrop-slideshow', 'tmdb-poster-scroll'].includes(el.type) && !!el.linkGroup)
        .filter(el => elements.some(other => other.id !== el.id && other.linkGroup === el.linkGroup && other.type.startsWith('tmdb-') && !['tmdb-backdrop-slideshow', 'tmdb-poster-scroll'].includes(other.type)))
        .map(el => el.linkGroup)
    );

    for (const el of elements) {
      if (!el.type.startsWith('tmdb-')) continue;

      let source: any | null = null;
      if (el.tmdbId && el.tmdbItemType && !this.isCollectionElement(el)) {
        source = {
          kind: 'detail',
          itemType: el.tmdbItemType,
          tmdbId: String(el.tmdbId),
          ttl: 21600
        };
      } else if (el.tmdbEndpoint) {
        source = {
          kind: 'collection',
          endpoint: el.tmdbEndpoint,
          collectionType: el.tmdbCollectionType || 'movie',
          discoverFilters: this.normalizeExportDiscoverFilters(el.discoverFilters),
          limit: this.getEffectiveCollectionItemLimit(el, elements),
          enrichLinked: !!el.linkGroup && linkedCollectionGroups.has(el.linkGroup),
          ttl: 900
        };
      }

      if (!source) continue;
      const key = JSON.stringify(source);
      let sourceId = sourceKeys.get(key);
      if (!sourceId) {
        sourceId = `src_${sourceIndex++}`;
        sourceKeys.set(key, sourceId);
        sources[sourceId] = source;
      }
      elementSources.set(el.id, sourceId);
    }

    return { sources, elementSources };
  }

  private buildGeneratedPhpClientScript(): string {
    return `
    const baseImgUrl = 'https://image.tmdb.org/t/p/w500';
    const baseBackdropUrl = 'https://image.tmdb.org/t/p/w1280';
    const sourcePromises = new Map();

    function resolveDataPath(data, path) {
        if (!data || !path) return '';
        try {
            return path.split('.').reduce((current, part) => {
                if (current === undefined || current === null) return '';
                return current[part];
            }, data);
        } catch (e) {
            return '';
        }
    }

    function clearElement(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    function setText(el, value) {
        clearElement(el);
        el.textContent = value === undefined || value === null ? '' : String(value);
    }

    function appendImage(el, src, alt, fit) {
        clearElement(el);
        if (!src) return;
        const img = document.createElement('img');
        img.src = src;
        img.alt = alt || '';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = fit || 'cover';
        el.appendChild(img);
    }

    function getBestLogo(logos, lang) {
        if (!Array.isArray(logos) || logos.length === 0) return '';
        const prefix = String(lang || 'en').substring(0, 2);
        const logo = logos.find(item => item.iso_639_1 === prefix) || logos.find(item => item.iso_639_1 === 'en') || logos[0];
        return logo && logo.file_path ? baseImgUrl + logo.file_path : '';
    }

    function fetchSource(sourceId) {
        if (!sourceId) return Promise.resolve(null);
        if (sourcePromises.has(sourceId)) return sourcePromises.get(sourceId);
        const url = new URL(window.location.href);
        url.search = '';
        url.searchParams.set('tmdb_source', sourceId);
        const promise = fetch(url.toString(), { credentials: 'same-origin' })
            .then(response => response.ok ? response.json() : null)
            .catch(() => null);
        sourcePromises.set(sourceId, promise);
        return promise;
    }

    function detailKey(item, fallbackType) {
        if (!item || !item.id) return '';
        const type = item.media_type || fallbackType || (item.first_air_date ? 'tv' : 'movie');
        return type + ':' + item.id;
    }

    function detailForCollectionItem(collectionData, item, fallbackType) {
        if (!item) return null;
        const details = collectionData && collectionData.__detailsById ? collectionData.__detailsById : {};
        return details[detailKey(item, fallbackType)] || details[String(item.id)] || item;
    }

    function startPosterAutoScroll(container) {
        if (!container || container.dataset.scrollStarted === 'true') return;
        container.dataset.scrollStarted = 'true';
        const scrollSpeed = 0.5;
        function step() {
            if (container.scrollWidth > container.clientWidth) {
                if (container.scrollLeft >= container.scrollWidth - container.clientWidth) {
                    container.scrollLeft = 0;
                } else {
                    container.scrollLeft += scrollSpeed;
                }
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function getLinkedTargets(group, sourceElement) {
        if (!group) return [];
        return Array.from(document.querySelectorAll('[data-link-group]')).filter(target => {
            if (target === sourceElement || target.dataset.linkGroup !== group) return false;
            return target.dataset.type !== 'tmdb-backdrop-slideshow' && target.dataset.type !== 'tmdb-poster-scroll';
        });
    }

    function updateLinkedGroup(group, item, sourceElement) {
        if (!group || !item) return;
        getLinkedTargets(group, sourceElement).forEach(target => renderElement(target, item));
    }

    function withSceneFade(elements, updateFn) {
        const targets = elements.filter(Boolean);
        if (targets.length === 0) {
            updateFn();
            return;
        }
        targets.forEach(target => target.classList.add('scene-fade-active'));
        setTimeout(() => {
            updateFn();
            requestAnimationFrame(() => targets.forEach(target => target.classList.remove('scene-fade-active')));
        }, 650);
    }

    function renderGenres(el, item) {
        clearElement(el);
        if (!Array.isArray(item.genres)) return;
        item.genres.forEach(genre => {
            const pill = document.createElement('span');
            pill.className = 'genre-pill';
            pill.textContent = genre.name || '';
            el.appendChild(pill);
        });
    }

    function renderRating(el, item) {
        clearElement(el);
        const rating = Math.max(0, Math.min(5, Math.round((Number(item.vote_average) || 0) / 2)));
        for (let i = 0; i < 5; i++) {
            const star = document.createElement('span');
            star.className = i < rating ? 'star-filled' : 'star-empty';
            star.textContent = '★';
            el.appendChild(star);
        }
    }

    function renderCast(el, item) {
        clearElement(el);
        el.style.display = 'flex';
        el.style.gap = '10px';
        el.style.overflowX = 'auto';
        el.style.textAlign = 'center';
        const cast = item && item.credits && Array.isArray(item.credits.cast) ? item.credits.cast : [];
        cast.slice(0, 15).forEach(person => {
            if (!person.profile_path) return;
            const member = document.createElement('div');
            member.className = 'cast-member';
            const img = document.createElement('img');
            img.src = baseImgUrl + person.profile_path;
            img.alt = person.name || '';
            const label = document.createElement('p');
            label.textContent = person.name || '';
            member.appendChild(img);
            member.appendChild(label);
            el.appendChild(member);
        });
    }

    function renderPosterScroll(el, data) {
        const container = el.querySelector('.poster-scroll-container');
        if (!container) return;
        clearElement(container);
        const limit = Math.max(1, Math.min(40, Number(el.dataset.collectionLimit) || 20));
        const results = Array.isArray(data && data.results) ? data.results.filter(item => item.poster_path).slice(0, limit) : [];
        results.forEach(item => {
            const img = document.createElement('img');
            img.src = baseImgUrl + item.poster_path;
            img.className = 'scroll-img';
            img.alt = item.title || item.name || 'Poster';
            container.appendChild(img);
        });
        if (results[0]) {
            const fallbackType = data.__collectionType || el.dataset.itemType || 'movie';
            updateLinkedGroup(el.dataset.linkGroup, detailForCollectionItem(data, results[0], fallbackType), el);
        }
        startPosterAutoScroll(container);
    }

    function renderBackdropSlideshow(el, data) {
        const limit = Math.max(1, Math.min(40, Number(el.dataset.collectionLimit) || 20));
        const results = Array.isArray(data && data.results) ? data.results.filter(item => item.backdrop_path).slice(0, limit) : [];
        if (results.length === 0) return;
        const fallbackType = data.__collectionType || el.dataset.itemType || 'movie';
        const globalSceneFade = el.dataset.globalSceneFade === 'true';
        let currentIdx = 0;

        function applySlide(index, useSceneFade) {
            const item = results[index];
            const detail = detailForCollectionItem(data, item, fallbackType);
            const apply = () => {
                el.style.backgroundImage = 'url(' + baseBackdropUrl + item.backdrop_path + ')';
                el.style.backgroundSize = 'cover';
                el.style.backgroundPosition = 'center';
                el.style.transition = globalSceneFade ? 'opacity 0.6s ease' : 'background-image 1s ease-in-out';
                updateLinkedGroup(el.dataset.linkGroup, detail, el);
            };

            if (useSceneFade && globalSceneFade) {
                withSceneFade([el].concat(getLinkedTargets(el.dataset.linkGroup, el)), apply);
            } else {
                apply();
            }
        }

        applySlide(0, false);
        if (results.length > 1 && el.dataset.slideshowStarted !== 'true') {
            el.dataset.slideshowStarted = 'true';
            setInterval(() => {
                currentIdx = (currentIdx + 1) % results.length;
                applySlide(currentIdx, true);
            }, 5000);
        }
    }

    function renderElement(el, data) {
        if (!el || !data) return;
        const type = el.dataset.type;
        const imageFit = el.dataset.imageFit || 'cover';
        const collectionResults = Array.isArray(data.results) ? data.results : null;
        const item = collectionResults ? detailForCollectionItem(data, collectionResults[0], data.__collectionType || el.dataset.itemType) : data;

        if (type === 'tmdb-poster-scroll') return renderPosterScroll(el, data);
        if (type === 'tmdb-backdrop-slideshow') return renderBackdropSlideshow(el, data);
        if (!item) return;

        switch (type) {
            case 'tmdb-dynamic-field': {
                const value = resolveDataPath(item, el.dataset.dataPath || '');
                setText(el, (el.dataset.dataPrefix || '') + (value === undefined || value === null ? '' : String(value)) + (el.dataset.dataSuffix || ''));
                break;
            }
            case 'tmdb-poster':
                appendImage(el, item.poster_path ? baseImgUrl + item.poster_path : '', 'Poster', imageFit);
                break;
            case 'tmdb-backdrop':
                appendImage(el, item.backdrop_path ? baseBackdropUrl + item.backdrop_path : '', 'Backdrop', imageFit);
                break;
            case 'tmdb-logo':
                appendImage(el, getBestLogo(item.images && item.images.logos, document.documentElement.lang || 'en'), 'Logo', imageFit);
                break;
            case 'tmdb-network-logo':
                appendImage(el, item.networks && item.networks[0] && item.networks[0].logo_path ? baseImgUrl + item.networks[0].logo_path : '', 'Network', imageFit);
                break;
            case 'tmdb-title':
                setText(el, item.title || item.name || '');
                break;
            case 'tmdb-overview':
                setText(el, item.overview || '');
                break;
            case 'tmdb-tagline':
                setText(el, item.tagline || '');
                break;
            case 'tmdb-release-date':
                setText(el, item.release_date || item.first_air_date || '');
                break;
            case 'tmdb-runtime': {
                const runtime = item.runtime || (Array.isArray(item.episode_run_time) && item.episode_run_time[0]);
                setText(el, runtime ? runtime + ' min' : '');
                break;
            }
            case 'tmdb-season-episode-count':
                setText(el, item.number_of_seasons ? item.number_of_seasons + ' S | ' + item.number_of_episodes + ' E' : '');
                break;
            case 'tmdb-rating':
                renderRating(el, item);
                break;
            case 'tmdb-genres':
                renderGenres(el, item);
                break;
            case 'tmdb-cast':
                renderCast(el, item);
                break;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-type^="tmdb-"]').forEach(el => {
            const sourceId = el.dataset.sourceId;
            if (!sourceId) return;
            fetchSource(sourceId).then(data => {
                if (!data) return;
                renderElement(el, data);
                if (el.dataset.linkGroup && !Array.isArray(data.results)) {
                    updateLinkedGroup(el.dataset.linkGroup, data, el);
                }
            });
        });
    });
    `;
  }

  generatePHP(): string {
    if (!this.isApiConfigured()) return '<!-- Error: Configure TMDB API Key (v3) or Token (v4) to generate code -->';

    const { width, height } = this.canvasConfig();
    const visibleElements = this.elements().filter(el => el.visible);
    const { sources, elementSources } = this.buildExportSources(visibleElements);
    const serverConfig = {
        authMethod: this.authMethod(),
        apiKey: this.tmdbApiKey(),
        token: this.tmdbReadToken(),
        lang: this.language(),
        region: this.watchRegion(),
        adult: this.includeAdult()
    };
    const serverConfigJson = this.escapePhpSingleQuoted(JSON.stringify(serverConfig));
    const sourcesJson = this.escapePhpSingleQuoted(JSON.stringify(sources));
    const jsScript = this.buildGeneratedPhpClientScript();

    const cssRules = visibleElements
        .map(el => {
            const s = el.styles;
            const leftPct = (this.clampNumber(el.x, 0, -100000, 100000) / width) * 100;
            const topPct = (this.clampNumber(el.y, 0, -100000, 100000) / height) * 100;
            const widthPct = (this.clampNumber(el.width, 1, 1, 100000) / width) * 100;
            const heightPct = (this.clampNumber(el.height, 1, 1, 100000) / height) * 100;
            const fontSizeVw = (this.clampNumber(s.fontSize, 16, 1, 500) / width) * 100;
            const bgRgba = this.hexToRgba(this.safeCssColor(s.backgroundColor, '#000000'), this.clampNumber(s.backgroundOpacity ?? 1, 1, 0, 1));
            const textAlign = ['left', 'center', 'right'].includes(s.textAlign) ? s.textAlign : 'left';
            const fontWeight = ['400', '500', '600', '700'].includes(s.fontWeight) ? s.fontWeight : '400';

            const props = [
                `position: absolute`,
                `top: ${topPct.toFixed(2)}%`,
                `left: ${leftPct.toFixed(2)}%`,
                `width: ${widthPct.toFixed(2)}%`,
                `height: ${heightPct.toFixed(2)}%`,
                `z-index: ${Math.round(this.clampNumber(el.zIndex, 1, -9999, 9999))}`,
                `background-color: ${bgRgba}`,
                `color: ${this.safeCssColor(s.color, '#ffffff')}`,
                `font-family: '${this.safeFontFamily(s.fontFamily)}', sans-serif`,
                `font-size: ${fontSizeVw.toFixed(2)}vw`,
                `font-weight: ${fontWeight}`,
                `text-align: ${textAlign}`,
                `border-radius: ${this.clampNumber(s.borderRadius, 0, 0, 500)}px`,
                `border: ${this.clampNumber(s.borderWidth, 0, 0, 100)}px solid ${this.safeCssColor(s.borderColor, '#ffffff')}`,
                `opacity: ${this.clampNumber(s.opacity, 1, 0, 1)}`,
                `box-sizing: border-box`,
                `overflow: hidden`
            ];

            const rotation = this.clampNumber(el.rotation, 0, -3600, 3600);
            if (rotation) props.push(`transform: rotate(${rotation}deg)`);
            if (s.backgroundGradient) {
                props.push(`background-image: linear-gradient(${this.clampNumber(s.backgroundGradient.angle, 0, 0, 360)}deg, ${this.safeCssColor(s.backgroundGradient.from, '#000000')}, ${this.safeCssColor(s.backgroundGradient.to, '#000000')})`);
            }
            if (s.boxShadow) props.push(`box-shadow: ${this.clampNumber(s.boxShadow.x, 0, -500, 500)}px ${this.clampNumber(s.boxShadow.y, 0, -500, 500)}px ${this.clampNumber(s.boxShadow.blur, 0, 0, 500)}px ${this.safeCssColor(s.boxShadow.color, 'rgba(0,0,0,0.35)')}`);
            if (s.textShadow) props.push(`text-shadow: ${this.clampNumber(s.textShadow.x, 0, -500, 500)}px ${this.clampNumber(s.textShadow.y, 0, -500, 500)}px ${this.clampNumber(s.textShadow.blur, 0, 0, 500)}px ${this.safeCssColor(s.textShadow.color, 'rgba(0,0,0,0.35)')}`);

            const filters = [];
            const blur = this.clampNumber(s.filterBlur, 0, 0, 100);
            const grayscale = this.clampNumber(s.filterGrayscale, 0, 0, 1);
            if (blur > 0) filters.push(`blur(${blur}px)`);
            if (grayscale > 0) filters.push(`grayscale(${grayscale * 100}%)`);
            if (filters.length > 0) {
                props.push(`backdrop-filter: ${filters.join(' ')}`);
                props.push(`-webkit-backdrop-filter: ${filters.join(' ')}`);
            }

            return `    /* ${this.escapeHtml(this.formatTypeName(el.type))} */\n    #${this.safeElementId(el.id)} {\n        ${props.join(';\n        ')};\n    }`;
        }).join('\n\n');

    const htmlElements = visibleElements
        .map(el => {
            const sourceId = elementSources.get(el.id);
            const attrs = [
              `id="${this.escapeHtml(this.safeElementId(el.id))}"`,
              `data-type="${this.escapeHtml(el.type)}"`,
              `data-item-type="${this.escapeHtml(el.tmdbItemType)}"`,
              `data-image-fit="${this.escapeHtml(el.imageFit || 'cover')}"`
            ];
            if (sourceId) attrs.push(`data-source-id="${this.escapeHtml(sourceId)}"`);
            if (el.linkGroup) attrs.push(`data-link-group="${this.escapeHtml(el.linkGroup)}"`);
            if (this.isCollectionElement(el)) attrs.push(`data-collection-limit="${this.getEffectiveCollectionItemLimit(el, visibleElements)}"`);
            if (el.type === 'tmdb-backdrop-slideshow') attrs.push(`data-global-scene-fade="${this.getEffectiveGlobalSceneFade(el, visibleElements) ? 'true' : 'false'}"`);
            if (el.type === 'tmdb-dynamic-field') {
                attrs.push(`data-data-path="${this.escapeHtml(el.dataPath || '')}"`);
                attrs.push(`data-data-prefix="${this.escapeHtml(el.dataPrefix || '')}"`);
                attrs.push(`data-data-suffix="${this.escapeHtml(el.dataSuffix || '')}"`);
            }

            const imgStyle = `width:100%;height:100%;object-fit:${this.escapeHtml(el.imageFit || 'cover')};border-radius:${this.clampNumber(el.styles.borderRadius, 0, 0, 500)}px;`;
            let content = '';
            if (el.type === 'text') content = this.escapeHtml(el.content);
            else if (el.type === 'image') content = `<img src="${this.escapeHtml(el.content)}" style="${imgStyle}" alt="Image">`;
            else if (el.type === 'tmdb-poster-scroll') content = '<div class="poster-scroll-container" style="display:flex; gap:10px; overflow-x:hidden; height:100%;"></div>';

            return `        <!-- ${this.escapeHtml(this.formatTypeName(el.type))} -->\n        <div ${attrs.join(' ')}>\n            ${content}\n        </div>`;
        }).join('\n\n');

    return `<?php
/**
 * TMDB Dynamic Layout
 * Generated by TMDB Layout Editor
 * Date: ${new Date().toISOString().split('T')[0]}
 *
 * Runtime notes:
 * - TMDB credentials stay server-side in this PHP file.
 * - Browser requests call this file with ?tmdb_source=<id>.
 * - Responses are cached with file locks to avoid concurrent viewer stampedes.
 */

$config = json_decode('${serverConfigJson}', true);
$sources = json_decode('${sourcesJson}', true);

function tmdb_json_response($payload, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=60');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function tmdb_cache_dir() {
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tmdb_layout_cache_' . substr(hash('sha256', __FILE__), 0, 12);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return is_dir($dir) && is_writable($dir) ? $dir : null;
}

function tmdb_read_cache($file, $ttl, $allowStale = false) {
    if (!$file || !is_file($file)) return null;
    if (!$allowStale && (time() - filemtime($file)) > $ttl) return null;
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') return null;
    $json = json_decode($raw, true);
    return is_array($json) ? $json : null;
}

function tmdb_write_cache($file, $payload) {
    if (!$file) return false;
    $tmp = $file . '.' . getmypid() . '.tmp';
    $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (@file_put_contents($tmp, $encoded, LOCK_EX) === false) return false;
    return @rename($tmp, $file);
}

function tmdb_build_url($source, $config, $page = 1) {
    $params = array(
        'language' => $config['lang'] ?: 'en-US',
        'include_adult' => !empty($config['adult']) ? 'true' : 'false'
    );

    if (($source['kind'] ?? '') === 'detail') {
        $itemType = in_array($source['itemType'] ?? '', array('movie', 'tv', 'person'), true) ? $source['itemType'] : 'movie';
        $tmdbId = preg_replace('/[^0-9]/', '', (string)($source['tmdbId'] ?? ''));
        if ($tmdbId === '') return null;
        $params['append_to_response'] = 'credits,images,videos,content_ratings,release_dates,keywords,external_ids,recommendations,similar,reviews,lists,translations,watch/providers';
        return 'https://api.themoviedb.org/3/' . $itemType . '/' . $tmdbId . '?' . http_build_query($params);
    }

    $endpoint = (string)($source['endpoint'] ?? '');
    if (!preg_match('/^[a-z0-9_\\/-]+$/i', $endpoint)) return null;
    if (strpos($endpoint, 'discover/') === 0) {
        $filters = is_array($source['discoverFilters'] ?? null) ? $source['discoverFilters'] : array();
        $params['sort_by'] = $filters['sortBy'] ?? 'popularity.desc';
        if (!empty($filters['genres']) && is_array($filters['genres'])) {
            $params['with_genres'] = implode(',', array_map('intval', $filters['genres']));
        }
        if (!empty($filters['year'])) {
            $yearKey = ($source['collectionType'] ?? 'movie') === 'tv' ? 'first_air_date_year' : 'primary_release_year';
            $params[$yearKey] = (string)intval($filters['year']);
        }
    }
    $params['watch_region'] = $config['region'] ?: 'US';
    $params['page'] = max(1, intval($page));
    return 'https://api.themoviedb.org/3/' . $endpoint . '?' . http_build_query($params);
}

function tmdb_http_get_json($url, $config) {
    if (!$url) return null;
    if (($config['authMethod'] ?? 'v4') === 'v3') {
        $url .= (strpos($url, '?') === false ? '?' : '&') . 'api_key=' . rawurlencode((string)($config['apiKey'] ?? ''));
    }

    $headers = array('Accept: application/json');
    if (($config['authMethod'] ?? 'v4') !== 'v3') {
        $headers[] = 'Authorization: Bearer ' . (string)($config['token'] ?? '');
    }

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_HTTPHEADER => $headers
        ));
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body === false || $status < 200 || $status >= 300) return null;
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'GET',
                'timeout' => 12,
                'header' => implode("\\r\\n", $headers)
            )
        ));
        $body = @file_get_contents($url, false, $context);
        if ($body === false) return null;
    }

    $json = json_decode($body, true);
    return is_array($json) ? $json : null;
}

function tmdb_fetch_source($source, $config) {
    if (($source['kind'] ?? '') === 'collection') {
        $limit = max(1, min(40, intval($source['limit'] ?? 20)));
        $pageCount = max(1, intval(ceil($limit / 20)));
        $data = null;
        $combinedResults = array();

        for ($page = 1; $page <= $pageCount; $page++) {
            $pageData = tmdb_http_get_json(tmdb_build_url($source, $config, $page), $config);
            if (!$pageData) {
                if ($page === 1) return null;
                break;
            }
            if ($data === null) $data = $pageData;
            if (!empty($pageData['results']) && is_array($pageData['results'])) {
                $combinedResults = array_merge($combinedResults, $pageData['results']);
            }
        }

        if (!$data) return null;
        $data['results'] = array_slice($combinedResults, 0, $limit);
        $data['__collectionType'] = $source['collectionType'] ?? 'movie';
        if (!empty($source['enrichLinked']) && !empty($data['results']) && is_array($data['results'])) {
            $details = array();
            foreach (array_slice($data['results'], 0, $limit) as $item) {
                if (empty($item['id'])) continue;
                $type = $item['media_type'] ?? ($source['collectionType'] ?? 'movie');
                if (!in_array($type, array('movie', 'tv'), true)) continue;
                $detailSource = array('kind' => 'detail', 'itemType' => $type, 'tmdbId' => (string)$item['id']);
                $detail = tmdb_http_get_json(tmdb_build_url($detailSource, $config), $config);
                if ($detail) {
                    $details[$type . ':' . $item['id']] = $detail;
                    $details[(string)$item['id']] = $detail;
                }
            }
            $data['__detailsById'] = $details;
        }

        return $data;
    }

    $data = tmdb_http_get_json(tmdb_build_url($source, $config), $config);
    if (!$data) return null;
    return $data;
}

if (isset($_GET['tmdb_source'])) {
    $sourceId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$_GET['tmdb_source']);
    if (!$sourceId || !isset($sources[$sourceId])) {
        tmdb_json_response(array('error' => 'Unknown TMDB source'), 404);
    }

    $source = $sources[$sourceId];
    $ttl = intval($source['ttl'] ?? 900);
    $cacheDir = tmdb_cache_dir();
    $cacheFile = $cacheDir ? $cacheDir . DIRECTORY_SEPARATOR . hash('sha256', $sourceId . '|' . json_encode($source) . '|' . json_encode($config)) . '.json' : null;
    $fresh = tmdb_read_cache($cacheFile, $ttl);
    if ($fresh) {
        header('X-TMDB-Cache: HIT');
        tmdb_json_response($fresh);
    }

    $lockHandle = null;
    if ($cacheDir) {
        $lockHandle = @fopen($cacheFile . '.lock', 'c');
        if ($lockHandle) {
            flock($lockHandle, LOCK_EX);
            $fresh = tmdb_read_cache($cacheFile, $ttl);
            if ($fresh) {
                flock($lockHandle, LOCK_UN);
                fclose($lockHandle);
                header('X-TMDB-Cache: HIT-AFTER-LOCK');
                tmdb_json_response($fresh);
            }
        }
    }

    $payload = tmdb_fetch_source($source, $config);
    if ($payload) {
        tmdb_write_cache($cacheFile, $payload);
        if ($lockHandle) {
            flock($lockHandle, LOCK_UN);
            fclose($lockHandle);
        }
        header('X-TMDB-Cache: MISS');
        tmdb_json_response($payload);
    }

    $stale = tmdb_read_cache($cacheFile, $ttl, true);
    if ($lockHandle) {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
    if ($stale) {
        header('X-TMDB-Cache: STALE');
        tmdb_json_response($stale);
    }

    tmdb_json_response(array('error' => 'TMDB request failed'), 502);
}
?>
<!DOCTYPE html>
<html lang="${this.escapeHtml(this.language())}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>TMDB Dynamic Layout</title>

    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Montserrat:wght@400;500;600;700&family=Lato:wght@400;700&family=Oswald:wght@400;500;600;700&display=swap" rel="stylesheet">

    <style>
    /* --- Base Reset --- */
    body {
        margin: 0;
        background-color: #0d253f; /* TMDB Dark Blue */
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        font-family: 'Inter', sans-serif;
    }

    #canvas {
        position: relative;
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
    }

    /* --- Element Styles --- */
${cssRules}

    /* --- Utility Classes for Dynamic Content --- */
    .genre-pill {
        background: linear-gradient(90deg, #90cea1 0%, #01b4e4 100%);
        color: #0d253f;
        padding: 0.2em 0.6em;
        border-radius: 99px;
        margin-right: 0.3em;
        font-size: 0.9em;
        font-weight: 700;
        display: inline-block;
    }

    .star-filled { color: #01b4e4; }
    .star-empty { color: #1b3a57; }

    .scroll-img {
        height: 100%;
        width: auto;
        border-radius: 4px;
        flex-shrink: 0;
    }

    .cast-member {
        flex-shrink: 0;
        width: 18%;
    }
    .cast-member img {
        width: 100%;
        aspect-ratio: 1/1;
        object-fit: cover;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,0.1);
    }
    .cast-member p {
        font-size: 0.9em;
        margin: 4px 0 0 0;
        white-space: normal;
        line-height: 1.2;
        color: inherit;
    }

    [data-type^="tmdb-"] {
        transition: opacity 0.6s ease;
    }

    .scene-fade-active {
        opacity: 0 !important;
    }

    /* Hide scrollbars in scroll containers for clean look */
    .poster-scroll-container::-webkit-scrollbar {
        display: none;
    }
    .poster-scroll-container {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
    </style>
</head>
<body>

    <div id="canvas">
${htmlElements}
    </div>

    <script>
${jsScript}
    </script>

</body>
</html>`;
  }

  async copyGeneratedPhpCode() {
    const code = this.generatedPhpCode();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 1600);
    } catch {
      this.copySuccess.set(false);
    }
  }

  downloadPhpFile() {
    const blob = new Blob([this.generatedPhpCode()], { type: 'application/x-php' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'layout.php';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }
}
