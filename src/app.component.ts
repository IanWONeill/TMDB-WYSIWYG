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
type GlobalDiscoverFilters = Record<'movie' | 'tv', DiscoverFilters>;
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
type ElementSizeProperty = 'width' | 'height';
type FontSizeUnit = 'px' | 'pt' | 'em' | 'rem';
type LayoutGroupRole = 'background' | 'member';
type ContentAlignX = 'left' | 'center' | 'right';
type ContentAlignY = 'top' | 'center' | 'bottom';
type StrokePosition = 'inside' | 'outside';
type RelativeSide = 'right' | 'left' | 'top' | 'bottom' | 'center';
type TransitionEffect = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom' | 'blur' | 'flip' | 'bounce';
type SlideshowState = {idx1: number, idx2: number, fade: boolean, resetting?: boolean, sceneFade: boolean, backdrops: string[], items: any[]};
type DynamicBackdropTransitionState = { currentUrl: string; underlayUrl: string; fade: boolean; resetting?: boolean; version: number };
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
    fontSizeUnit?: FontSizeUnit;
    fontStyle?: 'normal' | 'italic';
    fontWeight: '400' | '500' | '600' | '700'; textAlign: 'left' | 'center' | 'right';
    textDecoration?: 'none' | 'underline';
    lineHeight?: number;
    lineHeightUnit?: FontSizeUnit;
    textStrokeWidth?: number;
    textStrokeUnit?: FontSizeUnit;
    textStrokeColor?: string;
    contentAlignX?: ContentAlignX;
    contentAlignY?: ContentAlignY;
    contentStrokeEnabled?: boolean;
    contentStrokeWidth?: number;
    contentStrokeUnit?: FontSizeUnit;
    contentStrokeColor?: string;
    contentStrokePosition?: StrokePosition;
    contentShadow?: Shadow;
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
  syncedToElementId?: string;
  imageFit: ImageFit;
  collectionItemLimit?: number;
  globalSceneFade?: boolean;
  slideshowDurationMs?: number;
  snapToGrid?: boolean;
  snapIncrement?: number;
  maintainAspectRatio?: boolean;
  layoutGroupId?: string;
  layoutGroupRole?: LayoutGroupRole;
  groupLocked?: boolean;
  groupPadding?: number;
  groupTransitionEnabled?: boolean;
  relativeToElementId?: string;
  relativeSide?: RelativeSide;
  relativeGap?: number;
  relativeMatchSize?: boolean;
  transitionEffect?: TransitionEffect;
  transitionDurationMs?: number;
  transitionDelayMs?: number;
  castBubbleSize?: number;
  castCount?: number;

  // For Dynamic Data Fields
  dataPath?: string;
  dataPrefix?: string;
  dataSuffix?: string;
}

interface HistoryState {
  elements: CanvasElement[];
  selectedElementId: string | null;
  selectedElementIds?: string[];
  multiSelectMode?: boolean;
  globalCollectionType?: TmdbCollectionType;
  globalCollectionEndpoints?: Record<TmdbCollectionType, string>;
  globalCollectionItemLimit?: number;
  globalSlideshowDurationMs?: number;
  globalDiscoverFilters?: GlobalDiscoverFilters;
}
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
  private slideshowTransitionTimeouts: Map<string, any> = new Map();
  private slideshowImagePreloads: Map<string, Promise<void>> = new Map();
  private slideshowRunTokens: Map<string, number> = new Map();
  private slideshowNextSchedulers: Map<string, () => void> = new Map();
  private transitionPreviewTimeouts: Map<string, any> = new Map();
  private dynamicBackdropTransitionTimeouts: Map<string, any> = new Map();
  private posterScrollIntervals: Map<string, any> = new Map();
  private globalSlideshowInterval: any = null;
  private globalSlideshowIndex = 0;
  private globalSlideshowFetchSequence = 0;
  private globalSlideshowRunToken = 0;
  private globalSlideshowApplySequence = 0;
  private searchTerms = new Subject<string>();
  private authCheckSubject = new Subject<void>();
  private destroy$ = new Subject<void>();
  private tmdbFetchSequence = 0;
  private tmdbFetchTokens: Map<string, number> = new Map();
  private lastMiddleClickAt = 0;
  private readonly projectStorageKey = 'tmdbLayoutProject';
  private readonly maxHistoryStates = 50;
  private readonly defaultCollectionItemLimit = 20;
  private readonly maxCollectionItemLimit = 40;
  private readonly defaultCastCount = 8;
  private readonly maxCastCount = 30;
  private readonly defaultSlideshowDurationMs = 5000;
  private readonly minSlideshowDurationMs = 1000;
  private readonly maxSlideshowDurationMs = 60000;
  private readonly defaultCollectionLinkGroup = 'global_collection';
  private readonly defaultSnapIncrement = 20;
  private readonly posterAspectRatio = 2 / 3;
  private readonly sceneFadeDurationMs = 650;
  private readonly minZoom = 0.1;
  private readonly maxZoom = 2;
  private readonly middleClickResetWindowMs = 350;
  private restoredProjectFromStorage = false;

  readonly Math = Math;
  readonly collectionItemLimitOptions = [5, 10, 15, 20, 30, 40];
  readonly snapIncrementOptions = [5, 10, 20, 25, 50, 100];
  readonly slideshowDurationOptions = [3, 5, 8, 10, 15, 30];
  readonly collectionSourceTypeOptions: Array<{ value: TmdbCollectionType; label: string }> = [
    { value: 'movie', label: 'Movies' },
    { value: 'tv', label: 'TV Shows' },
    { value: 'mixed', label: 'Movies + TV' }
  ];
  readonly fontSizeUnits: FontSizeUnit[] = ['px', 'pt', 'em', 'rem'];
  readonly relativeSideOptions: Array<{ value: RelativeSide; label: string }> = [
    { value: 'right', label: 'Right of' },
    { value: 'left', label: 'Left of' },
    { value: 'top', label: 'Above' },
    { value: 'bottom', label: 'Below' },
    { value: 'center', label: 'Centered on' }
  ];
  readonly contentAlignXOptions: Array<{ value: ContentAlignX; label: string; icon: string }> = [
    { value: 'left', label: 'Left', icon: 'fa-align-left' },
    { value: 'center', label: 'Center', icon: 'fa-align-center' },
    { value: 'right', label: 'Right', icon: 'fa-align-right' }
  ];
  readonly contentAlignYOptions: Array<{ value: ContentAlignY; label: string; icon: string }> = [
    { value: 'top', label: 'Top', icon: 'fa-arrow-up' },
    { value: 'center', label: 'Middle', icon: 'fa-arrows-up-down' },
    { value: 'bottom', label: 'Bottom', icon: 'fa-arrow-down' }
  ];
  readonly transitionEffectOptions: Array<{ value: TransitionEffect; label: string }> = [
    { value: 'none', label: 'None' },
    { value: 'fade', label: 'Fade' },
    { value: 'slide-left', label: 'Slide Left' },
    { value: 'slide-right', label: 'Slide Right' },
    { value: 'slide-up', label: 'Slide Up' },
    { value: 'slide-down', label: 'Slide Down' },
    { value: 'zoom', label: 'Zoom' },
    { value: 'blur', label: 'Blur Fade' },
    { value: 'flip', label: 'Flip' },
    { value: 'bounce', label: 'Bounce' }
  ];
  readonly transitionDurationOptions = [150, 250, 350, 500, 750, 1000, 1500, 2000, 3000, 5000];
  readonly transitionDelayOptions = [0, 100, 250, 500, 1000, 2000];
  readonly castBubbleSizeOptions = [32, 40, 48, 56, 64, 80, 96, 120];
  readonly castCountOptions = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30];

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
  private readonly defaultCollectionEndpoints: Record<TmdbCollectionType, string> = {
    movie: 'movie/popular',
    tv: 'tv/popular',
    mixed: 'trending/all/day'
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
  selectedElementIds = signal<string[]>([]);
  multiSelectMode = signal(false);

  // Auth Settings
  authMethod = signal<'v3' | 'v4'>(localStorage.getItem('tmdbAuthMethod') === 'v3' ? 'v3' : 'v4');
  tmdbReadToken = signal<string>(localStorage.getItem('tmdbReadToken') || '');
  tmdbApiKey = signal<string>(localStorage.getItem('tmdbApiKey') || '');
  tmdbUser = signal<TmdbUser | null>(null);
  isAuthValid = signal<boolean>(false);

  // Other Settings
  watchRegion = signal<string>(localStorage.getItem('tmdbWatchRegion') || 'US');
  language = signal<string>(localStorage.getItem('tmdbLanguage') || 'en-US');
  includeAdult = signal<boolean>(localStorage.getItem('tmdbIncludeAdult') === 'true');
  globalCollectionType = signal<TmdbCollectionType>(this.readStoredCollectionType());
  globalCollectionEndpoints = signal<Record<TmdbCollectionType, string>>(this.readStoredCollectionEndpoints());
  globalCollectionItemLimit = signal<number>(this.normalizeCollectionItemLimit(localStorage.getItem('tmdbGlobalCollectionItemLimit')));
  globalSlideshowDurationMs = signal<number>(this.normalizeSlideshowDurationMs(localStorage.getItem('tmdbGlobalSlideshowDurationMs')));
  globalDiscoverFilters = signal<GlobalDiscoverFilters>(this.readStoredGlobalDiscoverFilters());

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
  globalSlideshowData = signal<any | null>(null);
  transitionVersions = signal<{[id: string]: number}>({});
  dynamicBackdropTransitions = signal<{[id: string]: DynamicBackdropTransitionState}>({});
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
  selectedElements = computed(() => {
    const ids = new Set(this.selectedElementIds());
    return this.elements().filter(el => ids.has(el.id));
  });
  hasMultiSelection = computed(() => this.multiSelectMode() && this.selectedElementIds().length > 1);
  generatedPhpCode = signal('');
  copySuccess = signal(false);

  private tmdbDataFetchKey = computed(() => {
    const elements = this.elements();
    return JSON.stringify(
      elements
      .filter(el => el.type.startsWith('tmdb-'))
      .filter(el => !this.isGlobalSlideshowTarget(el, elements))
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

  private globalSlideshowFetchKey = computed(() => {
    const elements = this.elements();
    const targets = elements
      .filter(el => this.isGlobalSlideshowTarget(el, elements))
      .map(el => ({ id: el.id, type: el.type, linkGroup: el.linkGroup || '' }));

    if (targets.length === 0) return '';

    const collectionType = this.globalCollectionType();
    return JSON.stringify({
      targets,
      collectionType,
      endpoint: this.getGlobalCollectionEndpointForType(collectionType),
      movieEndpoint: this.getGlobalCollectionEndpointForType('movie'),
      tvEndpoint: this.getGlobalCollectionEndpointForType('tv'),
      itemLimit: this.globalCollectionItemLimit(),
      discoverFilters: this.globalDiscoverFilters()
    });
  });

  availableCollectionEndpoints = computed(() => {
    const el = this.selectedElement();
    if (!el || !el.tmdbCollectionType) return [];
    return this.tmdbEndpoints[el.tmdbCollectionType] || [];
  });

  availableGlobalCollectionEndpoints = computed(() => this.tmdbEndpoints[this.globalCollectionType()] || []);
  globalCollectionEndpointValue = computed(() => this.getGlobalCollectionEndpointForType(this.globalCollectionType()));
  globalMovieCollectionEndpointValue = computed(() => this.getGlobalCollectionEndpointForType('movie'));
  globalTvCollectionEndpointValue = computed(() => this.getGlobalCollectionEndpointForType('tv'));

  availableGlobalSortOptions = computed(() => {
    const type = this.globalCollectionType();
    if (type === 'mixed' || this.globalCollectionEndpointValue() !== `discover/${type}`) return [];
    return this.discoverSortOptions[type] || [];
  });

  availableGlobalGenres = computed(() => {
    const type = this.globalCollectionType();
    if (type === 'mixed' || this.globalCollectionEndpointValue() !== `discover/${type}`) return [];
    return this.tmdbGenres()[type] || [];
  });

  getActiveGlobalDiscoverFilters(): DiscoverFilters {
    const type = this.globalCollectionType();
    return type === 'tv'
      ? this.normalizeDiscoverFilters(this.globalDiscoverFilters().tv)
      : this.normalizeDiscoverFilters(this.globalDiscoverFilters().movie);
  }

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
    if (!element.syncedToElementId) return '';
    return this.elements().some(option => option.id === element.syncedToElementId && option.type.startsWith('tmdb-'))
      ? element.syncedToElementId
      : '';
  }

  isDynamicElement(elementId: string | null): boolean {
    if (!elementId) return false;
    return this.elements().some(el => el.id === elementId && el.type.startsWith('tmdb-'));
  }

  isSnapEnabled(elementId: string | null): boolean {
    if (!elementId) return false;
    return !!this.elements().find(el => el.id === elementId)?.snapToGrid;
  }

  isElementSelected(elementId: string): boolean {
    return this.selectedElementIds().includes(elementId);
  }

  isElementInMultiSelection(elementId: string | null): boolean {
    return !!elementId && this.selectedElementIds().includes(elementId);
  }

  canGroupSelection(): boolean {
    return this.multiSelectMode() && this.selectedElementIds().length >= 2;
  }

  private normalizeFontSizeUnit(value: any): FontSizeUnit {
    return this.fontSizeUnits.includes(value) ? value : 'px';
  }

  private normalizeLineHeightUnit(value: any): FontSizeUnit {
    return this.fontSizeUnits.includes(value) ? value : 'em';
  }

  private normalizeContentAlignX(value: any): ContentAlignX {
    return this.contentAlignXOptions.some(option => option.value === value) ? value : 'center';
  }

  private normalizeContentAlignY(value: any): ContentAlignY {
    return this.contentAlignYOptions.some(option => option.value === value) ? value : 'center';
  }

  private normalizeStrokePosition(value: any): StrokePosition {
    return value === 'inside' ? 'inside' : 'outside';
  }

  private normalizeCollectionType(value: any): TmdbCollectionType {
    return value === 'tv' || value === 'mixed' ? value : 'movie';
  }

  private defaultDiscoverFilters(): DiscoverFilters {
    return { sortBy: 'popularity.desc', genres: [], year: null };
  }

  private normalizeDiscoverFilters(filters: any): DiscoverFilters {
    return {
      sortBy: typeof filters?.sortBy === 'string' ? filters.sortBy : 'popularity.desc',
      genres: Array.isArray(filters?.genres) ? filters.genres.map(Number).filter(Number.isFinite) : [],
      year: filters?.year ? Number(filters.year) : null
    };
  }

  private readStoredCollectionType(): TmdbCollectionType {
    return this.normalizeCollectionType(localStorage.getItem('tmdbGlobalCollectionType'));
  }

  private readStoredCollectionEndpoints(): Record<TmdbCollectionType, string> {
    try {
      const stored = JSON.parse(localStorage.getItem('tmdbGlobalCollectionEndpoints') || '{}');
      return {
        movie: this.normalizeCollectionEndpoint('movie', stored.movie),
        tv: this.normalizeCollectionEndpoint('tv', stored.tv),
        mixed: this.normalizeCollectionEndpoint('mixed', stored.mixed)
      };
    } catch {
      return { ...this.defaultCollectionEndpoints };
    }
  }

  private readStoredGlobalDiscoverFilters(): GlobalDiscoverFilters {
    try {
      const stored = JSON.parse(localStorage.getItem('tmdbGlobalDiscoverFilters') || '{}');
      return {
        movie: this.normalizeDiscoverFilters(stored.movie),
        tv: this.normalizeDiscoverFilters(stored.tv)
      };
    } catch {
      return {
        movie: this.defaultDiscoverFilters(),
        tv: this.defaultDiscoverFilters()
      };
    }
  }

  private normalizeCollectionEndpoint(type: TmdbCollectionType, endpoint: any): string {
    const value = typeof endpoint === 'string' ? endpoint : '';
    const options = this.tmdbEndpoints[type] || [];
    return options.some(option => option.key === value) ? value : this.defaultCollectionEndpoints[type];
  }

  private getGlobalCollectionEndpointForType(type: TmdbCollectionType): string {
    return this.normalizeCollectionEndpoint(type, this.globalCollectionEndpoints()[type]);
  }

  private getDefaultContentAlignXForType(type: ElementType | string, textAlign: any = 'left'): ContentAlignX {
    const textFlowTypes = new Set([
      'text',
      'tmdb-dynamic-field',
      'tmdb-title',
      'tmdb-overview',
      'tmdb-tagline',
      'tmdb-release-date',
      'tmdb-runtime'
    ]);
    return textFlowTypes.has(type) ? this.normalizeContentAlignX(textAlign) : 'center';
  }

  private getDefaultContentAlignYForType(type: ElementType | string): ContentAlignY {
    const topFlowTypes = new Set([
      'text',
      'tmdb-title',
      'tmdb-overview',
      'tmdb-tagline',
      'tmdb-release-date',
      'tmdb-runtime',
      'tmdb-cast'
    ]);
    if (type === 'tmdb-dynamic-field') return 'center';
    return topFlowTypes.has(type) ? 'top' : 'center';
  }

  private normalizeRelativeSide(value: any): RelativeSide {
    return this.relativeSideOptions.some(option => option.value === value) ? value : 'right';
  }

  private normalizeRelativeGap(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 12;
    return Math.max(0, Math.min(1000, Math.round(parsed)));
  }

  private normalizeTransitionEffect(value: any): TransitionEffect {
    return this.transitionEffectOptions.some(option => option.value === value) ? value : 'none';
  }

  private normalizeTransitionDurationMs(value: any, fallback = 500): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(10000, Math.round(parsed)));
  }

  private normalizeCssLength(value: any, fallback: number, min = 0, max = 1000): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  private normalizeCastBubbleSize(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 48;
    return Math.max(20, Math.min(200, Math.round(parsed)));
  }

  private normalizeCastCount(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return this.defaultCastCount;
    return Math.max(1, Math.min(this.maxCastCount, Math.round(parsed)));
  }

  private formatShadow(shadow?: Shadow): string | null {
    if (!shadow) return null;
    const x = this.normalizeCssLength(shadow.x, 0, -500, 500);
    const y = this.normalizeCssLength(shadow.y, 0, -500, 500);
    const blur = this.normalizeCssLength(shadow.blur, 0, 0, 500);
    return `${x}px ${y}px ${blur}px ${shadow.color || '#000000'}`;
  }

  private getContentStrokeSource(element: CanvasElement) {
    const width = element.styles.contentStrokeWidth ?? element.styles.textStrokeWidth ?? 0;
    const unit = element.styles.contentStrokeUnit ?? element.styles.textStrokeUnit ?? 'px';
    const color = element.styles.contentStrokeColor ?? element.styles.textStrokeColor ?? '#000000';
    const normalizedWidth = this.normalizeCssLength(width, 0, 0, 100);
    const enabled = element.styles.contentStrokeEnabled ?? (normalizedWidth > 0);
    return {
      enabled,
      width: enabled ? normalizedWidth : 0,
      unit: this.normalizeFontSizeUnit(unit),
      color,
      position: this.normalizeStrokePosition(element.styles.contentStrokePosition)
    };
  }

  formatElementFontSize(element: CanvasElement): string {
    const value = Number(element.styles.fontSize);
    const size = Number.isFinite(value) ? Math.max(0.1, value) : 16;
    return `${size}${this.normalizeFontSizeUnit(element.styles.fontSizeUnit)}`;
  }

  formatElementLineHeight(element: CanvasElement): string {
    const unit = this.normalizeLineHeightUnit(element.styles.lineHeightUnit);
    const fallback = unit === 'em' || unit === 'rem' ? 1.2 : Number(element.styles.fontSize) * 1.2;
    const value = this.normalizeCssLength(element.styles.lineHeight, fallback, 0.1, 1000);
    return `${value}${unit}`;
  }

  getContentTextStrokeStyles(element: CanvasElement): Record<string, string> | null {
    const stroke = this.getContentStrokeSource(element);
    if (stroke.width <= 0) return null;
    const value = `${stroke.width}${stroke.unit} ${stroke.color}`;
    return {
      '-webkit-text-stroke': value,
      'text-stroke': value,
      'paint-order': stroke.position === 'outside' ? 'stroke fill' : 'fill stroke'
    };
  }

  formatContentMediaBorder(element: CanvasElement): string | null {
    const stroke = this.getContentStrokeSource(element);
    if (stroke.width <= 0 || stroke.position === 'outside') return null;
    return `${stroke.width}${stroke.unit} solid ${stroke.color}`;
  }

  private formatContentOutsideStrokeBoxShadow(element: CanvasElement): string | null {
    const stroke = this.getContentStrokeSource(element);
    if (stroke.width <= 0 || stroke.position !== 'outside') return null;
    return `0 0 0 ${stroke.width}${stroke.unit} ${stroke.color}`;
  }

  formatContentMediaBoxShadow(element: CanvasElement): string | null {
    if (this.shouldRenderOutsideStrokeOnElement(element)) return null;
    return this.formatContentOutsideStrokeBoxShadow(element);
  }

  private shouldRenderOutsideStrokeOnElement(element: CanvasElement): boolean {
    return ['image', 'tmdb-poster', 'tmdb-backdrop', 'tmdb-logo', 'tmdb-network-logo', 'tmdb-backdrop-slideshow'].includes(element.type);
  }

  formatElementBoxShadow(element: CanvasElement): string | null {
    return [
      this.formatShadow(element.styles.boxShadow),
      this.shouldRenderOutsideStrokeOnElement(element) ? this.formatContentOutsideStrokeBoxShadow(element) : null
    ].filter(Boolean).join(', ') || null;
  }

  isContentStrokeEnabled(element: CanvasElement): boolean {
    return this.getContentStrokeSource(element).enabled;
  }

  getContentStrokePosition(element: CanvasElement): StrokePosition {
    return this.getContentStrokeSource(element).position;
  }

  formatContentTextShadow(element: CanvasElement): string | null {
    return this.formatShadow(element.styles.contentShadow ?? element.styles.textShadow);
  }

  formatContentDropShadow(element: CanvasElement): string | null {
    const shadow = element.styles.contentShadow;
    if (!shadow) return null;
    const x = this.normalizeCssLength(shadow.x, 0, -500, 500);
    const y = this.normalizeCssLength(shadow.y, 0, -500, 500);
    const blur = this.normalizeCssLength(shadow.blur, 0, 0, 500);
    return `drop-shadow(${x}px ${y}px ${blur}px ${shadow.color || '#000000'})`;
  }

  formatContentBoxShadow(element: CanvasElement): string | null {
    return [
      this.formatContentOutsideStrokeBoxShadow(element),
      this.formatShadow(element.styles.contentShadow)
    ].filter(Boolean).join(', ') || null;
  }

  getContentTextAlign(element: CanvasElement): ContentAlignX {
    return this.normalizeContentAlignX(element.styles.contentAlignX ?? this.getDefaultContentAlignXForType(element.type, element.styles.textAlign));
  }

  getContentVerticalAlign(element: CanvasElement): ContentAlignY {
    return this.normalizeContentAlignY(element.styles.contentAlignY ?? this.getDefaultContentAlignYForType(element.type));
  }

  getContentJustifyContent(element: CanvasElement): string {
    const align = this.normalizeContentAlignX(element.styles.contentAlignX ?? this.getDefaultContentAlignXForType(element.type, element.styles.textAlign));
    if (align === 'left') return 'flex-start';
    if (align === 'right') return 'flex-end';
    return 'center';
  }

  getContentAlignItems(element: CanvasElement): string {
    const align = this.getContentVerticalAlign(element);
    if (align === 'top') return 'flex-start';
    if (align === 'bottom') return 'flex-end';
    return 'center';
  }

  getContentVerticalFlex(element: CanvasElement): string {
    return this.getContentAlignItems(element);
  }

  getContentObjectPosition(element: CanvasElement): string {
    const x = this.normalizeContentAlignX(element.styles.contentAlignX ?? this.getDefaultContentAlignXForType(element.type, element.styles.textAlign));
    const y = this.normalizeContentAlignY(element.styles.contentAlignY ?? this.getDefaultContentAlignYForType(element.type));
    const horizontal = x === 'left' ? 'left' : (x === 'right' ? 'right' : 'center');
    const vertical = y === 'top' ? 'top' : (y === 'bottom' ? 'bottom' : 'center');
    return `${horizontal} ${vertical}`;
  }

  getLogoFallbackTitle(element: CanvasElement): string {
    return element.tmdbData?.title || element.tmdbData?.name || (element.tmdbItemType === 'tv' ? 'TV Show Title' : 'Movie Title');
  }

  getVisibleCast(element: CanvasElement): any[] {
    const cast = element.tmdbData?.credits?.cast;
    return Array.isArray(cast)
      ? cast.filter((actor: any) => !!actor.profile_path).slice(0, this.getCastCount(element))
      : [];
  }

  getCastBubbleSize(element: CanvasElement): number {
    return this.normalizeCastBubbleSize(element.castBubbleSize);
  }

  getCastCount(element: CanvasElement): number {
    return this.normalizeCastCount(element.castCount);
  }

  getCastItemWidth(element: CanvasElement): number {
    return Math.max(44, this.getCastBubbleSize(element) + 18);
  }

  private getTransitionAnimationName(effect: TransitionEffect, alternate = false): string {
    const animationNames: Record<TransitionEffect, string> = {
      none: '',
      fade: 'tmdbFadeIn',
      'slide-left': 'tmdbSlideInLeft',
      'slide-right': 'tmdbSlideInRight',
      'slide-up': 'tmdbSlideInUp',
      'slide-down': 'tmdbSlideInDown',
      zoom: 'tmdbZoomIn',
      blur: 'tmdbBlurIn',
      flip: 'tmdbFlipIn',
      bounce: 'tmdbBounceIn'
    };
    const name = animationNames[effect];
    return name && alternate ? `${name}Alt` : name;
  }

  private getEffectiveTransitionSource(element: CanvasElement, elements = this.elements()): CanvasElement {
    const groupSource = this.getLayoutGroupTransitionSource(element, elements);
    if (groupSource?.groupTransitionEnabled && this.getLayoutGroupLockState(element, elements)) {
      return groupSource;
    }
    return element;
  }

  getEffectiveTransitionEffect(element: CanvasElement, elements = this.elements()): TransitionEffect {
    return this.normalizeTransitionEffect(this.getEffectiveTransitionSource(element, elements).transitionEffect);
  }

  getEffectiveTransitionDurationMs(element: CanvasElement, elements = this.elements()): number {
    return this.normalizeTransitionDurationMs(this.getEffectiveTransitionSource(element, elements).transitionDurationMs, 500);
  }

  getEffectiveTransitionDelayMs(element: CanvasElement, elements = this.elements()): number {
    return this.normalizeTransitionDurationMs(this.getEffectiveTransitionSource(element, elements).transitionDelayMs, 0);
  }

  private getTransitionAnimationCss(element: CanvasElement, elements = this.elements(), alternate = false): string | null {
    if (element.type === 'tmdb-backdrop-slideshow') return null;
    const effect = this.getEffectiveTransitionEffect(element, elements);
    if (effect === 'none') return null;
    return `${this.getTransitionAnimationName(effect, alternate)} ${this.getEffectiveTransitionDurationMs(element, elements)}ms cubic-bezier(0.22, 1, 0.36, 1) ${this.getEffectiveTransitionDelayMs(element, elements)}ms both`;
  }

  getElementAnimation(element: CanvasElement): string | null {
    const version = this.transitionVersions()[element.id] || 0;
    if (!this.previewMode() && version === 0) return null;
    return this.getTransitionAnimationCss(element, this.elements(), version % 2 === 1);
  }

  getBackdropSlideshowStateForElement(element: CanvasElement, elements = this.elements()): SlideshowState | null {
    const master = this.getBackdropSlideshowMasterForElement(element, elements);
    if (!master || master.id === element.id) return null;
    const state = this.slideshowState()[master.id];
    return state?.backdrops?.length ? state : null;
  }

  getDynamicBackdropTransitionState(element: CanvasElement): DynamicBackdropTransitionState | null {
    if (element.type !== 'tmdb-backdrop') return null;
    if (this.getBackdropSlideshowStateForElement(element)) return null;
    return this.dynamicBackdropTransitions()[element.id] || null;
  }

  getBackdropFrameBackgroundSize(element: CanvasElement): string {
    if (element.imageFit === 'contain') return 'contain';
    if (element.imageFit === 'fill') return '100% 100%';
    return 'cover';
  }

  getBackdropUrlBackgroundImage(url: string | undefined): string {
    return url ? `url(${url})` : 'none';
  }

  getSlideshowFrameBackgroundImage(state: SlideshowState, layer: 'current' | 'underlay'): string {
    const fallback = state.backdrops[state.idx1] || state.backdrops[0] || '';
    const index = layer === 'current' ? state.idx1 : (state.resetting ? state.idx1 : state.idx2);
    const url = state.backdrops[index] || fallback;
    return url ? `url(${url})` : 'none';
  }

  private getBackdropSlideshowMasterForElement(element: CanvasElement, elements = this.elements()): CanvasElement | null {
    if (element.type === 'tmdb-backdrop-slideshow') return element;
    if (element.type !== 'tmdb-backdrop') return null;
    const master = this.getCollectionMasterForElement(element, elements);
    return master?.type === 'tmdb-backdrop-slideshow' ? master : null;
  }

  private getBackdropSlideshowFrameConsumers(master: CanvasElement, elements = this.elements()): CanvasElement[] {
    return elements.filter(el => el.id === master.id || this.getBackdropSlideshowMasterForElement(el, elements)?.id === master.id);
  }

  private getBackdropSlideshowRuntimeTransitionMs(master: CanvasElement, elements = this.elements()): number {
    return this.getBackdropSlideshowFrameConsumers(master, elements).reduce((maxDuration, el) => {
      return this.isSlideshowTransitionEnabled(el, elements)
        ? Math.max(maxDuration, this.getEffectiveTransitionDelayMs(el, elements) + this.getEffectiveTransitionDurationMs(el, elements))
        : maxDuration;
    }, 0);
  }

  private shouldAnimateElementInEditor(element: CanvasElement): boolean {
    if (element.type === 'tmdb-backdrop-slideshow') return false;
    if (this.getBackdropSlideshowStateForElement(element)) return false;
    if (this.getDynamicBackdropTransitionState(element)) return false;
    if (this.getEffectiveTransitionEffect(element) === 'none') return false;
    const version = this.transitionVersions()[element.id] || 0;
    return this.previewMode() || version > 0;
  }

  getElementTransitionClassMap(element: CanvasElement): Record<string, boolean> {
    if (!this.shouldAnimateElementInEditor(element)) return {};
    const effect = this.getEffectiveTransitionEffect(element);
    const alternate = (this.transitionVersions()[element.id] || 0) % 2 === 1;
    return {
      'tmdb-transition-active': true,
      [`tmdb-transition-${effect}`]: !alternate,
      [`tmdb-transition-${effect}-alt`]: alternate
    };
  }

  getElementTransitionDurationStyle(element: CanvasElement): string {
    return this.shouldAnimateElementInEditor(element)
      ? `${this.getEffectiveTransitionDurationMs(element)}ms`
      : '';
  }

  getElementTransitionDelayStyle(element: CanvasElement): string {
    return this.shouldAnimateElementInEditor(element)
      ? `${this.getEffectiveTransitionDelayMs(element)}ms`
      : '';
  }

  getElementTransitionTimingFunction(element: CanvasElement): string {
    return this.shouldAnimateElementInEditor(element)
      ? 'cubic-bezier(0.22, 1, 0.36, 1)'
      : '';
  }

  getElementTransitionFillMode(element: CanvasElement): string {
    return this.shouldAnimateElementInEditor(element) ? 'both' : '';
  }

  private getExpandedTransitionTargetIds(elementIds: string[], elements = this.elements()): string[] {
    const idsToTrigger = new Set(elementIds);
    elementIds.forEach(id => {
      const element = elements.find(el => el.id === id);
      if (!element?.layoutGroupId) return;
      if (!this.getLayoutGroupLockState(element, elements)) return;
      const groupSource = this.getLayoutGroupTransitionSource(element, elements);
      if (!groupSource?.groupTransitionEnabled || this.normalizeTransitionEffect(groupSource.transitionEffect) === 'none') return;
      elements
        .filter(el => el.layoutGroupId === element.layoutGroupId)
        .forEach(el => idsToTrigger.add(el.id));
    });
    return Array.from(idsToTrigger);
  }

  private triggerElementTransitions(elementIds: string[]) {
    const allElements = this.elements();
    const ids = this.getExpandedTransitionTargetIds(elementIds, allElements);
    if (ids.length === 0) return;
    this.transitionVersions.update(versions => {
      const next = { ...versions };
      ids.forEach(id => next[id] = (next[id] || 0) + 1);
      return next;
    });
    this.scheduleElementTransitionPreviewCleanup(ids);
  }

  private clearElementTransitionPreviewTimeout(elementId: string) {
    const timeout = this.transitionPreviewTimeouts.get(elementId);
    if (!timeout) return;
    clearTimeout(timeout);
    this.transitionPreviewTimeouts.delete(elementId);
  }

  private clearElementTransitionPreviews(elementId?: string) {
    if (elementId) {
      this.clearElementTransitionPreviewTimeout(elementId);
      this.transitionVersions.update(versions => {
        if (!versions[elementId]) return versions;
        const { [elementId]: _removed, ...rest } = versions;
        return rest;
      });
      return;
    }

    this.transitionPreviewTimeouts.forEach(timeout => clearTimeout(timeout));
    this.transitionPreviewTimeouts.clear();
    this.transitionVersions.set({});
  }

  private scheduleElementTransitionPreviewCleanup(elementIds: string[]) {
    const elements = this.elements();
    elementIds.forEach(id => {
      const version = this.transitionVersions()[id] || 0;
      if (version === 0) return;

      this.clearElementTransitionPreviewTimeout(id);
      const element = elements.find(el => el.id === id);
      const transitionMs = element
        ? this.getEffectiveTransitionDelayMs(element, elements) + this.getEffectiveTransitionDurationMs(element, elements)
        : 500;

      const timeout = setTimeout(() => {
        this.transitionPreviewTimeouts.delete(id);
        this.transitionVersions.update(versions => {
          if (versions[id] !== version) return versions;
          const { [id]: _removed, ...rest } = versions;
          return rest;
        });
        this.cdr.detectChanges();
      }, Math.max(0, transitionMs) + 80);

      this.transitionPreviewTimeouts.set(id, timeout);
    });
  }

  private createSlideshowRunToken(elementId: string): number {
    const token = (this.slideshowRunTokens.get(elementId) || 0) + 1;
    this.slideshowRunTokens.set(elementId, token);
    return token;
  }

  private isCurrentSlideshowRun(elementId: string, runToken?: number): boolean {
    return runToken === undefined || this.slideshowRunTokens.get(elementId) === runToken;
  }

  private clearSlideshowTimeout(map: Map<string, any>, elementId: string) {
    const timeout = map.get(elementId);
    if (!timeout) return;
    clearTimeout(timeout);
    map.delete(elementId);
  }

  private scheduleSlideshowCompletion(elementId: string, delayMs: number, runToken: number | undefined, onComplete?: () => void) {
    this.clearSlideshowTimeout(this.slideshowTransitionTimeouts, elementId);
    const timeout = setTimeout(() => {
      this.slideshowTransitionTimeouts.delete(elementId);
      if (!this.isCurrentSlideshowRun(elementId, runToken)) return;
      this.completeSlideshowTransition(elementId, runToken);
      onComplete?.();
    }, Math.max(0, delayMs));
    this.slideshowTransitionTimeouts.set(elementId, timeout);
  }

  private completeSlideshowTransition(elementId: string, runToken?: number) {
    if (!this.isCurrentSlideshowRun(elementId, runToken)) return;
    let nextPreloadUrl: string | undefined;
    this.slideshowState.update(s => {
      const current = s[elementId];
      if (!current) return s;
      const nextNextIdx = (current.idx2 + 1) % current.backdrops.length;
      nextPreloadUrl = current.backdrops[nextNextIdx];
      return {
        ...s,
        [elementId]: {
          ...current,
          idx1: current.idx2,
          idx2: nextNextIdx,
          fade: false,
          resetting: true,
          sceneFade: false
        }
      };
    });
    void this.preloadSlideshowImage(nextPreloadUrl);
    this.cdr.detectChanges();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.isCurrentSlideshowRun(elementId, runToken)) return;
        this.slideshowState.update(s => {
          const current = s[elementId];
          return current ? { ...s, [elementId]: { ...current, resetting: false } } : s;
        });
        this.cdr.detectChanges();
      });
    });
  }

  private previewSlideshowTransition(elementId: string): boolean {
    const element = this.elements().find(e => e.id === elementId);
    const state = this.slideshowState()[elementId];
    if (!element || element.type !== 'tmdb-backdrop-slideshow' || !state || state.backdrops.length < 2) return false;
    if (state.fade || state.resetting || !this.isSlideshowTransitionEnabled(element)) return false;

    const runToken = this.slideshowRunTokens.get(elementId);
    const transitionMs = this.getBackdropSlideshowRuntimeTransitionMs(element);
    if (transitionMs <= 0) return false;
    void this.preloadSlideshowImage(state.backdrops[state.idx2]).then(() => {
      if (!this.isCurrentSlideshowRun(elementId, runToken)) return;
      const latestEl = this.elements().find(e => e.id === elementId);
      const latestState = this.slideshowState()[elementId];
      if (!latestEl || !latestState || latestState.fade || latestState.resetting || this.getBackdropSlideshowRuntimeTransitionMs(latestEl) <= 0) return;

      const nextItem = latestState.items[latestState.idx2];
      if (nextItem) this.propagateSourceItemToLinkedGroup(elementId, latestEl, nextItem, true);

      this.clearSlideshowTimeout(this.slideshowIntervals, elementId);
      this.slideshowState.update(s => {
        const current = s[elementId];
        return current ? { ...s, [elementId]: { ...current, fade: true, resetting: false, sceneFade: false } } : s;
      });
      this.cdr.detectChanges();

      this.scheduleSlideshowCompletion(elementId, transitionMs + 50, runToken, () => this.slideshowNextSchedulers.get(elementId)?.());
    });

    return true;
  }

  isSlideshowTransitionEnabled(element: CanvasElement, elements = this.elements()): boolean {
    const effect = this.getEffectiveTransitionEffect(element, elements);
    return effect !== 'none' && this.getEffectiveTransitionDurationMs(element, elements) > 0;
  }

  isSlideshowCrossfadeEnabled(element: CanvasElement, elements = this.elements()): boolean {
    return this.getEffectiveTransitionEffect(element, elements) === 'fade';
  }

  getSlideshowFrameTransition(element: CanvasElement): string {
    if (!this.isSlideshowTransitionEnabled(element)) return 'none';
    const duration = this.getEffectiveTransitionDurationMs(element);
    const delay = this.getEffectiveTransitionDelayMs(element);
    return [
      `opacity ${duration}ms ease-in-out ${delay}ms`,
      `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      `filter ${duration}ms ease-in-out ${delay}ms`
    ].join(', ');
  }

  getSlideshowCurrentFrameOpacity(element: CanvasElement, transitioning: boolean): number {
    if (!transitioning || !this.isSlideshowTransitionEnabled(element)) return 1;
    const effect = this.getEffectiveTransitionEffect(element);
    return ['slide-left', 'slide-right', 'slide-up', 'slide-down'].includes(effect) ? 1 : 0;
  }

  getSlideshowUnderlayFrameOpacity(element: CanvasElement, state: Pick<SlideshowState, 'fade' | 'resetting'>): number {
    if (state.resetting) return 1;
    if (!this.isSlideshowTransitionEnabled(element)) return 1;
    const effect = this.getEffectiveTransitionEffect(element);
    if (state.fade) return 1;
    return ['slide-left', 'slide-right', 'slide-up', 'slide-down'].includes(effect) ? 1 : 0;
  }

  getSlideshowCurrentFrameTransform(element: CanvasElement, transitioning: boolean): string {
    if (!transitioning || !this.isSlideshowTransitionEnabled(element)) return 'none';
    switch (this.getEffectiveTransitionEffect(element)) {
      case 'slide-left': return 'translateX(-100%)';
      case 'slide-right': return 'translateX(100%)';
      case 'slide-up': return 'translateY(-100%)';
      case 'slide-down': return 'translateY(100%)';
      case 'zoom': return 'scale(1.08)';
      case 'flip': return 'perspective(800px) rotateY(14deg)';
      case 'bounce': return 'scale(0.92)';
      default: return 'none';
    }
  }

  getSlideshowUnderlayFrameTransform(element: CanvasElement, state: Pick<SlideshowState, 'fade' | 'resetting'>): string {
    if (state.resetting || !this.isSlideshowTransitionEnabled(element)) return 'none';
    if (state.fade) return 'none';
    switch (this.getEffectiveTransitionEffect(element)) {
      case 'slide-left': return 'translateX(100%)';
      case 'slide-right': return 'translateX(-100%)';
      case 'slide-up': return 'translateY(100%)';
      case 'slide-down': return 'translateY(-100%)';
      case 'zoom': return 'scale(0.94)';
      case 'flip': return 'perspective(800px) rotateY(-14deg)';
      case 'bounce': return 'scale(1.04)';
      default: return 'none';
    }
  }

  getSlideshowCurrentFrameFilter(element: CanvasElement, transitioning: boolean): string {
    return transitioning && this.getEffectiveTransitionEffect(element) === 'blur' ? 'blur(12px)' : 'none';
  }

  getSlideshowUnderlayFrameFilter(element: CanvasElement, state: Pick<SlideshowState, 'fade' | 'resetting'>): string {
    return !state.resetting && !state.fade && this.getEffectiveTransitionEffect(element) === 'blur' ? 'blur(12px)' : 'none';
  }

  getTransitionTimingWarning(element: CanvasElement): string | null {
    if (this.getEffectiveTransitionEffect(element) === 'none') return null;
    const master = this.getSlideshowMasterForElement(element);
    if (!master) return null;

    const slideshowMs = this.getEffectiveSlideshowDurationMs(master);
    const transitionMs = this.getEffectiveTransitionDurationMs(element);
    const totalMs = transitionMs + this.getEffectiveTransitionDelayMs(element);
    if (transitionMs > slideshowMs) return 'Transition duration is longer than the slide duration.';
    if (totalMs > slideshowMs) return 'Delay plus duration exceeds the slide duration.';
    return null;
  }

  isGroupTransitionEnabled(element: CanvasElement): boolean {
    const groupSource = this.getLayoutGroupTransitionSource(element);
    return !!groupSource?.groupTransitionEnabled && this.getLayoutGroupLockState(element) && this.normalizeTransitionEffect(groupSource.transitionEffect) !== 'none';
  }

  isSyncedWithLayer(element: CanvasElement): boolean {
    return !!this.selectedSyncLayerId(element);
  }

  private getSnapIncrement(element: CanvasElement): number {
    const parsed = Number(element.snapIncrement);
    if (!Number.isFinite(parsed) || parsed <= 0) return this.defaultSnapIncrement;
    return Math.max(1, Math.round(parsed));
  }

  private snapValue(value: number, increment: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return value;
    return Math.round(value / increment) * increment;
  }

  private maybeSnapValue(element: CanvasElement, value: number): number {
    return element.snapToGrid ? this.snapValue(value, this.getSnapIncrement(element)) : value;
  }

  private normalizeSnapIncrement(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return this.defaultSnapIncrement;
    return Math.max(1, Math.min(500, Math.round(parsed)));
  }

  private getLayoutGroupElements(element: CanvasElement, elements = this.elements()): CanvasElement[] {
    if (!element.layoutGroupId) return [];
    return elements.filter(el => el.layoutGroupId === element.layoutGroupId);
  }

  getLayoutGroupBackground(element: CanvasElement, elements = this.elements()): CanvasElement | null {
    return this.getLayoutGroupElements(element, elements).find(el => el.layoutGroupRole === 'background') || null;
  }

  private getLayoutGroupController(element: CanvasElement, elements = this.elements()): CanvasElement | null {
    const groupElements = this.getLayoutGroupElements(element, elements);
    if (groupElements.length === 0) return null;
    return this.getLayoutGroupBackground(element, elements) || groupElements
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))[0];
  }

  private getLayoutGroupTransitionSource(element: CanvasElement, elements = this.elements()): CanvasElement | null {
    return this.getLayoutGroupController(element, elements);
  }

  hasLayoutGroupBackground(element: CanvasElement, elements = this.elements()): boolean {
    return !!this.getLayoutGroupBackground(element, elements);
  }

  isLayoutGroupBackground(element: CanvasElement): boolean {
    return element.layoutGroupRole === 'background';
  }

  getLayoutGroupLockState(element: CanvasElement, elements = this.elements()): boolean {
    const controller = this.getLayoutGroupController(element, elements);
    return !!controller?.groupLocked;
  }

  isResizeLockedByGroup(element: CanvasElement, elements = this.elements()): boolean {
    return element.layoutGroupRole === 'member' && this.getLayoutGroupLockState(element, elements);
  }

  canResizeElement(element: CanvasElement): boolean {
    return !this.isResizeLockedByGroup(element);
  }

  getLayoutGroupMemberCount(element: CanvasElement, elements = this.elements()): number {
    return this.getLayoutGroupElements(element, elements).filter(el => el.layoutGroupRole === 'member').length;
  }

  isGroupedElement(elementId: string | null): boolean {
    if (!elementId) return false;
    return !!this.elements().find(el => el.id === elementId)?.layoutGroupId;
  }

  isElementLayoutGroupLocked(elementId: string | null): boolean {
    if (!elementId) return false;
    const element = this.elements().find(el => el.id === elementId);
    return element ? this.getLayoutGroupLockState(element) : false;
  }

  private getHighlightedElementIds(elementId: string): string[] {
    const element = this.elements().find(el => el.id === elementId);
    if (!element) return [elementId];
    if (!this.getLayoutGroupLockState(element)) return [elementId];
    return this.getLayoutGroupElements(element).map(el => el.id);
  }

  getRelativeTargetOptions(element: CanvasElement): CanvasElement[] {
    return this.elements()
      .filter(option => option.id !== element.id)
      .filter(option => !this.wouldCreateRelativeCycle(element.id, option.id, this.elements()))
      .sort((a, b) => a.zIndex - b.zIndex);
  }

  private wouldCreateRelativeCycle(elementId: string, targetId: string, elements: CanvasElement[]): boolean {
    const byId = new Map(elements.map(el => [el.id, el]));
    const visited = new Set<string>();
    let currentId = targetId;

    while (currentId) {
      if (currentId === elementId) return true;
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      currentId = byId.get(currentId)?.relativeToElementId || '';
    }

    return false;
  }

  private applyRelativeLayoutToElements(elements: CanvasElement[]): CanvasElement[] {
    if (!elements.some(el => !!el.relativeToElementId)) return elements;

    let next = elements;
    for (let pass = 0; pass < Math.max(1, elements.length); pass++) {
      const byId = new Map(next.map(el => [el.id, el]));
      let changed = false;

      next = next.map(el => {
        if (!el.relativeToElementId) return el;
        const target = byId.get(el.relativeToElementId);
        if (!target || target.id === el.id || this.wouldCreateRelativeCycle(el.id, target.id, next)) return el;

        const side = this.normalizeRelativeSide(el.relativeSide);
        const gap = this.normalizeRelativeGap(el.relativeGap);
        let x = el.x;
        let y = el.y;
        let width = el.width;
        let height = el.height;

        if (side === 'center') {
          if (el.relativeMatchSize) {
            width = target.width;
            height = target.height;
          }
          x = target.x + ((target.width - width) / 2);
          y = target.y + ((target.height - height) / 2);
        } else if (side === 'right') {
          x = target.x + target.width + gap;
          y = target.y;
          if (el.relativeMatchSize) height = target.height;
        } else if (side === 'left') {
          x = target.x - el.width - gap;
          y = target.y;
          if (el.relativeMatchSize) height = target.height;
        } else if (side === 'top') {
          x = target.x;
          y = target.y - el.height - gap;
          if (el.relativeMatchSize) width = target.width;
        } else {
          x = target.x;
          y = target.y + target.height + gap;
          if (el.relativeMatchSize) width = target.width;
        }

        x = this.maybeSnapValue(el, x);
        y = this.maybeSnapValue(el, y);
        width = Math.max(1, width);
        height = Math.max(1, height);

        if (x === el.x && y === el.y && width === el.width && height === el.height) return el;
        changed = true;
        return { ...el, x, y, width, height };
      });

      if (!changed) break;
    }

    return next;
  }

  private syncRelativeLayout() {
    this.elements.update(els => this.applyRelativeLayoutToElements(els));
  }

  private isCollectionElementType(type: ElementType | string): boolean {
    return type === 'tmdb-backdrop-slideshow' || type === 'tmdb-poster-scroll';
  }

  isCollectionElement(element: CanvasElement): boolean {
    return this.isCollectionElementType(element.type);
  }

  private isGlobalSlideshowTarget(element: CanvasElement, elements = this.elements()): boolean {
    return element.type.startsWith('tmdb-') &&
      !this.isCollectionElement(element) &&
      element.linkGroup === this.defaultCollectionLinkGroup &&
      !this.getCollectionMasterForElement(element, elements);
  }

  private hasGlobalSlideshowTargets(elements = this.elements()): boolean {
    return elements.some(el => this.isGlobalSlideshowTarget(el, elements));
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

  private getEffectiveCollectionSourceElement(element: CanvasElement, elements = this.elements()): CanvasElement {
    if (!this.isCollectionElement(element)) return element;
    const explicitSource = element.syncedToElementId
      ? elements.find(el => el.id === element.syncedToElementId && this.isCollectionElement(el))
      : null;
    return explicitSource || this.getCollectionMasterForElement(element, elements) || element;
  }

  isCollectionMaster(element: CanvasElement): boolean {
    return this.getCollectionMasterForElement(element)?.id === element.id;
  }

  getEffectiveCollectionItemLimit(element: CanvasElement, elements = this.elements()): number {
    const master = this.getCollectionMasterForElement(element, elements);
    return this.normalizeCollectionItemLimit(master?.collectionItemLimit ?? element.collectionItemLimit);
  }

  getEffectiveGlobalSceneFade(element: CanvasElement, elements = this.elements()): boolean {
    return false;
  }

  private normalizeSlideshowDurationMs(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return this.defaultSlideshowDurationMs;
    return Math.max(this.minSlideshowDurationMs, Math.min(this.maxSlideshowDurationMs, Math.round(parsed)));
  }

  getSlideshowMasterForElement(element: CanvasElement, elements = this.elements()): CanvasElement | null {
    const explicitSource = element.syncedToElementId
      ? elements.find(el => el.id === element.syncedToElementId && el.type === 'tmdb-backdrop-slideshow')
      : null;
    if (explicitSource) return explicitSource;
    if (element.type === 'tmdb-backdrop-slideshow') return element;
    if (!element.linkGroup) return null;
    return elements
      .filter(el => el.linkGroup === element.linkGroup && el.type === 'tmdb-backdrop-slideshow')
      .sort((a, b) => a.zIndex - b.zIndex)[0] || null;
  }

  getEffectiveSlideshowDurationMs(element: CanvasElement, elements = this.elements()): number {
    const master = this.getSlideshowMasterForElement(element, elements);
    return this.normalizeSlideshowDurationMs(master?.slideshowDurationMs ?? element.slideshowDurationMs);
  }

  getEffectiveSlideshowDurationSeconds(element: CanvasElement, elements = this.elements()): number {
    return Math.round(this.getEffectiveSlideshowDurationMs(element, elements) / 1000);
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
    effect(() => {
        localStorage.setItem('tmdbAuthMethod', this.authMethod());
        this.tmdbUser.set(null);
        this.isAuthValid.set(false);
        this.authCheckSubject.next();
    }, { allowSignalWrites: true });
    effect(() => {
        localStorage.setItem('tmdbReadToken', this.tmdbReadToken());
        this.tmdbUser.set(null);
        this.isAuthValid.set(false);
        this.authCheckSubject.next();
    }, { allowSignalWrites: true });
    effect(() => {
        localStorage.setItem('tmdbApiKey', this.tmdbApiKey());
        this.tmdbUser.set(null);
        this.isAuthValid.set(false);
        this.authCheckSubject.next();
    }, { allowSignalWrites: true });
    effect(() => localStorage.setItem('tmdbWatchRegion', this.watchRegion()));
    effect(() => localStorage.setItem('tmdbLanguage', this.language()));
    effect(() => localStorage.setItem('tmdbIncludeAdult', this.includeAdult().toString()));
    effect(() => localStorage.setItem('tmdbGlobalCollectionType', this.globalCollectionType()));
    effect(() => localStorage.setItem('tmdbGlobalCollectionEndpoints', JSON.stringify(this.globalCollectionEndpoints())));
    effect(() => localStorage.setItem('tmdbGlobalCollectionItemLimit', this.globalCollectionItemLimit().toString()));
    effect(() => localStorage.setItem('tmdbGlobalSlideshowDurationMs', this.globalSlideshowDurationMs().toString()));
    effect(() => localStorage.setItem('tmdbGlobalDiscoverFilters', JSON.stringify(this.globalDiscoverFilters())));

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

    effect(() => {
        const dataKey = this.globalSlideshowFetchKey();
        const authReady = this.isApiConfigured() && this.isAuthValid();
        this.language();
        this.watchRegion();
        this.includeAdult();

        if (!authReady || !dataKey) {
          untracked(() => this.clearGlobalSlideshowRuntime());
          return;
        }

        untracked(() => {
          this.fetchTmdbGenres();
          this.fetchGlobalSlideshowData();
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
      this.clearElementTransitionPreviews();
      this.clearCollectionRuntime();
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
      if (this.multiSelectMode() && this.selectedElementIds().length > 1 && !isInputActive) {
             event.preventDefault();
             this.deleteSelectedElements();
      } else if (this.selectedElementId() && !isInputActive) {
             event.preventDefault();
             this.deleteElement(this.selectedElementId()!);
      }
    } else if (!isInputActive && this.selectedElementId()) {
        const el = this.selectedElement();
        if (el) {
            const step = el.snapToGrid ? this.getSnapIncrement(el) * (event.shiftKey ? 5 : 1) : (event.shiftKey ? 10 : 1);
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
                this.saveStateToHistory();
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
      window.open('https://www.themoviedb.org/settings/api', '_blank', 'noopener,noreferrer');
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

      this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => ({
          ...el,
          x: el.x * scaleX,
          y: el.y * scaleY,
          width: el.width * scaleX,
          height: el.height * scaleY,
          styles: {
              ...el.styles,
              fontSize: el.styles.fontSize * ((scaleX + scaleY) / 2)
          }
      }))));
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
          if (preset === 'tv') this.setCanvasZoom(0.45);
          else if (preset === 'tablet') this.setCanvasZoom(0.75);
          else this.setCanvasZoom(1.0);
          return;
      }

      const styles = window.getComputedStyle(viewport);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const availableWidth = Math.max(1, viewport.clientWidth - paddingX - 48);
      const availableHeight = Math.max(1, viewport.clientHeight - paddingY - 72);
      const fitScale = Math.min(availableWidth / width, availableHeight / height);
      this.setCanvasZoom(fitScale);
  }

  setCanvasZoom(value: number) {
      const clampedScale = Math.min(this.maxZoom, Math.max(this.minZoom, value));
      this.zoomLevel.set(Math.round(clampedScale * 100) / 100);
  }

  zoomCanvasWithWheel(event: WheelEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.zoom-overlay')) return;

      event.preventDefault();
      const viewport = event.currentTarget as HTMLElement;
      const oldZoom = this.zoomLevel();
      const nextZoom = Math.min(this.maxZoom, Math.max(this.minZoom, oldZoom * Math.exp(-event.deltaY * 0.0005)));
      if (nextZoom === oldZoom) return;

      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const contentX = viewport.scrollLeft + pointerX;
      const contentY = viewport.scrollTop + pointerY;
      const zoomRatio = nextZoom / oldZoom;

      this.setCanvasZoom(nextZoom);

      requestAnimationFrame(() => {
          viewport.scrollLeft = contentX * zoomRatio - pointerX;
          viewport.scrollTop = contentY * zoomRatio - pointerY;
      });
  }

  handleCanvasViewportMouseDown(event: MouseEvent) {
      if (event.button !== 1) return;

      event.preventDefault();
      event.stopPropagation();
      const now = window.performance.now();
      if (now - this.lastMiddleClickAt <= this.middleClickResetWindowMs) {
          this.lastMiddleClickAt = 0;
          this.fitCanvasToScreen();
          return;
      }

      this.lastMiddleClickAt = now;
  }

  preventCanvasAuxClick(event: MouseEvent) {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
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
        includeAdult: this.includeAdult(),
        globalCollectionType: this.globalCollectionType(),
        globalCollectionEndpoints: this.globalCollectionEndpoints(),
        globalCollectionItemLimit: this.globalCollectionItemLimit(),
        globalSlideshowDurationMs: this.globalSlideshowDurationMs(),
        globalDiscoverFilters: this.globalDiscoverFilters()
      },
      elements: this.elements().map(el => this.normalizeElementForProject(el))
    };
  }

  private normalizeElementForProject(element: CanvasElement): CanvasElement {
    const { tmdbData, ...rest } = element;
    const normalizedContentStrokeWidth = this.normalizeCssLength(element.styles?.contentStrokeWidth ?? element.styles?.textStrokeWidth, 0, 0, 100);
    const contentStrokeEnabled = typeof element.styles?.contentStrokeEnabled === 'boolean'
      ? element.styles.contentStrokeEnabled
      : normalizedContentStrokeWidth > 0;
    const normalized: CanvasElement = {
      ...rest,
      styles: {
        ...element.styles,
        fontSizeUnit: this.normalizeFontSizeUnit(element.styles?.fontSizeUnit),
        fontStyle: element.styles?.fontStyle === 'italic' ? 'italic' : 'normal',
        textDecoration: element.styles?.textDecoration === 'underline' ? 'underline' : 'none',
        lineHeight: this.normalizeCssLength(element.styles?.lineHeight, 1.2, 0.1, 1000),
        lineHeightUnit: this.normalizeLineHeightUnit(element.styles?.lineHeightUnit),
        textStrokeWidth: this.normalizeCssLength(element.styles?.textStrokeWidth, 0, 0, 100),
        textStrokeUnit: this.normalizeFontSizeUnit(element.styles?.textStrokeUnit),
        textStrokeColor: element.styles?.textStrokeColor || '#000000',
        contentAlignX: this.normalizeContentAlignX(element.styles?.contentAlignX ?? this.getDefaultContentAlignXForType(element.type, element.styles?.textAlign)),
        contentAlignY: this.normalizeContentAlignY(element.styles?.contentAlignY ?? this.getDefaultContentAlignYForType(element.type)),
        contentStrokeEnabled,
        contentStrokeWidth: normalizedContentStrokeWidth,
        contentStrokeUnit: this.normalizeFontSizeUnit(element.styles?.contentStrokeUnit ?? element.styles?.textStrokeUnit),
        contentStrokeColor: element.styles?.contentStrokeColor || element.styles?.textStrokeColor || '#000000',
        contentStrokePosition: this.normalizeStrokePosition(element.styles?.contentStrokePosition),
        contentShadow: element.styles?.contentShadow || element.styles?.textShadow
      },
      discoverFilters: {
        sortBy: element.discoverFilters?.sortBy || 'popularity.desc',
        genres: (element.discoverFilters?.genres || []).map(Number).filter(Number.isFinite),
        year: element.discoverFilters?.year ? Number(element.discoverFilters.year) : null
      },
      snapToGrid: !!element.snapToGrid,
      snapIncrement: this.normalizeSnapIncrement(element.snapIncrement),
      maintainAspectRatio: element.type === 'tmdb-poster' ? element.maintainAspectRatio !== false : element.maintainAspectRatio,
      relativeToElementId: element.relativeToElementId || undefined,
      relativeSide: element.relativeToElementId ? this.normalizeRelativeSide(element.relativeSide) : undefined,
      relativeGap: element.relativeToElementId ? this.normalizeRelativeGap(element.relativeGap) : undefined,
      relativeMatchSize: element.relativeToElementId ? !!element.relativeMatchSize : undefined,
      transitionEffect: this.normalizeTransitionEffect(element.transitionEffect),
      transitionDurationMs: this.normalizeTransitionDurationMs(element.transitionDurationMs, 500),
      transitionDelayMs: this.normalizeTransitionDurationMs(element.transitionDelayMs, 0),
      groupTransitionEnabled: !!element.groupTransitionEnabled,
      castBubbleSize: element.type === 'tmdb-cast' ? this.normalizeCastBubbleSize(element.castBubbleSize) : element.castBubbleSize,
      castCount: element.type === 'tmdb-cast' ? this.normalizeCastCount(element.castCount) : element.castCount
    };
    if (this.isCollectionElementType(normalized.type)) {
      normalized.collectionItemLimit = this.normalizeCollectionItemLimit(element.collectionItemLimit);
      normalized.globalSceneFade = !!element.globalSceneFade;
      normalized.tmdbId = undefined;
    }
    if (normalized.type === 'tmdb-backdrop-slideshow') {
      normalized.slideshowDurationMs = this.normalizeSlideshowDurationMs(element.slideshowDurationMs);
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
    if (project.settings?.globalCollectionType) this.globalCollectionType.set(this.normalizeCollectionType(project.settings.globalCollectionType));
    if (project.settings?.globalCollectionEndpoints) {
      this.globalCollectionEndpoints.set({
        movie: this.normalizeCollectionEndpoint('movie', project.settings.globalCollectionEndpoints.movie),
        tv: this.normalizeCollectionEndpoint('tv', project.settings.globalCollectionEndpoints.tv),
        mixed: this.normalizeCollectionEndpoint('mixed', project.settings.globalCollectionEndpoints.mixed)
      });
    }
    if (project.settings?.globalCollectionItemLimit !== undefined) {
      this.globalCollectionItemLimit.set(this.normalizeCollectionItemLimit(project.settings.globalCollectionItemLimit));
    }
    if (project.settings?.globalSlideshowDurationMs !== undefined) {
      this.globalSlideshowDurationMs.set(this.normalizeSlideshowDurationMs(project.settings.globalSlideshowDurationMs));
    }
    if (project.settings?.globalDiscoverFilters) {
      this.globalDiscoverFilters.set({
        movie: this.normalizeDiscoverFilters(project.settings.globalDiscoverFilters.movie),
        tv: this.normalizeDiscoverFilters(project.settings.globalDiscoverFilters.tv)
      });
    }

    const restoredElements = project.elements.map((el: CanvasElement) => this.normalizeElementForProject(el));
    const restoredIds = new Set(restoredElements.map((el: CanvasElement) => el.id));
    const cleanedElements = restoredElements.map((el: CanvasElement) => {
      if (!el.relativeToElementId || restoredIds.has(el.relativeToElementId)) return el;
      const { relativeToElementId, relativeSide, relativeGap, relativeMatchSize, ...rest } = el;
      return rest as CanvasElement;
    });
    this.clearCollectionRuntime();
    this.elements.set(this.applyRelativeLayoutToElements(cleanedElements));
    this.selectedElementId.set(null);
    this.selectedElementIds.set([]);
    this.multiSelectMode.set(false);
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
    a.download = 'tmdb-layout-project.tmdb-layout.json';
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
        alert('Unable to open this project file.');
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  // --- HISTORY MANAGEMENT ---
  saveStateToHistory() {
    setTimeout(() => {
      const currentState: HistoryState = {
        elements: JSON.parse(JSON.stringify(this.elements())),
        selectedElementId: this.selectedElementId(),
        selectedElementIds: [...this.selectedElementIds()],
        multiSelectMode: this.multiSelectMode(),
        globalCollectionType: this.globalCollectionType(),
        globalCollectionEndpoints: { ...this.globalCollectionEndpoints() },
        globalCollectionItemLimit: this.globalCollectionItemLimit(),
        globalSlideshowDurationMs: this.globalSlideshowDurationMs(),
        globalDiscoverFilters: JSON.parse(JSON.stringify(this.globalDiscoverFilters()))
      };
      const lastState = this.history()[this.historyIndex()];
      if (lastState && JSON.stringify(lastState) === JSON.stringify(currentState)) return;

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
      this.clearCollectionRuntime();
      if (state.globalCollectionType) this.globalCollectionType.set(this.normalizeCollectionType(state.globalCollectionType));
      if (state.globalCollectionEndpoints) this.globalCollectionEndpoints.set({
        movie: this.normalizeCollectionEndpoint('movie', state.globalCollectionEndpoints.movie),
        tv: this.normalizeCollectionEndpoint('tv', state.globalCollectionEndpoints.tv),
        mixed: this.normalizeCollectionEndpoint('mixed', state.globalCollectionEndpoints.mixed)
      });
      if (state.globalCollectionItemLimit !== undefined) this.globalCollectionItemLimit.set(this.normalizeCollectionItemLimit(state.globalCollectionItemLimit));
      if (state.globalSlideshowDurationMs !== undefined) this.globalSlideshowDurationMs.set(this.normalizeSlideshowDurationMs(state.globalSlideshowDurationMs));
      if (state.globalDiscoverFilters) this.globalDiscoverFilters.set({
        movie: this.normalizeDiscoverFilters(state.globalDiscoverFilters.movie),
        tv: this.normalizeDiscoverFilters(state.globalDiscoverFilters.tv)
      });
      this.elements.set(state.elements);
      this.selectedElementId.set(state.selectedElementId);
      this.selectedElementIds.set(state.selectedElementIds || (state.selectedElementId ? [state.selectedElementId] : []));
      this.multiSelectMode.set(!!state.multiSelectMode);
      state.elements.forEach(el => {
        if (el.type === 'tmdb-backdrop-slideshow') this.setupSlideshow(el.id);
        if (el.type === 'tmdb-poster-scroll') this.setupPosterScroll(el.id);
      });
    }
  }

  private clearCollectionRuntime(elementId?: string) {
    const clearFromMap = (map: Map<string, any>, id: string) => {
      if (!map.has(id)) return;
      clearInterval(map.get(id));
      map.delete(id);
    };

    if (elementId) {
      this.clearSlideshowTimeout(this.slideshowIntervals, elementId);
      this.clearSlideshowTimeout(this.slideshowTransitionTimeouts, elementId);
      this.slideshowNextSchedulers.delete(elementId);
      this.clearDynamicBackdropTransitions(elementId);
      clearFromMap(this.posterScrollIntervals, elementId);
      this.createSlideshowRunToken(elementId);
      this.slideshowState.update(state => {
        if (!state[elementId]) return state;
        const { [elementId]: _removed, ...rest } = state;
        return rest;
      });
      return;
    }

    this.clearGlobalSlideshowRuntime();
    this.slideshowIntervals.forEach(interval => clearTimeout(interval));
    this.slideshowTransitionTimeouts.forEach(timeout => clearTimeout(timeout));
    this.posterScrollIntervals.forEach(interval => clearInterval(interval));
    this.slideshowIntervals.clear();
    this.slideshowTransitionTimeouts.clear();
    this.slideshowNextSchedulers.clear();
    this.posterScrollIntervals.clear();
    this.slideshowRunTokens.clear();
    this.slideshowState.set({});
  }

  private clearGlobalSlideshowRuntime(clearData = true) {
    if (this.globalSlideshowInterval) {
      clearInterval(this.globalSlideshowInterval);
      this.globalSlideshowInterval = null;
    }
    this.clearDynamicBackdropTransitions();
    this.globalSlideshowRunToken++;
    this.globalSlideshowApplySequence++;
    this.globalSlideshowIndex = 0;
    if (clearData) this.globalSlideshowData.set(null);
  }

  // --- ELEMENT MANIPULATION ---
  addCollectionSlideshow(collectionType: TmdbCollectionType) {
    const type = this.normalizeCollectionType(collectionType);
    this.globalCollectionType.set(type);
    this.globalCollectionEndpoints.update(endpoints => ({
      ...endpoints,
      [type]: this.normalizeCollectionEndpoint(type, endpoints[type])
    }));
    this.applyGlobalCollectionSettingsToElements(false);
    this.fetchGlobalSlideshowData();
    this.saveStateToHistory();
  }

  addElement(type: ElementType, itemType: TmdbItemType = 'movie', collectionType?: TmdbCollectionType) {
    const isLogo = type === 'tmdb-logo' || type === 'tmdb-network-logo';
    const isTmdbElement = type.startsWith('tmdb-');
    const isCollectionElement = this.isCollectionElementType(type);
    const resolvedCollectionType = isCollectionElement
      ? this.normalizeCollectionType(collectionType || this.globalCollectionType())
      : (collectionType || (itemType === 'tv' ? 'tv' : 'movie'));
    const resolvedItemType = isCollectionElement ? this.globalCollectionItemType(resolvedCollectionType) : itemType;
    const currentScale = this.canvasConfig().width / 1920;
    const baseScale = this.selectedPreset() === 'mobile' ? 1 : (this.selectedPreset() === 'tablet' ? 1.5 : 2.5);
    const defaultContentAlignX = this.getDefaultContentAlignXForType(type, 'left');
    const defaultContentAlignY = this.getDefaultContentAlignYForType(type);

    const newElement: CanvasElement = {
      id: `el_${Date.now()}`, type, x: 50, y: 50,
      width: (type.includes('scroll') || type.includes('slideshow') ? 350 : (type.includes('backdrop') ? 300 : (type.includes('cast') ? 350 : (isLogo ? 120 : 150)))) * baseScale,
      height: (type.includes('text') || type.includes('title') || type.includes('tagline') || type.includes('dynamic') ? 50 : (type.includes('backdrop') || type.includes('slideshow') ? 169 : (type.includes('cast') ? 100 : (isLogo ? 60 : 225)))) * baseScale,
      rotation: 0,
      zIndex: this.elements().length + 1, content: 'New Element', visible: true,
      styles: {
          backgroundColor: type === 'shape' ? '#1b3a57' : '#0d253f',
          backgroundOpacity: type === 'shape' ? 1 : 0,
          color: '#f1f5f9',
          fontFamily: 'Inter',
          fontSize: 16 * baseScale,
          fontSizeUnit: 'px',
          fontStyle: type === 'tmdb-tagline' ? 'italic' : 'normal',
          fontWeight: '400',
          textAlign: 'left',
          textDecoration: 'none',
          lineHeight: 1.2,
          lineHeightUnit: 'em',
          textStrokeWidth: 0,
          textStrokeUnit: 'px',
          textStrokeColor: '#000000',
          contentAlignX: defaultContentAlignX,
          contentAlignY: defaultContentAlignY,
          contentStrokeEnabled: false,
          contentStrokeWidth: 0,
          contentStrokeUnit: 'px',
          contentStrokeColor: '#000000',
          contentStrokePosition: 'outside',
          borderRadius: 8,
          borderWidth: 0,
          borderColor: '#f1f5f9',
          opacity: 1,
          filterBlur: 0,
          filterGrayscale: 0
      },
      tmdbItemType: resolvedItemType,
      tmdbCollectionType: resolvedCollectionType,
      tmdbEndpoint: isCollectionElement ? this.getGlobalCollectionEndpointForType(resolvedCollectionType) : undefined,
      discoverFilters: isCollectionElement ? this.getGlobalDiscoverFiltersForType(resolvedCollectionType) : { sortBy: 'popularity.desc', genres: [], year: null },
      imageFit: isLogo ? 'contain' : 'cover',
      collectionItemLimit: isCollectionElement ? this.globalCollectionItemLimit() : undefined,
      globalSceneFade: false,
      slideshowDurationMs: type === 'tmdb-backdrop-slideshow' ? this.globalSlideshowDurationMs() : undefined,
      snapToGrid: false,
      snapIncrement: this.defaultSnapIncrement,
      maintainAspectRatio: type === 'tmdb-poster',
      transitionEffect: 'none',
      transitionDurationMs: 500,
      transitionDelayMs: 0,
      castBubbleSize: type === 'tmdb-cast' ? 48 : undefined,
      castCount: type === 'tmdb-cast' ? this.defaultCastCount : undefined,
      linkGroup: isTmdbElement ? this.defaultCollectionLinkGroup : '',
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
    this.elements.update(els => this.applyRelativeLayoutToElements(els
      .filter(el => el.id !== id)
      .map(el => {
        let next = el.syncedToElementId === id ? { ...el, syncedToElementId: undefined, linkGroup: '' } : el;
        if (next.relativeToElementId === id) {
          const { relativeToElementId, relativeSide, relativeGap, relativeMatchSize, ...rest } = next;
          next = rest as CanvasElement;
        }
        return next;
      })
    ));
    const remainingSelection = this.selectedElementIds().filter(selectedId => selectedId !== id);
    this.selectedElementIds.set(remainingSelection);
    if (this.selectedElementId() === id) this.selectedElementId.set(remainingSelection[remainingSelection.length - 1] || null);
	    if (remainingSelection.length === 0) this.multiSelectMode.set(false);
	    this.clearElementTransitionPreviews(id);
	    this.clearCollectionRuntime(id);
	    this.saveStateToHistory();
	  }

  deleteSelectedElements() {
    const ids = this.selectedElementIds();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
	    ids.forEach(id => {
	      this.clearElementTransitionPreviews(id);
	      this.clearCollectionRuntime(id);
	    });
    this.elements.update(els => this.applyRelativeLayoutToElements(els
      .filter(el => !idSet.has(el.id))
      .map(el => {
        let next = el.syncedToElementId && idSet.has(el.syncedToElementId) ? { ...el, syncedToElementId: undefined, linkGroup: '' } : el;
        if (next.relativeToElementId && idSet.has(next.relativeToElementId)) {
          const { relativeToElementId, relativeSide, relativeGap, relativeMatchSize, ...rest } = next;
          next = rest as CanvasElement;
        }
        return next;
      })
    ));
    this.selectedElementId.set(null);
    this.selectedElementIds.set([]);
    this.multiSelectMode.set(false);
    this.saveStateToHistory();
  }

  selectElement(id: string | null) {
    if (this.multiSelectMode() && id) {
      this.toggleElementInMultiSelection(id);
      return;
    }

    this.selectedElementId.set(id);
    this.selectedElementIds.set(id ? this.getHighlightedElementIds(id) : []);
    if(id) {
        this.tmdbSearchResults.set([]);
    }
  }

  selectElementFromPointer(event: MouseEvent, id: string) {
    if (event.button === 1) return;
    if (this.multiSelectMode()) {
      event.stopPropagation();
      this.toggleElementInMultiSelection(id);
      return;
    }
    this.selectElement(id);
  }

  deselectCanvas(event: MouseEvent) {
    if ((event.target as HTMLElement).id !== 'canvas-bg') return;
    this.selectedElementId.set(null);
    this.selectedElementIds.set([]);
    this.multiSelectMode.set(false);
  }

  toggleMultiSelectFromContext(elementId: string) {
    if (!this.multiSelectMode()) {
      this.multiSelectMode.set(true);
      this.selectedElementId.set(elementId);
      this.selectedElementIds.set([elementId]);
    } else {
      this.toggleElementInMultiSelection(elementId);
    }
    this.activeRightPanelTab.set('properties');
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  clearMultiSelection() {
    this.multiSelectMode.set(false);
    const selectedId = this.selectedElementId();
    this.selectedElementIds.set(selectedId ? this.getHighlightedElementIds(selectedId) : []);
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  private toggleElementInMultiSelection(elementId: string) {
    this.tmdbSearchResults.set([]);
    this.selectedElementIds.update(ids => {
      const exists = ids.includes(elementId);
      const next = exists ? ids.filter(id => id !== elementId) : [...ids, elementId];
      this.selectedElementId.set(next[next.length - 1] || null);
      if (next.length === 0) this.multiSelectMode.set(false);
      return next;
    });
  }

  private createGroupBackgroundElement(groupElements: CanvasElement[], layoutGroupId: string, groupLocked: boolean, source?: CanvasElement): CanvasElement | null {
    if (groupElements.length === 0) return null;

    const padding = source?.groupPadding ?? 24;
    const minX = Math.min(...groupElements.map(el => el.x));
    const minY = Math.min(...groupElements.map(el => el.y));
    const maxX = Math.max(...groupElements.map(el => el.x + el.width));
    const maxY = Math.max(...groupElements.map(el => el.y + el.height));
    const minZ = Math.min(...groupElements.map(el => el.zIndex));
    const backgroundZ = Math.max(1, minZ - 1);

    return {
      id: `el_${Date.now()}`,
      type: 'shape',
      x: minX - padding,
      y: minY - padding,
      width: (maxX - minX) + (padding * 2),
      height: (maxY - minY) + (padding * 2),
      rotation: 0,
      zIndex: backgroundZ,
      content: 'Group Background',
      visible: true,
      styles: {
        backgroundColor: '#0d253f',
        backgroundOpacity: 0.72,
        color: '#f1f5f9',
        fontFamily: 'Inter',
        fontSize: 16,
        fontSizeUnit: 'px',
        fontStyle: 'normal',
        fontWeight: '400',
        textAlign: 'left',
        textDecoration: 'none',
        lineHeight: 1.2,
        lineHeightUnit: 'em',
        textStrokeWidth: 0,
        textStrokeUnit: 'px',
        textStrokeColor: '#000000',
        contentAlignX: 'center',
        contentAlignY: 'center',
        contentStrokeEnabled: false,
        contentStrokeWidth: 0,
        contentStrokeUnit: 'px',
        contentStrokeColor: '#000000',
        contentStrokePosition: 'outside',
        borderRadius: 18,
        borderWidth: 0,
        borderColor: '#f1f5f9',
        opacity: 1,
        filterBlur: 0,
        filterGrayscale: 0
      },
      tmdbItemType: 'movie',
      tmdbCollectionType: 'movie',
      discoverFilters: { sortBy: 'popularity.desc', genres: [], year: null },
      imageFit: 'cover',
      layoutGroupId,
      layoutGroupRole: 'background',
      groupLocked,
      groupPadding: padding,
      groupTransitionEnabled: !!source?.groupTransitionEnabled,
      transitionEffect: source?.groupTransitionEnabled ? this.normalizeTransitionEffect(source.transitionEffect) : 'none',
      transitionDurationMs: this.normalizeTransitionDurationMs(source?.transitionDurationMs, 500),
      transitionDelayMs: this.normalizeTransitionDurationMs(source?.transitionDelayMs, 0),
      linkGroup: '',
      dataPath: '',
      dataPrefix: '',
      dataSuffix: ''
    };
  }

  groupSelectedLayers() {
    const ids = this.selectedElementIds();
    if (ids.length < 2) return;

    const selected = this.elements().filter(el => ids.includes(el.id));
    if (selected.length < 2) return;

    const layoutGroupId = `layout_${Date.now().toString(36)}`;
    const selectedIdSet = new Set(ids);
    this.elements.update(els => els.map(el => {
        if (!selectedIdSet.has(el.id)) return el;
        const { layoutGroupId: _oldLayoutGroupId, layoutGroupRole: _oldLayoutGroupRole, groupPadding: _oldGroupPadding, groupTransitionEnabled: _oldGroupTransitionEnabled, ...rest } = el;
        return {
          ...rest,
          layoutGroupId,
          layoutGroupRole: 'member' as LayoutGroupRole,
          groupLocked: true
        };
    }));

    this.multiSelectMode.set(false);
    const selectedId = this.selectedElementId() && selectedIdSet.has(this.selectedElementId()!)
      ? this.selectedElementId()!
      : ids[ids.length - 1];
    this.selectedElementId.set(selectedId);
    this.selectedElementIds.set(this.getHighlightedElementIds(selectedId));
    this.activeRightPanelTab.set('properties');
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
    this.saveStateToHistory();
  }

  addBackgroundToGroup(elementId: string) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected?.layoutGroupId || this.getLayoutGroupBackground(selected)) return;

    const groupElements = this.getLayoutGroupElements(selected).filter(el => el.layoutGroupRole !== 'background');
    const source = this.getLayoutGroupTransitionSource(selected) || selected;
    const background = this.createGroupBackgroundElement(groupElements, selected.layoutGroupId, this.getLayoutGroupLockState(selected), source);
    if (!background) return;

    this.elements.update(els => [
      ...els.map(el => {
        if (el.layoutGroupId !== selected.layoutGroupId) return el;
        return {
          ...el,
          zIndex: el.zIndex <= background.zIndex ? background.zIndex + 1 : el.zIndex
        };
      }),
      background
    ]);
    this.selectElement(background.id);
    this.activeRightPanelTab.set('properties');
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
    this.saveStateToHistory();
  }

  private getLayerOrder(elements = this.elements()): CanvasElement[] {
    return elements
      .map((el, index) => ({ el, index }))
      .sort((a, b) => b.el.zIndex - a.el.zIndex || b.index - a.index)
      .map(item => item.el);
  }

  getLayerElements(): CanvasElement[] {
    return this.getLayerOrder();
  }

  private applyLayerOrder(layerOrder: CanvasElement[], saveHistory = true) {
    const zById = new Map(layerOrder.map((el, index) => [el.id, layerOrder.length - index]));
    this.elements.update(els => els.map(el => ({ ...el, zIndex: zById.get(el.id) ?? el.zIndex })));
    if (saveHistory) this.saveStateToHistory();
  }

  private moveLayerToIndex(id: string, targetIndex: number, saveHistory = true) {
    const order = this.getLayerOrder();
    const currentIndex = order.findIndex(el => el.id === id);
    if (currentIndex < 0) return;
    const [moved] = order.splice(currentIndex, 1);
    const clampedIndex = Math.max(0, Math.min(order.length, targetIndex));
    order.splice(clampedIndex, 0, moved);
    this.applyLayerOrder(order, saveHistory);
  }

  moveLayerUp(id: string, saveHistory = true) {
    const order = this.getLayerOrder();
    const currentIndex = order.findIndex(el => el.id === id);
    if (currentIndex <= 0) {
      this.contextMenu.update(cm => ({ ...cm, visible: false }));
      return;
    }
    this.moveLayerToIndex(id, currentIndex - 1, saveHistory);
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  moveLayerDown(id: string, saveHistory = true) {
    const order = this.getLayerOrder();
    const currentIndex = order.findIndex(el => el.id === id);
    if (currentIndex < 0 || currentIndex >= order.length - 1) {
      this.contextMenu.update(cm => ({ ...cm, visible: false }));
      return;
    }
    this.moveLayerToIndex(id, currentIndex + 1, saveHistory);
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  bringToFront(id: string, saveHistory = true) {
    this.moveLayerToIndex(id, 0, saveHistory);
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  sendToBack(id: string, saveHistory = true) {
    this.moveLayerToIndex(id, this.getLayerOrder().length - 1, saveHistory);
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  updateElementStyle(prop: keyof CanvasElement['styles'], value: any) {
    this.updateSelectedElement(el => {
      let nextValue = value;
      if (prop === 'fontSizeUnit' || prop === 'textStrokeUnit' || prop === 'contentStrokeUnit') {
        nextValue = this.normalizeFontSizeUnit(value);
      } else if (prop === 'lineHeightUnit') {
        nextValue = this.normalizeLineHeightUnit(value);
      } else if (prop === 'contentAlignX') {
        nextValue = this.normalizeContentAlignX(value);
        el.styles.textAlign = nextValue as CanvasElement['styles']['textAlign'];
      } else if (prop === 'contentAlignY') {
        nextValue = this.normalizeContentAlignY(value);
      } else if (prop === 'contentStrokePosition') {
        nextValue = this.normalizeStrokePosition(value);
      } else if (prop === 'textAlign') {
        nextValue = this.normalizeContentAlignX(value);
        el.styles.contentAlignX = nextValue;
      } else if (prop === 'fontSize') {
        nextValue = Math.max(0.1, Number(value) || 16);
      } else if (prop === 'lineHeight') {
        nextValue = this.normalizeCssLength(value, 1.2, 0.1, 1000);
      } else if (prop === 'textStrokeWidth' || prop === 'contentStrokeWidth') {
        nextValue = this.normalizeCssLength(value, 0, 0, 100);
      } else if (prop === 'borderWidth' || prop === 'borderRadius') {
        nextValue = this.normalizeCssLength(value, 0, 0, 500);
      }
      el.styles = { ...el.styles, [prop]: nextValue };
    });
  }

  updateElementProperty(prop: keyof CanvasElement, value: any, noHistory = false) {
      const selected = this.selectedElement();
      const selectedId = selected?.id;
      if (selected && (prop === 'x' || prop === 'y') && this.getLayoutGroupLockState(selected)) {
        const nextValue = this.maybeSnapValue(selected, Number(value));
        const currentValue = Number(selected[prop]) || 0;
        const delta = nextValue - currentValue;
        if (delta !== 0 && selected.layoutGroupId) {
          this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => el.layoutGroupId === selected.layoutGroupId ? {
            ...el,
            x: prop === 'x' ? el.x + delta : el.x,
            y: prop === 'y' ? el.y + delta : el.y
          } : el)));
          if (!noHistory) this.saveStateToHistory();
        }
        return;
      }

      if (selected && (prop === 'width' || prop === 'height') && this.isResizeLockedByGroup(selected)) {
        return;
      }

      if (selected && (prop === 'width' || prop === 'height') && this.isLayoutGroupBackground(selected) && this.getLayoutGroupLockState(selected)) {
        this.resizeLockedGroupFromBackgroundInput(selected, prop, value, noHistory);
        return;
      }

      this.updateSelectedElement(el => {
        if (prop === 'width' || prop === 'height') {
          this.applySizePropertyUpdate(el, prop, value);
          return;
        }

        if (prop === 'x' || prop === 'y') {
          (el as any)[prop] = this.maybeSnapValue(el, Number(value));
          return;
        }

        if (prop === 'snapIncrement') {
          const increment = this.normalizeSnapIncrement(value);
          el.snapIncrement = increment;
          if (el.snapToGrid) {
            el.x = this.snapValue(el.x, increment);
            el.y = this.snapValue(el.y, increment);
          }
          return;
        }

        if (prop === 'tmdbId') {
          el.tmdbId = value ? String(value) : '';
          if (el.tmdbId) el.tmdbEndpoint = undefined;
          el.tmdbData = null;
          return;
        }

        (el as any)[prop] = value;
        if (prop === 'tmdbItemType' || prop === 'tmdbCollectionType' || prop === 'tmdbEndpoint') {
          el.tmdbData = null;
        }
      }, noHistory);

      if (selectedId && ['content', 'dataPath', 'dataPrefix', 'dataSuffix'].includes(String(prop))) {
        this.triggerElementTransitions([selectedId]);
      }

      if (prop === 'tmdbId') {
         const el = this.selectedElement();
         if(el && el.linkGroup) {
             this.propagateTmdbId(el.linkGroup, value, el.tmdbItemType);
         } else if(el) {
	         this.fetchTmdbDataForElement(el.id);
	     }
      }
  }

  private resizeLockedGroupFromBackgroundInput(background: CanvasElement, prop: ElementSizeProperty, value: any, noHistory = false) {
    if (!background.layoutGroupId) return;

    const nextValue = Math.max(20, this.maybeSnapValue(background, Number(value) || 20));
    const scaleX = prop === 'width' ? nextValue / Math.max(1, background.width) : 1;
    const scaleY = prop === 'height' ? nextValue / Math.max(1, background.height) : 1;

    this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => {
      if (el.layoutGroupId !== background.layoutGroupId) return el;
      if (el.id === background.id) {
        return {
          ...el,
          width: prop === 'width' ? nextValue : el.width,
          height: prop === 'height' ? nextValue : el.height
        };
      }

      return {
        ...el,
        x: background.x + ((el.x - background.x) * scaleX),
        y: background.y + ((el.y - background.y) * scaleY),
        width: Math.max(20, el.width * scaleX),
        height: Math.max(20, el.height * scaleY)
      };
    })));

    if (!noHistory) this.saveStateToHistory();
  }

  private applySizePropertyUpdate(element: CanvasElement, prop: ElementSizeProperty, value: any) {
    const nextValue = Math.max(1, Number(value) || 1);

    if (element.type === 'tmdb-poster' && element.maintainAspectRatio !== false) {
      if (prop === 'width') {
        element.width = Math.max(1, this.maybeSnapValue(element, nextValue));
        element.height = element.width / this.posterAspectRatio;
      } else {
        element.height = Math.max(1, this.maybeSnapValue(element, nextValue));
        element.width = element.height * this.posterAspectRatio;
      }
      return;
    }

    element[prop] = Math.max(1, this.maybeSnapValue(element, nextValue));
  }

  updateTmdbSourceType(elementId: string, value: TmdbCollectionType) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected) return;

    const endpointIsValid = (endpoint?: string) =>
      !endpoint || (this.tmdbEndpoints[value] || []).some(option => option.key === endpoint);

    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;
      const nextEndpoint = endpointIsValid(el.tmdbEndpoint) ? el.tmdbEndpoint : undefined;
      return {
        ...el,
        tmdbCollectionType: value,
        tmdbItemType: value === 'tv' ? 'tv' : 'movie',
        tmdbEndpoint: nextEndpoint,
        tmdbData: null
      };
    }));

    const latest = this.elements().find(el => el.id === elementId);
    if (latest?.tmdbEndpoint || latest?.tmdbId) this.fetchTmdbDataForElement(elementId);
    this.saveStateToHistory();
  }

  updateTmdbEndpoint(elementId: string, value: string) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected) return;

    const endpoint = value || undefined;
    this.elements.update(els => els.map(el => el.id === elementId ? {
      ...el,
      tmdbEndpoint: endpoint,
      tmdbId: endpoint ? '' : el.tmdbId,
      tmdbData: null
    } : el));

    if (endpoint) this.fetchTmdbDataForElement(elementId);
    this.saveStateToHistory();
  }

  toggleSnapToGrid(elementId: string, value?: boolean) {
    const element = this.elements().find(el => el.id === elementId);
    if (!element) return;
    const enabled = value ?? !element.snapToGrid;

    this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => {
      if (el.id !== elementId) return el;
      const snapIncrement = this.normalizeSnapIncrement(el.snapIncrement);
      return {
        ...el,
        snapToGrid: enabled,
        snapIncrement,
        x: enabled ? this.snapValue(el.x, snapIncrement) : el.x,
        y: enabled ? this.snapValue(el.y, snapIncrement) : el.y
      };
    })));
    this.saveStateToHistory();
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  updatePosterAspectRatio(elementId: string, value: boolean) {
    this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => {
      if (el.id !== elementId || el.type !== 'tmdb-poster') return el;
      return {
        ...el,
        maintainAspectRatio: value,
        height: value ? el.width / this.posterAspectRatio : el.height
      };
    })));
    this.saveStateToHistory();
  }

  setLayoutGroupLocked(elementId: string, locked: boolean) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected?.layoutGroupId) return;

    this.elements.update(els => els.map(el => {
      if (el.layoutGroupId !== selected.layoutGroupId) return el;
      return { ...el, groupLocked: locked };
    }));
    if (this.selectedElementId()) this.selectedElementIds.set(this.getHighlightedElementIds(this.selectedElementId()!));
    this.saveStateToHistory();
  }

  ungroupLayoutGroup(elementId: string) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected?.layoutGroupId) return;

    const groupId = selected.layoutGroupId;
    this.elements.update(els => els.map(el => {
      if (el.layoutGroupId !== groupId) return el;
      const { layoutGroupId, layoutGroupRole, groupLocked, groupPadding, groupTransitionEnabled, ...rest } = el;
      return rest as CanvasElement;
    }));
    this.selectedElementIds.set(this.selectedElementId() ? [this.selectedElementId()!] : []);
    this.saveStateToHistory();
  }

  fitGroupBackgroundToMembers(elementId: string) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected?.layoutGroupId) return;

    const background = this.getLayoutGroupBackground(selected);
    const members = this.getLayoutGroupElements(selected).filter(el => el.layoutGroupRole === 'member');
    if (!background || members.length === 0) return;

    const padding = background.groupPadding ?? 24;
    const minX = Math.min(...members.map(el => el.x));
    const minY = Math.min(...members.map(el => el.y));
    const maxX = Math.max(...members.map(el => el.x + el.width));
    const maxY = Math.max(...members.map(el => el.y + el.height));

    this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => {
      if (el.id !== background.id) return el;
      return {
        ...el,
        x: minX - padding,
        y: minY - padding,
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2)
      };
    })));
    this.saveStateToHistory();
  }

  toggleGroupLockFromContext(elementId: string) {
    const element = this.elements().find(el => el.id === elementId);
    if (!element?.layoutGroupId) return;
    this.setLayoutGroupLocked(elementId, !this.getLayoutGroupLockState(element));
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  ungroupLayoutGroupFromContext(elementId: string) {
    this.ungroupLayoutGroup(elementId);
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }

  updateRelativeLayout(
    elementId: string,
    prop: 'relativeToElementId' | 'relativeSide' | 'relativeGap' | 'relativeMatchSize',
    value: any
  ) {
    this.elements.update(els => {
      const source = els.find(el => el.id === elementId);
      if (!source) return els;

      const nextElements = els.map(el => {
        if (el.id !== elementId) return el;

        if (prop === 'relativeToElementId') {
          const targetId = value ? String(value) : '';
          if (!targetId || targetId === elementId || !els.some(option => option.id === targetId) || this.wouldCreateRelativeCycle(elementId, targetId, els)) {
            const { relativeToElementId, relativeSide, relativeGap, relativeMatchSize, ...rest } = el;
            return rest as CanvasElement;
          }

          return {
            ...el,
            relativeToElementId: targetId,
            relativeSide: this.normalizeRelativeSide(el.relativeSide),
            relativeGap: this.normalizeRelativeGap(el.relativeGap),
            relativeMatchSize: !!el.relativeMatchSize
          };
        }

        if (!el.relativeToElementId) return el;
        if (prop === 'relativeSide') return { ...el, relativeSide: this.normalizeRelativeSide(value) };
        if (prop === 'relativeGap') return { ...el, relativeGap: this.normalizeRelativeGap(value) };
        return { ...el, relativeMatchSize: !!value };
      });

      return this.applyRelativeLayoutToElements(nextElements);
    });
    this.saveStateToHistory();
  }

  clearRelativeLayout(elementId: string) {
    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;
      const { relativeToElementId, relativeSide, relativeGap, relativeMatchSize, ...rest } = el;
      return rest as CanvasElement;
    }));
    this.saveStateToHistory();
  }

  toggleBoxShadow(elementId: string, enabled: boolean) {
    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;
      return {
        ...el,
        styles: {
          ...el.styles,
          boxShadow: enabled ? (el.styles.boxShadow || { x: 0, y: 12, blur: 28, color: '#000000' }) : undefined
        }
      };
    }));
    this.saveStateToHistory();
  }

  updateBoxShadowProperty(elementId: string, prop: keyof Shadow, value: any) {
    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;
      const current = el.styles.boxShadow || { x: 0, y: 12, blur: 28, color: '#000000' };
      const nextValue = prop === 'color' ? String(value || '#000000') : this.normalizeCssLength(value, current[prop] as number, prop === 'blur' ? 0 : -500, 500);
      return {
        ...el,
        styles: {
          ...el.styles,
          boxShadow: {
            ...current,
            [prop]: nextValue
          }
        }
      };
    }));
    this.saveStateToHistory();
  }

  toggleContentShadow(elementId: string, enabled: boolean) {
    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;
      return {
        ...el,
        styles: {
          ...el.styles,
          contentShadow: enabled ? (el.styles.contentShadow || el.styles.textShadow || { x: 0, y: 6, blur: 12, color: '#000000' }) : undefined
        }
      };
    }));
    this.saveStateToHistory();
  }

  updateContentShadowProperty(elementId: string, prop: keyof Shadow, value: any) {
    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;
      const current = el.styles.contentShadow || { x: 0, y: 6, blur: 12, color: '#000000' };
      const nextValue = prop === 'color' ? String(value || '#000000') : this.normalizeCssLength(value, current[prop] as number, prop === 'blur' ? 0 : -500, 500);
      return {
        ...el,
        styles: {
          ...el.styles,
          contentShadow: {
            ...current,
            [prop]: nextValue
          }
        }
      };
    }));
    this.saveStateToHistory();
  }

  toggleContentStroke(elementId: string, enabled: boolean) {
    this.elements.update(els => els.map(el => {
      if (el.id !== elementId) return el;
      const width = this.normalizeCssLength(el.styles.contentStrokeWidth ?? el.styles.textStrokeWidth, 0, 0, 100);
      return {
        ...el,
        styles: {
          ...el.styles,
          contentStrokeEnabled: enabled,
          contentStrokeWidth: enabled ? (width > 0 ? width : 1) : width,
          contentStrokeUnit: this.normalizeFontSizeUnit(el.styles.contentStrokeUnit ?? el.styles.textStrokeUnit),
          contentStrokeColor: el.styles.contentStrokeColor || el.styles.textStrokeColor || '#000000',
          contentStrokePosition: this.normalizeStrokePosition(el.styles.contentStrokePosition)
        }
      };
    }));
    this.saveStateToHistory();
  }

  updateCastBubbleSize(elementId: string, value: number) {
    this.elements.update(els => els.map(el => el.id === elementId && el.type === 'tmdb-cast'
      ? { ...el, castBubbleSize: this.normalizeCastBubbleSize(value) }
      : el
    ));
    this.saveStateToHistory();
  }

  updateCastCount(elementId: string, value: number) {
    this.elements.update(els => els.map(el => el.id === elementId && el.type === 'tmdb-cast'
      ? { ...el, castCount: this.normalizeCastCount(value) }
      : el
    ));
    this.saveStateToHistory();
  }

  updateTransitionSetting(elementId: string, prop: 'transitionEffect' | 'transitionDurationMs' | 'transitionDelayMs', value: any) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected) return;

    const groupSource = this.getLayoutGroupLockState(selected) ? this.getLayoutGroupTransitionSource(selected) : null;
    const targetId = groupSource?.id || elementId;
    this.elements.update(els => els.map(el => {
      if (el.id !== targetId) return el;
      const nextValue = prop === 'transitionEffect'
        ? this.normalizeTransitionEffect(value)
        : this.normalizeTransitionDurationMs(value, prop === 'transitionDelayMs' ? 0 : 500);
      return {
        ...el,
        [prop]: nextValue,
        groupTransitionEnabled: el.layoutGroupId && this.getLayoutGroupLockState(selected)
          ? this.normalizeTransitionEffect(prop === 'transitionEffect' ? nextValue : el.transitionEffect) !== 'none'
          : el.groupTransitionEnabled
      };
    }));
    this.saveStateToHistory();

    const latestElements = this.elements();
    const latestTarget = latestElements.find(el => el.id === targetId);
    if (latestTarget?.type === 'tmdb-backdrop-slideshow' && this.previewSlideshowTransition(latestTarget.id)) return;
    const backdropMaster = latestTarget ? this.getBackdropSlideshowMasterForElement(latestTarget, latestElements) : null;
    if (backdropMaster && this.previewSlideshowTransition(backdropMaster.id)) return;
    this.triggerElementTransitions([elementId]);
  }

  private getGlobalDiscoverFiltersForType(type: TmdbCollectionType): DiscoverFilters {
    return type === 'tv'
      ? this.normalizeDiscoverFilters(this.globalDiscoverFilters().tv)
      : this.normalizeDiscoverFilters(this.globalDiscoverFilters().movie);
  }

  private globalCollectionItemType(type = this.globalCollectionType()): TmdbItemType {
    return type === 'tv' ? 'tv' : 'movie';
  }

  private applyGlobalCollectionSettingsToElements(saveHistory = true) {
    const collectionType = this.globalCollectionType();
    const endpoint = this.getGlobalCollectionEndpointForType(collectionType);
    const itemType = this.globalCollectionItemType(collectionType);
    const itemLimit = this.globalCollectionItemLimit();
    const slideshowDurationMs = this.globalSlideshowDurationMs();
    const discoverFilters = this.getGlobalDiscoverFiltersForType(collectionType);
    const collectionIds: string[] = [];

    this.elements.update(els => els.map(el => {
      if (!this.isCollectionElement(el)) {
        return el.type.startsWith('tmdb-') && !el.linkGroup
          ? { ...el, linkGroup: this.defaultCollectionLinkGroup }
          : el;
      }
      collectionIds.push(el.id);
      return {
        ...el,
        linkGroup: this.defaultCollectionLinkGroup,
        syncedToElementId: undefined,
        tmdbCollectionType: collectionType,
        tmdbItemType: itemType,
        tmdbEndpoint: endpoint,
        discoverFilters,
        collectionItemLimit: itemLimit,
        slideshowDurationMs: el.type === 'tmdb-backdrop-slideshow' ? slideshowDurationMs : el.slideshowDurationMs,
        tmdbData: null
      };
    }));

    collectionIds.forEach(id => this.fetchTmdbDataForElement(id));
    if (saveHistory && (collectionIds.length > 0 || this.hasGlobalSlideshowTargets())) this.saveStateToHistory();
  }

  updateGlobalCollectionType(value: TmdbCollectionType) {
    const type = this.normalizeCollectionType(value);
    this.globalCollectionType.set(type);
    this.globalCollectionEndpoints.update(endpoints => ({
      ...endpoints,
      [type]: this.normalizeCollectionEndpoint(type, endpoints[type])
    }));
    this.applyGlobalCollectionSettingsToElements();
  }

  updateGlobalCollectionEndpoint(value: string) {
    const type = this.globalCollectionType();
    this.updateGlobalCollectionEndpointForType(type, value);
  }

  updateGlobalCollectionEndpointForType(type: TmdbCollectionType, value: string) {
    this.globalCollectionEndpoints.update(endpoints => ({
      ...endpoints,
      [type]: this.normalizeCollectionEndpoint(type, value)
    }));
    this.applyGlobalCollectionSettingsToElements();
  }

  updateGlobalCollectionItemLimit(value: number) {
    this.globalCollectionItemLimit.set(this.normalizeCollectionItemLimit(value));
    this.applyGlobalCollectionSettingsToElements();
  }

  updateGlobalSlideshowDuration(seconds: number) {
    this.globalSlideshowDurationMs.set(this.normalizeSlideshowDurationMs(Number(seconds) * 1000));
    this.applyGlobalCollectionSettingsToElements();
    this.setupGlobalSlideshowRuntime();
  }

  updateGlobalDiscoverFilter(prop: keyof DiscoverFilters, value: any) {
    const type = this.globalCollectionType();
    if (type === 'mixed') return;

    this.globalDiscoverFilters.update(filters => {
      const current = this.normalizeDiscoverFilters(filters[type]);
      return {
        ...filters,
        [type]: this.normalizeDiscoverFilters({
          ...current,
          [prop]: prop === 'year' ? (value ? Number(value) : null) : value
        })
      };
    });
    this.applyGlobalCollectionSettingsToElements();
  }

  toggleGlobalDiscoverGenre(genreId: number, checked: boolean) {
    const type = this.globalCollectionType();
    if (type === 'mixed') return;

    this.globalDiscoverFilters.update(filters => {
      const current = this.normalizeDiscoverFilters(filters[type]);
      const nextGenres = checked
        ? Array.from(new Set([...current.genres, genreId]))
        : current.genres.filter(id => id !== genreId);
      return {
        ...filters,
        [type]: {
          ...current,
          genres: nextGenres
        }
      };
    });
    this.applyGlobalCollectionSettingsToElements();
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

  updateSlideshowDuration(elementId: string, seconds: number) {
    const selected = this.elements().find(el => el.id === elementId);
    if (!selected) return;

    const master = this.getSlideshowMasterForElement(selected);
    if (!master) return;

    const durationMs = this.normalizeSlideshowDurationMs(Number(seconds) * 1000);
    this.elements.update(els => els.map(el => el.id === master.id ? { ...el, slideshowDurationMs: durationMs } : el));
    this.setupSlideshow(master.id);
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

    this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => {
      if (el.id !== id) return el;
      return {
        ...el,
        x: (canvasW - width) / 2,
        y: (canvasH - height) / 2,
        width,
        height
      };
    })));
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
    this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => {
      if (el.id === id) { const newEl = { ...el }; updateFn(newEl); return newEl; }
      return el;
    })));
    if(!noHistory) this.saveStateToHistory();
  }

  toggleVisibility(id: string) {
    this.elements.update(els => els.map(el => el.id === id ? {...el, visible: !el.visible} : el));
    this.saveStateToHistory();
  }

  private getLimitedCollectionItems(element: CanvasElement): any[] {
    const source = this.getEffectiveCollectionSourceElement(element);
    const results = source.tmdbData?.results;
    if (!Array.isArray(results) || results.length === 0) return [];

    return this.getLimitedCollectionItemsFromResults(element, results);
  }

  private getLimitedCollectionItemsFromResults(element: CanvasElement, results: any[]): any[] {
    if (!Array.isArray(results) || results.length === 0) return [];
    const limit = this.getEffectiveCollectionItemLimit(element);
    const source = this.getEffectiveCollectionSourceElement(element);
    const collectionType = source.tmdbCollectionType || element.tmdbCollectionType;
    let usableResults = results;
    if (element.type === 'tmdb-backdrop-slideshow') usableResults = usableResults.filter((item: any) => item.backdrop_path);
    if (element.type === 'tmdb-poster-scroll') usableResults = usableResults.filter((item: any) => item.poster_path);
    if (collectionType === 'mixed') usableResults = this.interleaveMixedCollectionItems(usableResults);
    return usableResults.slice(0, limit);
  }

  private interleaveMixedCollectionItems(results: any[]): any[] {
    const movies = results.filter((item: any) => this.resolveItemTypeFromSourceItem(item, 'movie') === 'movie');
    const shows = results.filter((item: any) => this.resolveItemTypeFromSourceItem(item, 'tv') === 'tv');
    const interleaved: any[] = [];
    const max = Math.max(movies.length, shows.length);
    for (let i = 0; i < max; i++) {
      if (movies[i]) interleaved.push(movies[i]);
      if (shows[i]) interleaved.push(shows[i]);
    }
    return interleaved;
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
    if (item?.first_air_date && !item?.release_date) return 'tv';
    if (item?.release_date && !item?.first_air_date) return 'movie';
    if (fallback === 'tv' || fallback === 'person') return fallback;
    return 'movie';
  }

  private detailKeyForItem(item: any, fallback?: TmdbCollectionType | TmdbItemType): string {
    if (!item?.id) return '';
    return `${this.resolveItemTypeFromSourceItem(item, fallback)}:${item.id}`;
  }

  private getCollectionItemDetail(sourceEl: CanvasElement, item: any): any {
    if (!item) return null;
    const source = this.getEffectiveCollectionSourceElement(sourceEl);
    const details = source.tmdbData?.__detailsById || {};
    const key = this.detailKeyForItem(item, source.tmdbCollectionType || source.tmdbItemType);
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

  private propagateSourceItemToLinkedGroup(sourceElementId: string, sourceEl: CanvasElement, item: any, animateTargets = false) {
    if (!sourceEl.linkGroup || !item?.id) return;
    const itemType = this.resolveItemTypeFromSourceItem(item, sourceEl.tmdbCollectionType || sourceEl.tmdbItemType);
    const detail = this.getCollectionItemDetail(sourceEl, item);
    const transitionTargetIds = this.elements()
      .filter(el => el.linkGroup === sourceEl.linkGroup && el.id !== sourceElementId && !this.isCollectionElement(el))
      .map(el => el.id);
    const hasEnrichedDetail = detail && !Array.isArray(detail.results) && (
      !!detail.credits ||
      !!detail.images ||
      !!detail.runtime ||
      !!detail.tagline ||
      !!detail.genres
    );

    const applyUpdate = () => {
      this.elements.update(els => els.map(el => {
        if (el.linkGroup !== sourceEl.linkGroup || el.id === sourceElementId || this.isCollectionElement(el)) return el;
        return {
          ...el,
          tmdbId: String(item.id),
          tmdbItemType: itemType,
          tmdbData: detail || item
        };
      }));
    };

    applyUpdate();
    if (animateTargets) this.triggerElementTransitions(transitionTargetIds);

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
      this.elements.update(els => els.map(el => el.id === elementId ? { ...el, linkGroup: '', syncedToElementId: undefined, tmdbData: null } : el));
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
            syncedToElementId: targetId,
            tmdbData: null
          };
        }
        return {
          ...el,
          linkGroup: groupId,
          syncedToElementId: targetId,
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

  // --- DRAG & DROP LAYERS (ORDERING) ---
  onLayerDragStart(event: DragEvent, elementId: string) {
    this.draggedLayerId.set(elementId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', elementId);
    }
  }

  onLayerDragEnd() {
    this.draggedLayerId.set(null);
    this.dragOverLayerId.set(null);
  }

  onLayerDragOver(event: DragEvent, targetId: string) {
    event.preventDefault();
    const draggedId = this.draggedLayerId();
    if (!draggedId || draggedId === targetId) return;
    this.dragOverLayerId.set(targetId);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onLayerDragLeave(event: DragEvent) { this.dragOverLayerId.set(null); }

  onLayerDrop(event: DragEvent, targetId: string) {
    event.preventDefault();
    this.dragOverLayerId.set(null);
    const draggedId = this.draggedLayerId();
    if (!draggedId || draggedId === targetId) {
      this.draggedLayerId.set(null);
      return;
    }
    this.reorderLayerByDrop(draggedId, targetId);
    this.draggedLayerId.set(null);
  }

  private reorderLayerByDrop(draggedId: string, targetId: string) {
    const order = this.getLayerOrder();
    const currentIndex = order.findIndex(el => el.id === draggedId);
    const targetIndex = order.findIndex(el => el.id === targetId);
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return;

    const [moved] = order.splice(currentIndex, 1);
    const insertIndex = order.findIndex(el => el.id === targetId);
    if (insertIndex < 0) return;
    order.splice(insertIndex, 0, moved);
    this.applyLayerOrder(order);
  }

  linkElements(sourceId: string, targetId: string) {
    this.syncElementWithLayer(sourceId, targetId);
  }

  unlinkElement(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.elements.update(els => els.map(el => el.id === id ? { ...el, linkGroup: '', syncedToElementId: undefined } : el));
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

  private enrichFirstEndpointItem(element: CanvasElement, data: any, headers: HttpHeaders): Observable<any> {
    if (!data || !Array.isArray(data.results) || data.results.length === 0) return of(data);
    const item = data.results.find((result: any) => result?.id) || data.results[0];
    if (!item?.id) return of(data);

    const fallbackType = element.tmdbCollectionType || element.tmdbItemType || 'movie';
    return this.http.get<any>(this.buildTmdbDetailUrl(item, fallbackType), { headers }).pipe(
      catchError(() => of(item)),
      map(detail => detail || item)
    );
  }

  private createTmdbRequestContext(): { headers: HttpHeaders; params: URLSearchParams } {
    let headers = new HttpHeaders({'Content-Type': 'application/json;charset=utf-8'});
    const params = new URLSearchParams({ language: this.language(), include_adult: this.includeAdult().toString() });

    if (this.authMethod() === 'v4') {
      headers = headers.set('Authorization', `Bearer ${this.tmdbReadToken()}`);
    } else {
      params.append('api_key', this.tmdbApiKey());
    }

    return { headers, params };
  }

  private fetchCollectionEndpointData(
    endpoint: string,
    collectionType: 'movie' | 'tv',
    headers: HttpHeaders,
    baseParams: URLSearchParams,
    itemLimit: number
  ): Observable<any> {
    const normalizedEndpoint = this.normalizeCollectionEndpoint(collectionType, endpoint);
    const pageCount = Math.max(1, Math.ceil(itemLimit / 20));
    const endpointFilters = this.getGlobalDiscoverFiltersForType(collectionType);
    const buildCollectionUrl = (page: number) => {
      const pageParams = new URLSearchParams(baseParams.toString());
      if (normalizedEndpoint.startsWith('discover')) {
        pageParams.append('sort_by', endpointFilters.sortBy);
        if (endpointFilters.genres.length > 0) pageParams.append('with_genres', endpointFilters.genres.join(','));
        const yearKey = collectionType === 'movie' ? 'primary_release_year' : 'first_air_date_year';
        if (endpointFilters.year) pageParams.append(yearKey, endpointFilters.year.toString());
      }
      pageParams.append('watch_region', this.watchRegion());
      pageParams.set('page', page.toString());
      return `https://api.themoviedb.org/3/${normalizedEndpoint}?${pageParams.toString()}`;
    };

    const requests = Array.from({ length: pageCount }, (_, index) => this.http.get<any>(buildCollectionUrl(index + 1), { headers }));
    return (requests.length > 1 ? forkJoin(requests) : requests[0].pipe(map(response => [response]))).pipe(
      map(responses => {
        const first = responses[0] || {};
        return {
          ...first,
          results: responses
            .flatMap(response => Array.isArray(response?.results) ? response.results : [])
            .slice(0, itemLimit)
            .map((item: any) => ({ ...item, media_type: item?.media_type || collectionType }))
        };
      })
    );
  }

  private getGlobalSlideshowItems(data = this.globalSlideshowData()): any[] {
    const results = data?.results;
    if (!Array.isArray(results) || results.length === 0) return [];
    return results.filter((item: any) => item?.id).slice(0, this.globalCollectionItemLimit());
  }

  private enrichGlobalSlideshowData(data: any, headers: HttpHeaders): Observable<any> {
    if (!data || !Array.isArray(data.results)) return of(data);

    const items = this.getGlobalSlideshowItems(data);
    if (items.length === 0) return of(data);

    const fallbackType = (data.__collectionType || this.globalCollectionType()) as TmdbCollectionType;
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

  private fetchGlobalSlideshowData() {
    if (!this.isApiConfigured() || !this.hasGlobalSlideshowTargets()) {
      this.clearGlobalSlideshowRuntime();
      return;
    }

    const requestToken = ++this.globalSlideshowFetchSequence;
    const { headers, params } = this.createTmdbRequestContext();
    const collectionType = this.globalCollectionType();
    const itemLimit = this.globalCollectionItemLimit();
    let obs: Observable<any>;

    if (collectionType === 'mixed') {
      obs = forkJoin([
        this.fetchCollectionEndpointData(this.getGlobalCollectionEndpointForType('movie'), 'movie', headers, params, itemLimit),
        this.fetchCollectionEndpointData(this.getGlobalCollectionEndpointForType('tv'), 'tv', headers, params, itemLimit)
      ]).pipe(
        map(([movieData, tvData]) => ({
          ...(movieData || tvData || {}),
          results: this.interleaveMixedCollectionItems([
            ...(Array.isArray(movieData?.results) ? movieData.results : []),
            ...(Array.isArray(tvData?.results) ? tvData.results : [])
          ]).slice(0, itemLimit),
          __collectionType: 'mixed'
        })),
        switchMap(data => this.enrichGlobalSlideshowData(data, headers))
      );
    } else {
      obs = this.fetchCollectionEndpointData(
        this.getGlobalCollectionEndpointForType(collectionType),
        collectionType,
        headers,
        params,
        itemLimit
      ).pipe(
        map(data => ({ ...data, __collectionType: collectionType })),
        switchMap(data => this.enrichGlobalSlideshowData(data, headers))
      );
    }

    obs.pipe(catchError(() => of(null)), takeUntil(this.destroy$)).subscribe(data => {
      if (!data || requestToken !== this.globalSlideshowFetchSequence) return;
      if (!this.hasGlobalSlideshowTargets()) return;
      this.globalSlideshowData.set(data);
      this.setupGlobalSlideshowRuntime();
      this.cdr.detectChanges();
    });
  }

  private setupGlobalSlideshowRuntime() {
    this.clearGlobalSlideshowRuntime(false);
    const runToken = this.globalSlideshowRunToken;
    const data = this.globalSlideshowData();
    const items = this.getGlobalSlideshowItems(data);
    if (items.length === 0 || !this.hasGlobalSlideshowTargets()) return;

    this.globalSlideshowIndex = 0;
    void this.propagateGlobalSlideshowItem(items[0], runToken);
    if (items.length < 2) return;

    const durationMs = this.globalSlideshowDurationMs();
    this.globalSlideshowInterval = setInterval(() => {
      if (this.globalSlideshowRunToken !== runToken) return;
      const latestItems = this.getGlobalSlideshowItems();
      if (latestItems.length === 0 || !this.hasGlobalSlideshowTargets()) {
        this.clearGlobalSlideshowRuntime();
        return;
      }
      this.globalSlideshowIndex = (this.globalSlideshowIndex + 1) % latestItems.length;
      void this.propagateGlobalSlideshowItem(latestItems[this.globalSlideshowIndex], runToken);
    }, durationMs);
  }

  private async propagateGlobalSlideshowItem(item: any, runToken = this.globalSlideshowRunToken) {
    if (!item?.id) return;

    const data = this.globalSlideshowData();
    const fallbackType = (data?.__collectionType || this.globalCollectionType()) as TmdbCollectionType;
    const itemType = this.resolveItemTypeFromSourceItem(item, fallbackType);
    const details = data?.__detailsById || {};
    const key = this.detailKeyForItem(item, fallbackType);
    const detail = details[key] || details[String(item.id)] || item;
    const targets = this.elements().filter(el => this.isGlobalSlideshowTarget(el));
    const targetIds = targets.map(el => el.id);

    if (targetIds.length === 0) return;
    const applySequence = ++this.globalSlideshowApplySequence;
    await this.preloadGlobalTargetMedia(targets, detail);
    if (this.globalSlideshowRunToken !== runToken || this.globalSlideshowApplySequence !== applySequence) return;

    const stagedBackdropIds = new Set(this.prepareDynamicBackdropTransitions(targets, detail));
    this.elements.update(els => els.map(el => {
      if (!this.isGlobalSlideshowTarget(el, els)) return el;
      return {
        ...el,
        tmdbId: String(item.id),
        tmdbItemType: itemType,
        tmdbCollectionType: itemType === 'tv' ? 'tv' : 'movie',
        tmdbEndpoint: undefined,
        tmdbData: detail
      };
    }));
    this.triggerElementTransitions(targetIds);
    this.cdr.detectChanges();
    this.startDynamicBackdropTransitions(Array.from(stagedBackdropIds));
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
              return { ...el, tmdbId: tmdbId, tmdbItemType: itemType, tmdbEndpoint: undefined, tmdbData: null };
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
    } else if (this.isCollectionElement(element) && element.tmdbCollectionType === 'mixed') {
        const itemLimit = this.getEffectiveCollectionItemLimit(element);
        const pageCount = Math.ceil(itemLimit / 20);
        const fetchCollectionEndpoint = (endpoint: string, collectionType: 'movie' | 'tv') => {
          const endpointFilters = this.getGlobalDiscoverFiltersForType(collectionType);
          const buildCollectionUrl = (page: number) => {
            const pageParams = new URLSearchParams(params.toString());
            if (endpoint.startsWith('discover')) {
              pageParams.append('sort_by', endpointFilters.sortBy);
              if (endpointFilters.genres.length > 0) pageParams.append('with_genres', endpointFilters.genres.join(','));
              const yearKey = collectionType === 'movie' ? 'primary_release_year' : 'first_air_date_year';
              if (endpointFilters.year) pageParams.append(yearKey, endpointFilters.year.toString());
            }
            pageParams.append('watch_region', this.watchRegion());
            pageParams.set('page', page.toString());
            return `https://api.themoviedb.org/3/${endpoint}?${pageParams.toString()}`;
          };

          const requests = Array.from({ length: pageCount }, (_, index) => this.http.get<any>(buildCollectionUrl(index + 1), { headers }));
          return (requests.length > 1 ? forkJoin(requests) : requests[0].pipe(map(response => [response]))).pipe(
            map(responses => {
              const first = responses[0] || {};
              return {
                ...first,
                results: responses
                  .flatMap(response => Array.isArray(response?.results) ? response.results : [])
                  .slice(0, itemLimit)
                  .map((item: any) => ({ ...item, media_type: collectionType }))
              };
            })
          );
        };

        obs = forkJoin([
          fetchCollectionEndpoint(this.getGlobalCollectionEndpointForType('movie'), 'movie'),
          fetchCollectionEndpoint(this.getGlobalCollectionEndpointForType('tv'), 'tv')
        ]).pipe(
          map(([movieData, tvData]) => ({
            ...(movieData || tvData || {}),
            results: this.interleaveMixedCollectionItems([
              ...(Array.isArray(movieData?.results) ? movieData.results : []),
              ...(Array.isArray(tvData?.results) ? tvData.results : [])
            ]),
            __collectionType: 'mixed'
          })),
          switchMap(data => this.enrichCollectionDataForLinkedScene(element, data, headers))
        );
    } else if (element.tmdbEndpoint) {
        if (element.tmdbEndpoint.startsWith('discover')) {
          params.append('sort_by', element.discoverFilters.sortBy);
          if (element.discoverFilters.genres.length > 0) params.append('with_genres', element.discoverFilters.genres.join(','));
          const yearKey = element.tmdbCollectionType === 'movie' ? 'primary_release_year' : 'first_air_date_year';
          if (element.discoverFilters.year) params.append(yearKey, element.discoverFilters.year.toString());
        }
        params.append('watch_region', this.watchRegion());
        const itemLimit = this.isCollectionElement(element) ? this.getEffectiveCollectionItemLimit(element) : 1;
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

        obs = obs.pipe(
          switchMap(data => this.isCollectionElement(element)
            ? this.enrichCollectionDataForLinkedScene(element, data, headers)
            : this.enrichFirstEndpointItem(element, data, headers)
          )
        );
    } else { return; }

    obs.pipe(catchError(() => of(null)), takeUntil(this.destroy$)).subscribe(data => {
      if (!data) return;
      if (this.tmdbFetchTokens.get(id) !== requestToken) return;
      const latest = this.elements().find(el => el.id === id);
      if (!latest) return;
      if (!this.isCollectionElement(latest)) {
        if (requestEndpoint && (latest.tmdbEndpoint || '') !== requestEndpoint) return;
        if (requestTmdbId && String(latest.tmdbId || '') !== requestTmdbId) return;
        if (latest.tmdbItemType !== requestItemType) return;
      } else if ((latest.tmdbEndpoint || '') !== requestEndpoint) {
        return;
      }

      this.elements.update(els => els.map(el => el.id === id ? {...el, tmdbData: data} : el));
      const latestElements = this.elements();
      const collectionViews = this.isCollectionElement(element)
        ? latestElements.filter(el => this.isCollectionElement(el) && this.getEffectiveCollectionSourceElement(el, latestElements).id === id)
        : [element];
      collectionViews.forEach(el => {
        if (el.type === 'tmdb-backdrop-slideshow') this.setupSlideshow(el.id);
        if (el.type === 'tmdb-poster-scroll') this.setupPosterScroll(el.id);
      });
      this.triggerElementTransitions(collectionViews.map(el => el.id));
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
      this.clearCollectionRuntime(elementId);
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

  private preloadSlideshowImage(url: string | undefined): Promise<void> {
    if (!url) return Promise.resolve();
    const existing = this.slideshowImagePreloads.get(url);
    if (existing) return existing;

    const promise = new Promise<void>(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const decoded = typeof img.decode === 'function'
          ? img.decode().catch(() => undefined)
          : Promise.resolve();
        decoded.then(() => resolve());
      };
      img.onerror = () => resolve();
      img.src = url;
    });
    this.slideshowImagePreloads.set(url, promise);
    return promise;
  }

  private warmSlideshowImages(urls: Array<string | undefined>) {
    urls.forEach(url => void this.preloadSlideshowImage(url));
  }

  private getBackdropImageUrlFromData(data: any): string | undefined {
    return data?.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + data.backdrop_path : undefined;
  }

  private getBestLogoUrlFromData(data: any): string | undefined {
    const logos = data?.images?.logos;
    if (!Array.isArray(logos) || logos.length === 0) return undefined;
    const langLogo = logos.find((logo: any) => logo.iso_639_1 === this.language().substring(0, 2));
    const englishLogo = logos.find((logo: any) => logo.iso_639_1 === 'en');
    const chosenLogo = langLogo || englishLogo || logos[0];
    return chosenLogo?.file_path ? 'https://image.tmdb.org/t/p/w500' + chosenLogo.file_path : undefined;
  }

  private getGlobalTargetMediaPreloadUrl(element: CanvasElement, data: any): string | undefined {
    switch (element.type) {
      case 'tmdb-backdrop':
        return this.getBackdropImageUrlFromData(data);
      case 'tmdb-poster':
        return data?.poster_path ? 'https://image.tmdb.org/t/p/w500' + data.poster_path : undefined;
      case 'tmdb-logo':
        return this.getBestLogoUrlFromData(data);
      case 'tmdb-network-logo':
        return data?.networks?.[0]?.logo_path ? 'https://image.tmdb.org/t/p/w300' + data.networks[0].logo_path : undefined;
      default:
        return undefined;
    }
  }

  private preloadGlobalTargetMedia(targets: CanvasElement[], data: any): Promise<void> {
    const urls = Array.from(new Set(targets.map(target => this.getGlobalTargetMediaPreloadUrl(target, data)).filter((url): url is string => !!url)));
    if (urls.length === 0) return Promise.resolve();
    return Promise.all(urls.map(url => this.preloadSlideshowImage(url))).then(() => undefined);
  }

  private clearDynamicBackdropTransitionTimeout(elementId: string) {
    const timeout = this.dynamicBackdropTransitionTimeouts.get(elementId);
    if (!timeout) return;
    clearTimeout(timeout);
    this.dynamicBackdropTransitionTimeouts.delete(elementId);
  }

  private clearDynamicBackdropTransitions(elementId?: string) {
    if (elementId) {
      this.clearDynamicBackdropTransitionTimeout(elementId);
      this.dynamicBackdropTransitions.update(states => {
        if (!states[elementId]) return states;
        const { [elementId]: _removed, ...rest } = states;
        return rest;
      });
      return;
    }

    this.dynamicBackdropTransitionTimeouts.forEach(timeout => clearTimeout(timeout));
    this.dynamicBackdropTransitionTimeouts.clear();
    this.dynamicBackdropTransitions.set({});
  }

  private prepareDynamicBackdropTransitions(targets: CanvasElement[], data: any): string[] {
    const nextUrl = this.getBackdropImageUrlFromData(data);
    if (!nextUrl) return [];

    const currentStates = this.dynamicBackdropTransitions();
    const nextStates = { ...currentStates };
    const stagedIds: string[] = [];
    let changed = false;

    targets.forEach(target => {
      if (target.type !== 'tmdb-backdrop') return;
      if (this.getBackdropSlideshowStateForElement(target)) return;
      if (!this.isSlideshowTransitionEnabled(target)) {
        if (nextStates[target.id]) {
          delete nextStates[target.id];
          changed = true;
        }
        return;
      }

      const currentUrl = this.getBackdropImageUrlFromData(target.tmdbData);
      if (!currentUrl || currentUrl === nextUrl) {
        if (nextStates[target.id]) {
          delete nextStates[target.id];
          changed = true;
        }
        return;
      }

      this.clearDynamicBackdropTransitionTimeout(target.id);
      nextStates[target.id] = {
        currentUrl,
        underlayUrl: nextUrl,
        fade: false,
        resetting: false,
        version: (currentStates[target.id]?.version || 0) + 1
      };
      stagedIds.push(target.id);
      changed = true;
    });

    if (changed) this.dynamicBackdropTransitions.set(nextStates);
    return stagedIds;
  }

  private startDynamicBackdropTransitions(elementIds: string[]) {
    if (elementIds.length === 0) return;
    requestAnimationFrame(() => {
      const versions = new Map<string, number>();
      this.dynamicBackdropTransitions.update(states => {
        const next = { ...states };
        elementIds.forEach(id => {
          const state = next[id];
          if (!state) return;
          versions.set(id, state.version);
          next[id] = { ...state, fade: true, resetting: false };
        });
        return next;
      });
      this.cdr.detectChanges();
      elementIds.forEach(id => {
        const version = versions.get(id);
        if (version !== undefined) this.scheduleDynamicBackdropTransitionCleanup(id, version);
      });
    });
  }

  private scheduleDynamicBackdropTransitionCleanup(elementId: string, version: number) {
    this.clearDynamicBackdropTransitionTimeout(elementId);
    const element = this.elements().find(el => el.id === elementId);
    const transitionMs = element
      ? this.getEffectiveTransitionDelayMs(element) + this.getEffectiveTransitionDurationMs(element)
      : 500;

    const timeout = setTimeout(() => {
      this.dynamicBackdropTransitionTimeouts.delete(elementId);
      this.dynamicBackdropTransitions.update(states => {
        if (states[elementId]?.version !== version) return states;
        const { [elementId]: _removed, ...rest } = states;
        return rest;
      });
      this.cdr.detectChanges();
    }, Math.max(0, transitionMs) + 120);

    this.dynamicBackdropTransitionTimeouts.set(elementId, timeout);
  }

  setupSlideshow(elementId: string) {
    this.clearCollectionRuntime(elementId);
    const runToken = this.createSlideshowRunToken(elementId);

    const element = this.elements().find(e => e.id === elementId);
    if (!element) return;

    const slideItems = this.getLimitedCollectionItems(element);
    const backdrops = slideItems.map((item: any) => 'https://image.tmdb.org/t/p/w1280' + item.backdrop_path);
    if (backdrops.length === 0) return;

    this.warmSlideshowImages([backdrops[0], backdrops[1], backdrops[2]]);
    this.slideshowState.update(s => ({...s, [elementId]: { idx1: 0, idx2: backdrops.length > 1 ? 1 : 0, fade: false, resetting: false, sceneFade: false, backdrops, items: slideItems }}));
    this.propagateSourceItemToLinkedGroup(elementId, element, slideItems[0]);

    if (backdrops.length < 2) return;

    const slideshowDurationMs = this.getEffectiveSlideshowDurationMs(element);
    let isAdvancing = false;
    const scheduleNextSlide = () => {
      if (!this.isCurrentSlideshowRun(elementId, runToken)) return;
      this.clearSlideshowTimeout(this.slideshowIntervals, elementId);
      const timeout = setTimeout(() => advanceSlide(), slideshowDurationMs);
      this.slideshowIntervals.set(elementId, timeout);
    };
    this.slideshowNextSchedulers.set(elementId, scheduleNextSlide);

    const advanceSlide = () => {
        this.slideshowIntervals.delete(elementId);
        if (!this.isCurrentSlideshowRun(elementId, runToken)) return;
        if (isAdvancing) {
          scheduleNextSlide();
          return;
        }
        const el = this.elements().find(e => e.id === elementId);
        const state = this.slideshowState()[elementId];
        if (!el || !state) return;
        if (state.fade || state.resetting) {
          scheduleNextSlide();
          return;
        }

        isAdvancing = true;
        void this.preloadSlideshowImage(state.backdrops[state.idx2]).then(() => {
          if (!this.isCurrentSlideshowRun(elementId, runToken)) return;
          const latestEl = this.elements().find(e => e.id === elementId);
          const latestState = this.slideshowState()[elementId];
          if (!latestEl || !latestState || latestState.fade || latestState.resetting) {
            isAdvancing = false;
            scheduleNextSlide();
            return;
          }

          const nextItem = latestState.items[latestState.idx2];
          if (nextItem) this.propagateSourceItemToLinkedGroup(elementId, latestEl, nextItem, true);

          const transitionMs = this.getBackdropSlideshowRuntimeTransitionMs(latestEl);

          if (transitionMs <= 0) {
            this.completeSlideshowTransition(elementId, runToken);
            isAdvancing = false;
            scheduleNextSlide();
            return;
          }

          this.slideshowState.update(s => {
            const current = s[elementId];
            return current ? {...s, [elementId]: { ...current, fade: true, resetting: false, sceneFade: false } } : s;
          });
          this.cdr.detectChanges();
          this.scheduleSlideshowCompletion(elementId, transitionMs + 50, runToken, () => {
            isAdvancing = false;
            scheduleNextSlide();
          });
        });
    };

    scheduleNextSlide();
  }

  // --- UI & INTERACTION ---
  private getResizedBounds(element: CanvasElement, bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
  }) {
    const increment = this.getSnapIncrement(element);
    let x = element.snapToGrid ? this.snapValue(bounds.x, increment) : bounds.x;
    let y = element.snapToGrid ? this.snapValue(bounds.y, increment) : bounds.y;
    let width = Math.max(20, element.snapToGrid ? this.snapValue(bounds.width, increment) : bounds.width);
    let height = Math.max(20, element.snapToGrid ? this.snapValue(bounds.height, increment) : bounds.height);

    if (element.type === 'tmdb-poster' && element.maintainAspectRatio !== false) {
      const widthDelta = Math.abs(width - bounds.startWidth);
      const heightDelta = Math.abs(height - bounds.startHeight);

      if (widthDelta >= heightDelta) {
        height = width / this.posterAspectRatio;
      } else {
        width = height * this.posterAspectRatio;
      }

      if (bounds.edges.left && !bounds.edges.right) x = bounds.startX + bounds.startWidth - width;
      if (bounds.edges.top && !bounds.edges.bottom) y = bounds.startY + bounds.startHeight - height;

      if (element.snapToGrid) {
        x = this.snapValue(x, increment);
        y = this.snapValue(y, increment);
      }
    }

    return { x, y, width, height };
  }

  private setElementDragTransform(element: CanvasElement, x: number, y: number) {
    const node = document.getElementById(element.id);
    if (!node) return;
    node.style.transform = `translate(${x}px, ${y}px) rotate(${element.rotation || 0}deg)`;
  }

  private resetElementDragTransform(element: CanvasElement) {
    const node = document.getElementById(element.id);
    if (!node) return;
    node.style.transform = `rotate(${element.rotation || 0}deg)`;
  }

  private setupInteract() {
    if (typeof interact === 'undefined') return;

    interact('.draggable-element').unset();
    interact('.draggable-element').draggable({
      listeners: {
        move: (event: any) => {
          const scale = this.canvasConfig().scale;
          const target = event.target;
          const element = this.elements().find(el => el.id === target.id);
          if (!element) return;

          const rawX = (parseFloat(target.getAttribute('data-raw-x')) || 0) + (event.dx / scale);
          const rawY = (parseFloat(target.getAttribute('data-raw-y')) || 0) + (event.dy / scale);
          const x = element.snapToGrid ? this.snapValue(element.x + rawX, this.getSnapIncrement(element)) - element.x : rawX;
          const y = element.snapToGrid ? this.snapValue(element.y + rawY, this.getSnapIncrement(element)) - element.y : rawY;
          const lockedGroup = this.getLayoutGroupLockState(element)
            ? this.getLayoutGroupElements(element).filter(el => el.visible)
            : [];

          if (lockedGroup.length > 0) {
            lockedGroup.forEach(el => this.setElementDragTransform(el, x, y));
          } else {
            this.setElementDragTransform(element, x, y);
          }
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
          target.setAttribute('data-raw-x', rawX);
          target.setAttribute('data-raw-y', rawY);
        },
        end: (event: any) => {
          const target = event.target;
          const element = this.elements().find(el => el.id === target.id);
          if (element) {
            const xOffset = (parseFloat(target.getAttribute('data-x')) || 0);
            const yOffset = (parseFloat(target.getAttribute('data-y')) || 0);
            const lockedGroup = this.getLayoutGroupLockState(element)
              ? this.getLayoutGroupElements(element)
              : [];

            if (lockedGroup.length > 0) {
              const groupIds = new Set(lockedGroup.map(el => el.id));
              this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => groupIds.has(el.id) ? {
                ...el,
                x: el.x + xOffset,
                y: el.y + yOffset
              } : el)));
              lockedGroup.forEach(el => this.resetElementDragTransform(el));
            } else {
              const newX = element.x + xOffset;
              const newY = element.y + yOffset;
              this.updateElementProperty('x', newX, true);
              this.updateElementProperty('y', newY, true);
              this.resetElementDragTransform(element);
            }

            target.removeAttribute('data-x');
            target.removeAttribute('data-y');
            target.removeAttribute('data-raw-x');
            target.removeAttribute('data-raw-y');
            this.saveStateToHistory();
          }
        }
      },
      modifiers: [interact.modifiers.restrictRect({ restriction: 'parent', endOnly: false })],
      inertia: false
    }).resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      listeners: {
        move: (event: any) => {
          const id = event.target.id;
          const scale = this.canvasConfig().scale;
          const target = event.target;
          this.elements.update(els => {
            const source = els.find(el => el.id === id);
            if (!source || this.isResizeLockedByGroup(source, els)) return els;

            if (!target.hasAttribute('data-resize-start-width')) {
              target.setAttribute('data-resize-start-x', source.x);
              target.setAttribute('data-resize-start-y', source.y);
              target.setAttribute('data-resize-start-width', source.width);
              target.setAttribute('data-resize-start-height', source.height);
              target.setAttribute('data-raw-resize-x', source.x);
              target.setAttribute('data-raw-resize-y', source.y);
              target.setAttribute('data-raw-resize-width', source.width);
              target.setAttribute('data-raw-resize-height', source.height);
              if (this.isLayoutGroupBackground(source) && this.getLayoutGroupLockState(source, els)) {
                target.setAttribute('data-group-resize-start', JSON.stringify(
                  this.getLayoutGroupElements(source, els).map(el => ({
                    id: el.id,
                    x: el.x,
                    y: el.y,
                    width: el.width,
                    height: el.height
                  }))
                ));
              }
            }

            const startX = parseFloat(target.getAttribute('data-resize-start-x')) || source.x;
            const startY = parseFloat(target.getAttribute('data-resize-start-y')) || source.y;
            const startWidth = parseFloat(target.getAttribute('data-resize-start-width')) || source.width;
            const startHeight = parseFloat(target.getAttribute('data-resize-start-height')) || source.height;
            const rawX = (parseFloat(target.getAttribute('data-raw-resize-x')) || source.x) + (event.deltaRect.left / scale);
            const rawY = (parseFloat(target.getAttribute('data-raw-resize-y')) || source.y) + (event.deltaRect.top / scale);
            const rawWidth = (parseFloat(target.getAttribute('data-raw-resize-width')) || source.width) + (event.deltaRect.width / scale);
            const rawHeight = (parseFloat(target.getAttribute('data-raw-resize-height')) || source.height) + (event.deltaRect.height / scale);

            target.setAttribute('data-raw-resize-x', rawX);
            target.setAttribute('data-raw-resize-y', rawY);
            target.setAttribute('data-raw-resize-width', rawWidth);
            target.setAttribute('data-raw-resize-height', rawHeight);

            const bounds = this.getResizedBounds(source, {
              x: rawX,
              y: rawY,
              width: rawWidth,
              height: rawHeight,
              startX,
              startY,
              startWidth,
              startHeight,
              edges: event.edges || {}
            });

            const groupStartRaw = target.getAttribute('data-group-resize-start');
            if (groupStartRaw && source.layoutGroupId) {
              try {
                const groupStart = JSON.parse(groupStartRaw) as Array<{id: string; x: number; y: number; width: number; height: number}>;
                const startBackground = groupStart.find(item => item.id === source.id);
                if (startBackground) {
                  const scaleX = bounds.width / Math.max(1, startBackground.width);
                  const scaleY = bounds.height / Math.max(1, startBackground.height);
                  const startById = new Map(groupStart.map(item => [item.id, item]));
                  return this.applyRelativeLayoutToElements(els.map(el => {
                    const start = startById.get(el.id);
                    if (!start) return el;
                    if (el.id === source.id) return { ...el, ...bounds };
                    return {
                      ...el,
                      x: bounds.x + ((start.x - startBackground.x) * scaleX),
                      y: bounds.y + ((start.y - startBackground.y) * scaleY),
                      width: Math.max(20, start.width * scaleX),
                      height: Math.max(20, start.height * scaleY)
                    };
                  }));
                }
              } catch {
                // Fall back to resizing only the source element if stored group data is invalid.
              }
            }

            return this.applyRelativeLayoutToElements(els.map(el => el.id === id ? { ...el, ...bounds } : el));
          });
        },
        end: (event: any) => {
          [
            'data-resize-start-x',
            'data-resize-start-y',
            'data-resize-start-width',
            'data-resize-start-height',
            'data-raw-resize-x',
            'data-raw-resize-y',
            'data-raw-resize-width',
            'data-raw-resize-height',
            'data-group-resize-start'
          ].forEach(attr => event.target.removeAttribute(attr));
          this.saveStateToHistory();
        }
      },
      modifiers: [interact.modifiers.restrictSize({ min: { width: 20, height: 20 } })],
      inertia: false
    });
  }

  openContextMenu(event: MouseEvent, elementId: string) {
    event.preventDefault(); event.stopPropagation();
    if (this.multiSelectMode()) {
      if (!this.isElementInMultiSelection(elementId)) {
        this.selectedElementIds.update(ids => [...ids, elementId]);
      }
      this.selectedElementId.set(elementId);
    } else {
      this.selectElement(elementId);
    }
    const menuWidth = 224;
    const menuHeight = 560;
    const x = event.clientX + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 10 : event.clientX;
    const y = event.clientY + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 10 : event.clientY;
    this.contextMenu.set({ visible: true, x, y, elementId });
  }

  openLayerContextMenu(event: MouseEvent, elementId: string) {
    this.openContextMenu(event, elementId);
  }

  duplicateElement(id: string) {
    const elToDup = this.elements().find(el => el.id === id);
    if (!elToDup) return;
    const newEl: CanvasElement = {
      ...JSON.parse(JSON.stringify(elToDup)),
      id: `el_${Date.now()}`,
      x: elToDup.x + 20,
      y: elToDup.y + 20,
      zIndex: this.elements().length + 1,
      layoutGroupId: undefined,
      layoutGroupRole: undefined,
      groupLocked: undefined,
      groupPadding: undefined,
      groupTransitionEnabled: undefined,
      relativeToElementId: undefined,
      relativeSide: undefined,
      relativeGap: undefined,
      relativeMatchSize: undefined
    };
    this.elements.update(els => [...els, newEl]);
    this.selectElement(newEl.id);
    this.saveStateToHistory();
  }

  copyStyles(id: string) { const el = this.elements().find(e => e.id === id); if (el) this.copiedStyles.set(JSON.parse(JSON.stringify(el.styles))); }
  pasteStyles(id: string) { const styles = this.copiedStyles(); if (!styles) return; this.elements.update(els => els.map(el => el.id === id ? { ...el, styles: { ...el.styles, ...styles } } : el)); this.saveStateToHistory(); }

  alignElement(id: string, type: 'fill' | 'fitW' | 'fitH' | 'center' | 'centerH' | 'centerV' | 'top' | 'bottom' | 'left' | 'right') {
    const { width, height } = this.canvasConfig();
    this.elements.update(els => this.applyRelativeLayoutToElements(els.map(el => {
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
    })));
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

  private safeFontSizeUnit(unit: any): FontSizeUnit {
    return this.normalizeFontSizeUnit(unit);
  }

  private normalizeExportDiscoverFilters(filters: DiscoverFilters | undefined): DiscoverFilters {
    return {
      sortBy: filters?.sortBy || 'popularity.desc',
      genres: (filters?.genres || []).map(Number).filter(Number.isFinite),
      year: filters?.year ? Number(filters.year) : null
    };
  }

  private buildGlobalCollectionExportSource() {
    const collectionType = this.globalCollectionType();
    const limit = this.globalCollectionItemLimit();

    if (collectionType === 'mixed') {
      return {
        kind: 'collection',
        collectionType: 'mixed',
        movieEndpoint: this.getGlobalCollectionEndpointForType('movie'),
        tvEndpoint: this.getGlobalCollectionEndpointForType('tv'),
        movieDiscoverFilters: this.normalizeExportDiscoverFilters(this.globalDiscoverFilters().movie),
        tvDiscoverFilters: this.normalizeExportDiscoverFilters(this.globalDiscoverFilters().tv),
        limit,
        enrichLinked: true,
        enrichFirst: false,
        ttl: 900
      };
    }

    return {
      kind: 'collection',
      endpoint: this.getGlobalCollectionEndpointForType(collectionType),
      collectionType,
      discoverFilters: this.normalizeExportDiscoverFilters(this.getGlobalDiscoverFiltersForType(collectionType)),
      limit,
      enrichLinked: true,
      enrichFirst: false,
      ttl: 900
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
      const isGlobalSourceTarget = this.isGlobalSlideshowTarget(el, elements);
      if (!this.isCollectionElement(el) && el.linkGroup && linkedCollectionGroups.has(el.linkGroup)) {
        continue;
      }

      const sourceEl = this.isCollectionElement(el)
        ? this.getEffectiveCollectionSourceElement(el, elements)
        : el;
      let source: any | null = null;
      if (isGlobalSourceTarget) {
        source = this.buildGlobalCollectionExportSource();
      } else if (sourceEl.tmdbId && sourceEl.tmdbItemType && !this.isCollectionElement(sourceEl)) {
        source = {
          kind: 'detail',
          itemType: sourceEl.tmdbItemType,
          tmdbId: String(sourceEl.tmdbId),
          ttl: 21600
        };
      } else if (this.isCollectionElement(sourceEl) && sourceEl.tmdbCollectionType === 'mixed') {
        source = {
          kind: 'collection',
          collectionType: 'mixed',
          movieEndpoint: this.getGlobalCollectionEndpointForType('movie'),
          tvEndpoint: this.getGlobalCollectionEndpointForType('tv'),
          movieDiscoverFilters: this.normalizeExportDiscoverFilters(this.globalDiscoverFilters().movie),
          tvDiscoverFilters: this.normalizeExportDiscoverFilters(this.globalDiscoverFilters().tv),
          limit: this.isCollectionElement(el) ? this.getEffectiveCollectionItemLimit(el, elements) : 1,
          enrichLinked: !!sourceEl.linkGroup && linkedCollectionGroups.has(sourceEl.linkGroup),
          enrichFirst: false,
          ttl: 900
        };
      } else if (sourceEl.tmdbEndpoint) {
        source = {
          kind: 'collection',
          endpoint: sourceEl.tmdbEndpoint,
          collectionType: sourceEl.tmdbCollectionType || 'movie',
          discoverFilters: this.normalizeExportDiscoverFilters(sourceEl.discoverFilters),
          limit: this.isCollectionElement(el) ? this.getEffectiveCollectionItemLimit(el, elements) : 1,
          enrichLinked: !!sourceEl.linkGroup && linkedCollectionGroups.has(sourceEl.linkGroup),
          enrichFirst: !this.isCollectionElement(sourceEl),
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
    const imagePreloads = new Map();
    const globalSlideshows = new Map();

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

    function preloadImage(src) {
        if (!src) return Promise.resolve();
        if (imagePreloads.has(src)) return imagePreloads.get(src);
        const promise = new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = src;
        });
        imagePreloads.set(src, promise);
        return promise;
    }

    function setText(el, value) {
        clearElement(el);
        const span = document.createElement('span');
        span.className = 'text-content';
        span.textContent = value === undefined || value === null ? '' : String(value);
        el.appendChild(span);
    }

    function appendImage(el, src, alt, fit) {
        clearElement(el);
        if (!src) return;
        const img = document.createElement('img');
        img.className = 'content-media';
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
        const type = item.media_type || (item.first_air_date && !item.release_date ? 'tv' : (item.release_date && !item.first_air_date ? 'movie' : (fallbackType === 'tv' ? 'tv' : 'movie')));
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

    function restartElementTransition(el) {
        const animation = el && el.dataset ? el.dataset.transitionAnimation : '';
        if (!animation) return;
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = animation;
    }

    function getBackdropLayerTransitionSettings(el) {
        const effect = el.dataset.transitionEffect || 'none';
        const duration = Math.max(0, Math.min(10000, Number(el.dataset.transitionDuration) || 0));
        const delay = Math.max(0, Math.min(10000, Number(el.dataset.transitionDelay) || 0));
        const useTransition = effect !== 'none' && duration > 0;
        return {
            effect,
            duration,
            delay,
            total: duration + delay,
            useTransition,
            transitionCss: useTransition
                ? 'opacity ' + duration + 'ms ease-in-out ' + delay + 'ms, transform ' + duration + 'ms cubic-bezier(0.22, 1, 0.36, 1) ' + delay + 'ms, filter ' + duration + 'ms ease-in-out ' + delay + 'ms'
                : 'none'
        };
    }

    function getBackdropExitStyles(effect) {
        switch (effect) {
            case 'fade': return { opacity: '0', transform: 'none', filter: 'none' };
            case 'slide-left': return { opacity: '1', transform: 'translateX(-100%)', filter: 'none' };
            case 'slide-right': return { opacity: '1', transform: 'translateX(100%)', filter: 'none' };
            case 'slide-up': return { opacity: '1', transform: 'translateY(-100%)', filter: 'none' };
            case 'slide-down': return { opacity: '1', transform: 'translateY(100%)', filter: 'none' };
            case 'zoom': return { opacity: '0', transform: 'scale(1.08)', filter: 'none' };
            case 'blur': return { opacity: '0', transform: 'none', filter: 'blur(12px)' };
            case 'flip': return { opacity: '0', transform: 'perspective(800px) rotateY(14deg)', filter: 'none' };
            case 'bounce': return { opacity: '0', transform: 'scale(0.92)', filter: 'none' };
            default: return { opacity: '1', transform: 'none', filter: 'none' };
        }
    }

    function getBackdropEnterStartStyles(effect) {
        switch (effect) {
            case 'fade': return { opacity: '0', transform: 'none', filter: 'none' };
            case 'slide-left': return { opacity: '1', transform: 'translateX(100%)', filter: 'none' };
            case 'slide-right': return { opacity: '1', transform: 'translateX(-100%)', filter: 'none' };
            case 'slide-up': return { opacity: '1', transform: 'translateY(100%)', filter: 'none' };
            case 'slide-down': return { opacity: '1', transform: 'translateY(-100%)', filter: 'none' };
            case 'zoom': return { opacity: '0', transform: 'scale(0.94)', filter: 'none' };
            case 'blur': return { opacity: '0', transform: 'none', filter: 'blur(12px)' };
            case 'flip': return { opacity: '0', transform: 'perspective(800px) rotateY(-14deg)', filter: 'none' };
            case 'bounce': return { opacity: '0', transform: 'scale(1.04)', filter: 'none' };
            default: return { opacity: '1', transform: 'none', filter: 'none' };
        }
    }

    function getBackdropEnterEndStyles() {
        return { opacity: '1', transform: 'none', filter: 'none' };
    }

    function applyBackdropFrameStyles(frame, styles) {
        frame.style.opacity = styles.opacity;
        frame.style.transform = styles.transform;
        frame.style.filter = styles.filter;
    }

    function createBackdropFrame(src, fit) {
        const frame = document.createElement('div');
        frame.className = 'slideshow-frame';
        frame.style.position = 'absolute';
        frame.style.inset = '0';
        frame.style.backgroundImage = src ? 'url(' + src + ')' : '';
        frame.style.backgroundSize = fit === 'contain' ? 'contain' : (fit === 'fill' ? '100% 100%' : 'cover');
        frame.style.backgroundPosition = 'center';
        frame.style.backgroundRepeat = 'no-repeat';
        frame.style.pointerEvents = 'none';
        frame.style.backfaceVisibility = 'hidden';
        frame.style.transformOrigin = 'center center';
        return frame;
    }

    function renderGlobalBackdrop(el, item, imageFit) {
        const nextUrl = item && item.backdrop_path ? baseBackdropUrl + item.backdrop_path : '';
        const previousUrl = el.dataset.currentBackdropUrl || '';
        const token = String((Number(el.dataset.backdropTransitionToken) || 0) + 1);
        el.dataset.backdropTransitionToken = token;
        if (el._backdropTransitionTimer) clearTimeout(el._backdropTransitionTimer);

        if (!nextUrl) {
            clearElement(el);
            delete el.dataset.currentBackdropUrl;
            return;
        }

        const settings = getBackdropLayerTransitionSettings(el);
        if (!settings.useTransition || !previousUrl || previousUrl === nextUrl) {
            appendImage(el, nextUrl, 'Backdrop', imageFit);
            el.dataset.currentBackdropUrl = nextUrl;
            restartElementTransition(el);
            return;
        }

        preloadImage(nextUrl).then(() => {
            if (el.dataset.backdropTransitionToken !== token) return;

            clearElement(el);
            const underlayFrame = createBackdropFrame(nextUrl, imageFit);
            const currentFrame = createBackdropFrame(previousUrl, imageFit);
            underlayFrame.style.zIndex = '1';
            currentFrame.style.zIndex = '2';
            underlayFrame.style.transition = 'none';
            currentFrame.style.transition = 'none';
            applyBackdropFrameStyles(underlayFrame, getBackdropEnterStartStyles(settings.effect));
            applyBackdropFrameStyles(currentFrame, getBackdropEnterEndStyles());
            el.appendChild(underlayFrame);
            el.appendChild(currentFrame);

            requestAnimationFrame(() => {
                if (el.dataset.backdropTransitionToken !== token) return;
                underlayFrame.style.transition = settings.transitionCss;
                currentFrame.style.transition = settings.transitionCss;
                applyBackdropFrameStyles(underlayFrame, getBackdropEnterEndStyles());
                applyBackdropFrameStyles(currentFrame, getBackdropExitStyles(settings.effect));
            });

            el._backdropTransitionTimer = setTimeout(() => {
                if (el.dataset.backdropTransitionToken !== token) return;
                appendImage(el, nextUrl, 'Backdrop', imageFit);
                el.dataset.currentBackdropUrl = nextUrl;
                el._backdropTransitionTimer = null;
            }, settings.total + 120);
        });
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
        const bubbleSize = Math.max(20, Math.min(200, Number(el.dataset.castBubbleSize) || 48));
        const castCount = Math.max(1, Math.min(30, Number(el.dataset.castCount) || 8));
        const cast = item && item.credits && Array.isArray(item.credits.cast) ? item.credits.cast : [];
        cast.filter(person => person && person.profile_path).slice(0, castCount).forEach(person => {
            if (!person.profile_path) return;
            const member = document.createElement('div');
            member.className = 'cast-member';
            member.style.width = Math.max(44, bubbleSize + 18) + 'px';
            const img = document.createElement('img');
            img.className = 'content-media';
            img.src = baseImgUrl + person.profile_path;
            img.alt = person.name || '';
            img.style.width = bubbleSize + 'px';
            img.style.height = bubbleSize + 'px';
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
        const slideshowDuration = Math.max(1000, Math.min(60000, Number(el.dataset.slideshowDuration) || 5000));
        const transitionEffect = el.dataset.transitionEffect || 'none';
        const transitionDuration = Math.max(0, Math.min(10000, Number(el.dataset.transitionDuration) || 0));
        const transitionDelay = Math.max(0, Math.min(10000, Number(el.dataset.transitionDelay) || 0));
        const useTransition = transitionEffect !== 'none' && transitionDuration > 0;
        const transitionTotal = transitionDuration + transitionDelay;
        const transitionCss = useTransition
            ? 'opacity ' + transitionDuration + 'ms ease-in-out ' + transitionDelay + 'ms, transform ' + transitionDuration + 'ms cubic-bezier(0.22, 1, 0.36, 1) ' + transitionDelay + 'ms, filter ' + transitionDuration + 'ms ease-in-out ' + transitionDelay + 'ms'
            : 'none';
        let currentIdx = 0;
        let transitioning = false;

	        if (el._slideshowTimer) clearTimeout(el._slideshowTimer);
        clearElement(el);
        el.style.backgroundImage = '';

        const nextFrame = document.createElement('div');
        const currentFrame = document.createElement('div');
        [nextFrame, currentFrame].forEach(frame => {
            frame.className = 'slideshow-frame';
            frame.style.position = 'absolute';
            frame.style.inset = '0';
            frame.style.backgroundSize = 'cover';
            frame.style.backgroundPosition = 'center';
            frame.style.pointerEvents = 'none';
            frame.style.opacity = '1';
            frame.style.transform = 'none';
            frame.style.filter = 'none';
        });
	        nextFrame.style.zIndex = '1';
	        currentFrame.style.zIndex = '2';
	        nextFrame.style.transition = transitionCss;
	        currentFrame.style.transition = transitionCss;
	        el.appendChild(nextFrame);
	        el.appendChild(currentFrame);

        function getBackdropUrl(item) {
            return item && item.backdrop_path ? baseBackdropUrl + item.backdrop_path : '';
        }

        function setFrame(frame, item) {
            const url = getBackdropUrl(item);
            void preloadImage(url);
            frame.style.backgroundImage = url ? 'url(' + url + ')' : '';
        }

        function updateLinked(index) {
            const item = results[index];
            updateLinkedGroup(el.dataset.linkGroup, detailForCollectionItem(data, item, fallbackType), el);
        }

	        function preloadNext() {
	            const nextIdx = (currentIdx + 1) % results.length;
	            setFrame(nextFrame, results[nextIdx]);
	            resetNextFrame();
	        }

	        function applyFrameStyles(frame, styles) {
	            frame.style.opacity = styles.opacity;
	            frame.style.transform = styles.transform;
	            frame.style.filter = styles.filter;
	        }

        function getExitStyles() {
            switch (transitionEffect) {
                case 'fade': return { opacity: '0', transform: 'none', filter: 'none' };
                case 'slide-left': return { opacity: '1', transform: 'translateX(-100%)', filter: 'none' };
                case 'slide-right': return { opacity: '1', transform: 'translateX(100%)', filter: 'none' };
                case 'slide-up': return { opacity: '1', transform: 'translateY(-100%)', filter: 'none' };
                case 'slide-down': return { opacity: '1', transform: 'translateY(100%)', filter: 'none' };
                case 'zoom': return { opacity: '0', transform: 'scale(1.08)', filter: 'none' };
                case 'blur': return { opacity: '0', transform: 'none', filter: 'blur(12px)' };
                case 'flip': return { opacity: '0', transform: 'perspective(800px) rotateY(14deg)', filter: 'none' };
                case 'bounce': return { opacity: '0', transform: 'scale(0.92)', filter: 'none' };
	                default: return { opacity: '1', transform: 'none', filter: 'none' };
	            }
	        }

	        function getEnterStartStyles() {
	            switch (transitionEffect) {
	                case 'fade': return { opacity: '0', transform: 'none', filter: 'none' };
	                case 'slide-left': return { opacity: '1', transform: 'translateX(100%)', filter: 'none' };
	                case 'slide-right': return { opacity: '1', transform: 'translateX(-100%)', filter: 'none' };
	                case 'slide-up': return { opacity: '1', transform: 'translateY(100%)', filter: 'none' };
	                case 'slide-down': return { opacity: '1', transform: 'translateY(-100%)', filter: 'none' };
	                case 'zoom': return { opacity: '0', transform: 'scale(0.94)', filter: 'none' };
	                case 'blur': return { opacity: '0', transform: 'none', filter: 'blur(12px)' };
	                case 'flip': return { opacity: '0', transform: 'perspective(800px) rotateY(-14deg)', filter: 'none' };
	                case 'bounce': return { opacity: '0', transform: 'scale(1.04)', filter: 'none' };
	                default: return { opacity: '1', transform: 'none', filter: 'none' };
	            }
	        }

	        function getEnterEndStyles() {
	            return { opacity: '1', transform: 'none', filter: 'none' };
	        }

	        function resetCurrentFrame() {
	            currentFrame.style.transition = 'none';
	            applyFrameStyles(currentFrame, getEnterEndStyles());
	            requestAnimationFrame(() => {
	                currentFrame.style.transition = transitionCss;
	            });
	        }

	        function resetNextFrame() {
	            nextFrame.style.transition = 'none';
	            applyFrameStyles(nextFrame, getEnterStartStyles());
	            requestAnimationFrame(() => {
	                nextFrame.style.transition = transitionCss;
	            });
	        }

        setFrame(currentFrame, results[0]);
        preloadNext();
        updateLinked(0);

        if (results.length > 1) {
            function scheduleNextSlide() {
                if (el._slideshowTimer) clearTimeout(el._slideshowTimer);
                el._slideshowTimer = setTimeout(advanceSlide, slideshowDuration);
            }

            function advanceSlide() {
                el._slideshowTimer = null;
                if (transitioning) return;
                const nextIdx = (currentIdx + 1) % results.length;
                transitioning = true;

                preloadImage(getBackdropUrl(results[nextIdx])).then(() => {
                    updateLinked(nextIdx);

                    if (!useTransition) {
                        currentIdx = nextIdx;
                        setFrame(currentFrame, results[currentIdx]);
                        preloadNext();
                        transitioning = false;
                        scheduleNextSlide();
                        return;
                    }

	                    currentFrame.style.transition = transitionCss;
	                    nextFrame.style.transition = transitionCss;
	                    applyFrameStyles(currentFrame, getExitStyles());
	                    applyFrameStyles(nextFrame, getEnterEndStyles());
                    setTimeout(() => {
                        currentIdx = nextIdx;
                        setFrame(currentFrame, results[currentIdx]);
                        resetCurrentFrame();
                        preloadNext();
                        transitioning = false;
                        scheduleNextSlide();
                    }, transitionTotal + 50);
                });
            }

            scheduleNextSlide();
        }
    }

    function getGlobalSlideshowTargets(sourceId) {
        return Array.from(document.querySelectorAll('[data-global-slideshow="true"]')).filter(el => el.dataset.sourceId === sourceId);
    }

    function startGlobalSlideshow(sourceId, data) {
        if (!sourceId || globalSlideshows.has(sourceId)) return;
        const results = Array.isArray(data && data.results) ? data.results.filter(item => item && item.id) : [];
        const targets = getGlobalSlideshowTargets(sourceId);
        if (results.length === 0 || targets.length === 0) return;

        const fallbackType = data.__collectionType || targets[0].dataset.itemType || 'movie';
        const duration = Math.max(1000, Math.min(60000, Number(targets[0].dataset.slideshowDuration) || 5000));
        const state = { index: 0, timer: null };
        globalSlideshows.set(sourceId, state);

        function renderSlide(index) {
            const item = detailForCollectionItem(data, results[index], fallbackType);
            getGlobalSlideshowTargets(sourceId).forEach(target => renderElement(target, item));
        }

        renderSlide(0);

        if (results.length > 1) {
            state.timer = setInterval(() => {
                state.index = (state.index + 1) % results.length;
                renderSlide(state.index);
            }, duration);
        }
    }

    function renderElement(el, data) {
        if (!el || !data) return;
        const type = el.dataset.type;
        const imageFit = el.dataset.imageFit || 'cover';
        const collectionResults = Array.isArray(data.results) ? data.results : null;
        const item = collectionResults ? detailForCollectionItem(data, collectionResults[0], data.__collectionType || el.dataset.itemType) : data;

        if (type === 'tmdb-poster-scroll') {
            renderPosterScroll(el, data);
            restartElementTransition(el);
            return;
        }
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
                if (el.dataset.globalSlideshow === 'true') {
                    renderGlobalBackdrop(el, item, imageFit);
                    return;
                }
                appendImage(el, item.backdrop_path ? baseBackdropUrl + item.backdrop_path : '', 'Backdrop', imageFit);
                break;
            case 'tmdb-logo':
                const logoUrl = getBestLogo(item.images && item.images.logos, document.documentElement.lang || 'en');
                if (logoUrl) appendImage(el, logoUrl, 'Logo', imageFit);
                else setText(el, item.title || item.name || 'Title');
                break;
            case 'tmdb-network-logo':
                const networkUrl = item.networks && item.networks[0] && item.networks[0].logo_path ? baseImgUrl + item.networks[0].logo_path : '';
                if (networkUrl) appendImage(el, networkUrl, 'Network', imageFit);
                else setText(el, item.title || item.name || 'Title');
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
        restartElementTransition(el);
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-type^="tmdb-"]').forEach(el => {
            const sourceId = el.dataset.sourceId;
            if (!sourceId) return;
            fetchSource(sourceId).then(data => {
                if (!data) return;
                if (el.dataset.globalSlideshow === 'true' && Array.isArray(data.results)) {
                    startGlobalSlideshow(sourceId, data);
                    return;
                }
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
            const fontSize = this.clampNumber(s.fontSize, 16, 0.1, 500);
            const fontSizeUnit = this.safeFontSizeUnit(s.fontSizeUnit);
            const lineHeightUnit = this.normalizeLineHeightUnit(s.lineHeightUnit);
            const lineHeightFallback = lineHeightUnit === 'em' || lineHeightUnit === 'rem' ? 1.2 : fontSize * 1.2;
            const lineHeight = this.clampNumber(s.lineHeight, lineHeightFallback, 0.1, 1000);
            const bgRgba = this.hexToRgba(this.safeCssColor(s.backgroundColor, '#000000'), this.clampNumber(s.backgroundOpacity ?? 1, 1, 0, 1));
            const textAlign = ['left', 'center', 'right'].includes(s.textAlign) ? s.textAlign : 'left';
            const fontWeight = ['400', '500', '600', '700'].includes(s.fontWeight) ? s.fontWeight : '400';
            const fontStyle = s.fontStyle === 'italic' ? 'italic' : 'normal';
            const textDecoration = s.textDecoration === 'underline' ? 'underline' : 'none';
            const contentAlignX = this.normalizeContentAlignX(s.contentAlignX ?? this.getDefaultContentAlignXForType(el.type, textAlign));
            const contentAlignY = this.normalizeContentAlignY(s.contentAlignY ?? this.getDefaultContentAlignYForType(el.type));
            const justifyContent = contentAlignX === 'left' ? 'flex-start' : (contentAlignX === 'right' ? 'flex-end' : 'center');
            const alignItems = contentAlignY === 'top' ? 'flex-start' : (contentAlignY === 'bottom' ? 'flex-end' : 'center');
            const objectPosition = `${contentAlignX === 'left' ? 'left' : (contentAlignX === 'right' ? 'right' : 'center')} ${contentAlignY === 'top' ? 'top' : (contentAlignY === 'bottom' ? 'bottom' : 'center')}`;
            const rawContentStrokeWidth = this.clampNumber(s.contentStrokeWidth ?? s.textStrokeWidth, 0, 0, 100);
            const contentStrokeEnabled = s.contentStrokeEnabled ?? (rawContentStrokeWidth > 0);
            const contentStrokeWidth = contentStrokeEnabled ? rawContentStrokeWidth : 0;
            const contentStrokeUnit = this.safeFontSizeUnit(s.contentStrokeUnit ?? s.textStrokeUnit);
            const contentStrokeColor = this.safeCssColor(s.contentStrokeColor || s.textStrokeColor, '#000000');
            const contentStrokePosition = this.normalizeStrokePosition(s.contentStrokePosition);
            const outsideStrokeBoxShadow = contentStrokeWidth > 0 && contentStrokePosition === 'outside'
              ? `0 0 0 ${contentStrokeWidth}${contentStrokeUnit} ${contentStrokeColor}`
              : '';
            const contentShadow = s.contentShadow || s.textShadow;
            const contentShadowCss = contentShadow
                ? `${this.clampNumber(contentShadow.x, 0, -500, 500)}px ${this.clampNumber(contentShadow.y, 0, -500, 500)}px ${this.clampNumber(contentShadow.blur, 0, 0, 500)}px ${this.safeCssColor(contentShadow.color, 'rgba(0,0,0,0.35)')}`
                : '';
            const contentDropShadowCss = contentShadow
                ? `drop-shadow(${this.clampNumber(contentShadow.x, 0, -500, 500)}px ${this.clampNumber(contentShadow.y, 0, -500, 500)}px ${this.clampNumber(contentShadow.blur, 0, 0, 500)}px ${this.safeCssColor(contentShadow.color, 'rgba(0,0,0,0.35)')})`
                : '';

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
                `font-size: ${fontSize}${fontSizeUnit}`,
                `font-style: ${fontStyle}`,
                `font-weight: ${fontWeight}`,
                `line-height: ${lineHeight}${lineHeightUnit}`,
                `text-decoration: ${textDecoration}`,
                `text-align: ${contentAlignX}`,
                `display: flex`,
                `justify-content: ${justifyContent}`,
                `align-items: ${alignItems}`,
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
            const elementBoxShadows = [
                s.boxShadow ? `${this.clampNumber(s.boxShadow.x, 0, -500, 500)}px ${this.clampNumber(s.boxShadow.y, 0, -500, 500)}px ${this.clampNumber(s.boxShadow.blur, 0, 0, 500)}px ${this.safeCssColor(s.boxShadow.color, 'rgba(0,0,0,0.35)')}` : '',
                this.shouldRenderOutsideStrokeOnElement(el) ? outsideStrokeBoxShadow : ''
            ].filter(Boolean);
            if (elementBoxShadows.length > 0) props.push(`box-shadow: ${elementBoxShadows.join(', ')}`);
            if (contentShadowCss) props.push(`text-shadow: ${contentShadowCss}`);

            const filters = [];
            const blur = this.clampNumber(s.filterBlur, 0, 0, 100);
            const grayscale = this.clampNumber(s.filterGrayscale, 0, 0, 1);
            if (blur > 0) filters.push(`blur(${blur}px)`);
            if (grayscale > 0) filters.push(`grayscale(${grayscale * 100}%)`);
            if (filters.length > 0) {
                props.push(`backdrop-filter: ${filters.join(' ')}`);
                props.push(`-webkit-backdrop-filter: ${filters.join(' ')}`);
            }

            const transitionAnimation = this.getTransitionAnimationCss(el, visibleElements);
            if (transitionAnimation) {
                props.push(`--element-rotation: ${rotation}deg`);
                if (!el.type.startsWith('tmdb-')) props.push(`animation: ${transitionAnimation}`);
            }

            const safeId = this.safeElementId(el.id);
            const textStrokeProps = contentStrokeWidth > 0
              ? [
                  `-webkit-text-stroke: ${contentStrokeWidth}${contentStrokeUnit} ${contentStrokeColor}`,
                  `text-stroke: ${contentStrokeWidth}${contentStrokeUnit} ${contentStrokeColor}`,
                  `paint-order: ${contentStrokePosition === 'outside' ? 'stroke fill' : 'fill stroke'}`
                ]
              : [];
            const mediaProps = [
                `box-sizing: border-box`,
                `object-position: ${objectPosition}`
            ];
            if (contentStrokeWidth > 0 && contentStrokePosition === 'inside') mediaProps.push(`border: ${contentStrokeWidth}${contentStrokeUnit} solid ${contentStrokeColor}`);
            if (outsideStrokeBoxShadow && !this.shouldRenderOutsideStrokeOnElement(el)) mediaProps.push(`box-shadow: ${outsideStrokeBoxShadow}`);
            if (contentDropShadowCss) mediaProps.push(`filter: ${contentDropShadowCss}`);

            const castBubbleSize = this.normalizeCastBubbleSize(el.castBubbleSize);
            const extraRules = [
                `    #${safeId} img.content-media, #${safeId} .scroll-img, #${safeId} .cast-member img, #${safeId} .slideshow-frame {\n        ${mediaProps.join(';\n        ')};\n    }`,
                `    #${safeId} .genre-pill {\n        ${[
                    contentStrokeWidth > 0 && contentStrokePosition === 'inside' ? `border: ${contentStrokeWidth}${contentStrokeUnit} solid ${contentStrokeColor}` : '',
                    (outsideStrokeBoxShadow || contentShadowCss) ? `box-shadow: ${[outsideStrokeBoxShadow, contentShadowCss].filter(Boolean).join(', ')}` : ''
                ].filter(Boolean).join(';\n        ') || 'border: none'};\n    }`,
                `    #${safeId} .cast-member {\n        width: ${Math.max(44, castBubbleSize + 18)}px;\n    }`,
                `    #${safeId} .cast-member img {\n        width: ${castBubbleSize}px;\n        height: ${castBubbleSize}px;\n    }`
            ];
            if (textStrokeProps.length) {
                extraRules.push(`    #${safeId} .text-content, #${safeId} .genre-pill, #${safeId} .cast-member p, #${safeId} .star-filled, #${safeId} .star-empty {\n        ${textStrokeProps.join(';\n        ')};\n    }`);
            }

            return `    /* ${this.escapeHtml(this.formatTypeName(el.type))} */\n    #${safeId} {\n        ${props.join(';\n        ')};\n    }\n${extraRules.join('\n')}`;
        }).join('\n\n');

    const htmlElements = visibleElements
        .map(el => {
            const sourceId = elementSources.get(el.id);
            const isGlobalSourceTarget = this.isGlobalSlideshowTarget(el, visibleElements);
            const attrs = [
              `id="${this.escapeHtml(this.safeElementId(el.id))}"`,
              `data-type="${this.escapeHtml(el.type)}"`,
              `data-item-type="${this.escapeHtml(el.tmdbItemType)}"`,
              `data-image-fit="${this.escapeHtml(el.imageFit || 'cover')}"`,
              `data-cast-bubble-size="${this.getCastBubbleSize(el)}"`
            ];
            if (el.type === 'tmdb-cast') attrs.push(`data-cast-count="${this.getCastCount(el)}"`);
            const transitionAnimation = this.getTransitionAnimationCss(el, visibleElements);
            if (transitionAnimation) {
                attrs.push(`data-transition-animation="${this.escapeHtml(transitionAnimation)}"`);
                attrs.push(`data-transition-effect="${this.escapeHtml(this.getEffectiveTransitionEffect(el, visibleElements))}"`);
                attrs.push(`data-transition-duration="${this.getEffectiveTransitionDurationMs(el, visibleElements)}"`);
                attrs.push(`data-transition-delay="${this.getEffectiveTransitionDelayMs(el, visibleElements)}"`);
            }
            if (sourceId) attrs.push(`data-source-id="${this.escapeHtml(sourceId)}"`);
            if (el.linkGroup) attrs.push(`data-link-group="${this.escapeHtml(el.linkGroup)}"`);
            if (isGlobalSourceTarget) {
                attrs.push(`data-global-slideshow="true"`);
                attrs.push(`data-slideshow-duration="${this.globalSlideshowDurationMs()}"`);
            }
            if (this.isCollectionElement(el)) attrs.push(`data-collection-limit="${this.getEffectiveCollectionItemLimit(el, visibleElements)}"`);
            if (el.type === 'tmdb-backdrop-slideshow') {
                attrs.push(`data-slideshow-duration="${this.getEffectiveSlideshowDurationMs(el, visibleElements)}"`);
                attrs.push(`data-transition-effect="${this.escapeHtml(this.getEffectiveTransitionEffect(el, visibleElements))}"`);
                attrs.push(`data-transition-duration="${this.getEffectiveTransitionDurationMs(el, visibleElements)}"`);
                attrs.push(`data-transition-delay="${this.getEffectiveTransitionDelayMs(el, visibleElements)}"`);
            }
            if (el.type === 'tmdb-dynamic-field') {
                attrs.push(`data-data-path="${this.escapeHtml(el.dataPath || '')}"`);
                attrs.push(`data-data-prefix="${this.escapeHtml(el.dataPrefix || '')}"`);
                attrs.push(`data-data-suffix="${this.escapeHtml(el.dataSuffix || '')}"`);
            }

            const imgStyle = `width:100%;height:100%;object-fit:${this.escapeHtml(el.imageFit || 'cover')};object-position:${this.escapeHtml(this.getContentObjectPosition(el))};border-radius:${this.clampNumber(el.styles.borderRadius, 0, 0, 500)}px;`;
            let content = '';
            if (el.type === 'text') content = `<span class="text-content">${this.escapeHtml(el.content)}</span>`;
            else if (el.type === 'image') content = `<img class="content-media" src="${this.escapeHtml(el.content)}" style="${imgStyle}" alt="Image">`;
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
        $statusLine = isset($http_response_header[0]) ? $http_response_header[0] : '';
        if (!preg_match('/\\s(2\\d\\d)\\s/', $statusLine)) return null;
    }

    $json = json_decode($body, true);
    return is_array($json) ? $json : null;
}

function tmdb_item_type($item, $fallback = 'movie') {
    if (!is_array($item)) return $fallback === 'tv' ? 'tv' : 'movie';
    $mediaType = $item['media_type'] ?? '';
    if ($mediaType === 'movie' || $mediaType === 'tv') return $mediaType;
    if (!empty($item['first_air_date']) && empty($item['release_date'])) return 'tv';
    if (!empty($item['release_date']) && empty($item['first_air_date'])) return 'movie';
    return $fallback === 'tv' ? 'tv' : 'movie';
}

function tmdb_interleave_mixed_results($results) {
    if (!is_array($results)) return array();
    $movies = array_values(array_filter($results, function($item) {
        return tmdb_item_type($item, 'movie') === 'movie';
    }));
    $shows = array_values(array_filter($results, function($item) {
        return tmdb_item_type($item, 'tv') === 'tv';
    }));
    $interleaved = array();
    $max = max(count($movies), count($shows));
    for ($i = 0; $i < $max; $i++) {
        if (isset($movies[$i])) $interleaved[] = $movies[$i];
        if (isset($shows[$i])) $interleaved[] = $shows[$i];
    }
    return $interleaved;
}

function tmdb_tag_results($results, $type) {
    if (!is_array($results)) return array();
    return array_map(function($item) use ($type) {
        if (is_array($item)) $item['media_type'] = $type;
        return $item;
    }, $results);
}

function tmdb_fetch_collection_pages($source, $config, $limit) {
    $pageCount = max(1, intval(ceil($limit / 20)));
    $data = null;
    $combinedResults = array();

    for ($page = 1; $page <= $pageCount; $page++) {
        $pageData = tmdb_http_get_json(tmdb_build_url($source, $config, $page), $config);
        if (!$pageData) {
            if ($page === 1) return array(null, array());
            break;
        }
        if ($data === null) $data = $pageData;
        if (!empty($pageData['results']) && is_array($pageData['results'])) {
            $combinedResults = array_merge($combinedResults, $pageData['results']);
        }
    }

    return array($data, $combinedResults);
}

function tmdb_fetch_source($source, $config) {
    if (($source['kind'] ?? '') === 'collection') {
        $limit = max(1, min(40, intval($source['limit'] ?? 20)));
        if (($source['collectionType'] ?? 'movie') === 'mixed') {
            $movieSource = array_merge($source, array(
                'endpoint' => $source['movieEndpoint'] ?? 'movie/popular',
                'collectionType' => 'movie',
                'discoverFilters' => $source['movieDiscoverFilters'] ?? array()
            ));
            $tvSource = array_merge($source, array(
                'endpoint' => $source['tvEndpoint'] ?? 'tv/popular',
                'collectionType' => 'tv',
                'discoverFilters' => $source['tvDiscoverFilters'] ?? array()
            ));
            list($movieData, $movieResults) = tmdb_fetch_collection_pages($movieSource, $config, $limit);
            list($tvData, $tvResults) = tmdb_fetch_collection_pages($tvSource, $config, $limit);
            if (!$movieData && !$tvData) return null;
            $data = $movieData ?: $tvData;
            $combinedResults = tmdb_interleave_mixed_results(array_merge(
                tmdb_tag_results($movieResults, 'movie'),
                tmdb_tag_results($tvResults, 'tv')
            ));
        } else {
            list($data, $combinedResults) = tmdb_fetch_collection_pages($source, $config, $limit);
            if (!$data) return null;
        }
        $data['results'] = array_slice($combinedResults, 0, $limit);
        $data['__collectionType'] = $source['collectionType'] ?? 'movie';
        if ((!empty($source['enrichLinked']) || !empty($source['enrichFirst'])) && !empty($data['results']) && is_array($data['results'])) {
            $details = array();
            foreach (array_slice($data['results'], 0, $limit) as $item) {
                if (empty($item['id'])) continue;
                $type = tmdb_item_type($item, $source['collectionType'] ?? 'movie');
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

    @keyframes tmdbFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes tmdbSlideInLeft { from { opacity: 0; transform: translateX(48px) rotate(var(--element-rotation, 0deg)); } to { opacity: 1; transform: translateX(0) rotate(var(--element-rotation, 0deg)); } }
    @keyframes tmdbSlideInRight { from { opacity: 0; transform: translateX(-48px) rotate(var(--element-rotation, 0deg)); } to { opacity: 1; transform: translateX(0) rotate(var(--element-rotation, 0deg)); } }
    @keyframes tmdbSlideInUp { from { opacity: 0; transform: translateY(48px) rotate(var(--element-rotation, 0deg)); } to { opacity: 1; transform: translateY(0) rotate(var(--element-rotation, 0deg)); } }
    @keyframes tmdbSlideInDown { from { opacity: 0; transform: translateY(-48px) rotate(var(--element-rotation, 0deg)); } to { opacity: 1; transform: translateY(0) rotate(var(--element-rotation, 0deg)); } }
    @keyframes tmdbZoomIn { from { opacity: 0; transform: scale(0.86) rotate(var(--element-rotation, 0deg)); } to { opacity: 1; transform: scale(1) rotate(var(--element-rotation, 0deg)); } }
    @keyframes tmdbBlurIn { from { opacity: 0; filter: blur(10px); } to { opacity: 1; filter: blur(0); } }
    @keyframes tmdbFlipIn { from { opacity: 0; transform: perspective(800px) rotateX(18deg) rotate(var(--element-rotation, 0deg)); } to { opacity: 1; transform: perspective(800px) rotateX(0) rotate(var(--element-rotation, 0deg)); } }
    @keyframes tmdbBounceIn { 0% { opacity: 0; transform: scale(0.92) rotate(var(--element-rotation, 0deg)); } 65% { opacity: 1; transform: scale(1.04) rotate(var(--element-rotation, 0deg)); } 100% { opacity: 1; transform: scale(1) rotate(var(--element-rotation, 0deg)); } }

    /* --- Element Styles --- */
${cssRules}

    /* --- Utility Classes for Dynamic Content --- */
    .text-content {
        display: block;
        width: 100%;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

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
