
import { Component, ChangeDetectionStrategy, signal, effect, computed, inject, ChangeDetectorRef, HostListener, OnDestroy, AfterViewInit, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { inject as vcinject } from '@vercel/analytics';
import { Observable, of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { COUNTRIES, LANGUAGES } from './countries-languages';

vcinject();

// --- TYPE DEFINITIONS ---
interface Gradient { angle: number; from: string; to: string; }
interface Shadow { x: number; y: number; blur: number; color: string; }
interface DiscoverFilters { sortBy: string; genres: string[]; year: number | null; }

type TmdbItemType = 'movie' | 'tv';
type TmdbCollectionType = 'movie' | 'tv' | 'mixed';
type ElementType = 
  | 'text' | 'image' | 'shape' 
  | 'tmdb-poster' | 'tmdb-backdrop' | 'tmdb-title' | 'tmdb-overview' 
  | 'tmdb-poster-scroll' | 'tmdb-backdrop-slideshow' | 'tmdb-tagline' 
  | 'tmdb-release-date' | 'tmdb-runtime' | 'tmdb-genres' | 'tmdb-rating' 
  | 'tmdb-cast' | 'tmdb-logo' | 'tmdb-network-logo' | 'tmdb-season-episode-count';

type ImageFit = 'cover' | 'contain' | 'fill';

interface CanvasElement {
  id: string;
  type: ElementType;
  x: number; y: number; width: number; height: number; rotation: number;
  zIndex: number; visible: boolean;
  content: string;
  styles: {
    backgroundColor: string; 
    backgroundOpacity: number; // New: Separate opacity for background only
    color: string; fontFamily: string; fontSize: number;
    fontWeight: '400' | '500' | '600' | '700'; textAlign: 'left' | 'center' | 'right';
    borderRadius: number; borderWidth: number; borderColor: string; 
    opacity: number; // Overall element opacity
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
}

interface HistoryState { elements: CanvasElement[]; selectedElementId: string | null; }
interface ContextMenuState { visible: boolean; x: number; y: number; elementId: string | null; }
interface TmdbGenre { id: number; name: string; }

declare var interact: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private slideshowIntervals: Map<string, any> = new Map();
  private searchTerms = new Subject<string>();
  
  readonly Math = Math;

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
      { key: 'revenue.desc', name: 'Revenue' }, { key: 'primary_release_date.desc', name: 'Release Date' }
    ],
    tv: [
      { key: 'popularity.desc', name: 'Popularity' }, { key: 'vote_average.desc', name: 'Rating' },
      { key: 'first_air_date.desc', name: 'First Air Date' }
    ]
  };

  // --- STATE SIGNALS ---
  elements = signal<CanvasElement[]>([]);
  selectedElementId = signal<string | null>(null);
  
  // Global Settings
  tmdbApiKey = signal<string>(localStorage.getItem('tmdbApiKey') || '');
  watchRegion = signal<string>(localStorage.getItem('tmdbWatchRegion') || 'US');
  language = signal<string>(localStorage.getItem('tmdbLanguage') || 'en-US');
  includeAdult = signal<boolean>(localStorage.getItem('tmdbIncludeAdult') === 'true');

  // UI State
  canvasBaseSizes = { 
      mobile: { width: 375, height: 667 }, 
      tablet: { width: 768, height: 1024 }, 
      tv: { width: 1920, height: 1080 } 
  };
  selectedPreset = signal<'mobile' | 'tablet' | 'tv'>('mobile');
  orientation = signal<'portrait' | 'landscape'>('portrait');
  zoomLevel = signal<number>(1);

  history = signal<HistoryState[]>([]);
  historyIndex = signal<number>(-1);
  activeLeftPanelTab = signal<'elements' | 'settings'>('elements');
  activeRightPanelTab = signal<'properties' | 'layers' | 'export'>('properties');
  previewMode = signal(false);
  contextMenu = signal<ContextMenuState>({ visible: false, x: 0, y: 0, elementId: null });
  copiedStyles = signal<Partial<CanvasElement['styles']> | null>(null);
  
  slideshowState = signal<{[id: string]: {idx1: number, idx2: number, fade: boolean, backdrops: string[], items: any[]}}>({});
  
  draggedLayerId = signal<string | null>(null);
  dragOverLayerId = signal<string | null>(null);
  
  tmdbGenres = signal<{movie: TmdbGenre[], tv: TmdbGenre[]}>({ movie: [], tv: [] });
  tmdbSearchResults = signal<any[]>([]);
  isSearching = signal(false);

  // --- COMPUTED SIGNALS ---
  canvasConfig = computed(() => {
      const base = this.canvasBaseSizes[this.selectedPreset()];
      let w = base.width;
      let h = base.height;

      if (this.selectedPreset() === 'tv') {
          if (this.orientation() === 'portrait') { w = base.height; h = base.width; }
      } else {
          if (this.orientation() === 'landscape') { w = base.height; h = base.width; }
      }

      return { width: w, height: h, scale: this.zoomLevel() };
  });

  selectedElement = computed(() => this.elements().find(el => el.id === this.selectedElementId()));
  generatedPhpCode = signal('');
  
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
  
  // Helper for context menu image options
  isImageElement(elementId: string | null): boolean {
      if (!elementId) return false;
      const el = this.elements().find(e => e.id === elementId);
      if (!el) return false;
      const imageTypes = ['image', 'tmdb-poster', 'tmdb-backdrop', 'tmdb-logo', 'tmdb-network-logo'];
      return imageTypes.includes(el.type);
  }

  constructor() {
    effect(() => localStorage.setItem('tmdbApiKey', this.tmdbApiKey()));
    effect(() => localStorage.setItem('tmdbWatchRegion', this.watchRegion()));
    effect(() => localStorage.setItem('tmdbLanguage', this.language()));
    effect(() => localStorage.setItem('tmdbIncludeAdult', this.includeAdult().toString()));

    effect(() => {
        const key = this.tmdbApiKey();
        if(key) this.fetchTmdbGenres();
        this.elements().forEach(el => this.fetchTmdbDataForElement(el.id, true));
    }, { allowSignalWrites: true });

    effect(() => this.updatePhpCode());
    
    effect(() => {
        const preset = this.selectedPreset();
        if (preset === 'tv') this.zoomLevel.set(0.45);
        else if (preset === 'tablet') this.zoomLevel.set(0.75);
        else this.zoomLevel.set(1);
    }, { allowSignalWrites: true });

    this.saveStateToHistory();
  }
  
  ngOnInit() {
    this.searchTerms.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      switchMap((term: string) => {
        if (!term.trim() || !this.tmdbApiKey() || !this.selectedElement()) return of({results: []});
        this.isSearching.set(true);
        const type = this.selectedElement()?.tmdbItemType || 'movie';
        const params = new URLSearchParams({ api_key: this.tmdbApiKey(), language: this.language(), query: term });
        return this.http.get<any>(`https://api.themoviedb.org/3/search/${type}?${params.toString()}`).pipe(catchError(() => of({results: []})));
      })
    ).subscribe(response => {
      this.tmdbSearchResults.set(response.results);
      this.isSearching.set(false);
      this.cdr.detectChanges();
    });
  }

  ngAfterViewInit() { this.setupInteract(); }
  ngOnDestroy() { this.slideshowIntervals.forEach(interval => clearInterval(interval)); }

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

  // --- HISTORY MANAGEMENT ---
  saveStateToHistory() {
    setTimeout(() => {
      const currentState: HistoryState = { elements: JSON.parse(JSON.stringify(this.elements())), selectedElementId: this.selectedElementId() };
      const lastState = this.history()[this.historyIndex()];
      if (lastState && JSON.stringify(lastState.elements) === JSON.stringify(currentState.elements)) return;
      
      const newHistory = this.history().slice(0, this.historyIndex() + 1);
      newHistory.push(currentState);
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
      });
    }
  }

  // --- ELEMENT MANIPULATION ---
  addElement(type: ElementType, itemType: TmdbItemType = 'movie', collectionType: TmdbCollectionType = 'movie') {
    const isLogo = type === 'tmdb-logo' || type === 'tmdb-network-logo';
    const newElement: CanvasElement = {
      id: `el_${Date.now()}`, type, x: 50, y: 50,
      width: type.includes('scroll') || type.includes('slideshow') ? 350 : (type.includes('backdrop') ? 300 : (type.includes('cast') ? 350 : (isLogo ? 120 : 150))),
      height: type.includes('text') || type.includes('title') || type.includes('tagline') ? 50 : (type.includes('backdrop') || type.includes('slideshow') ? 169 : (type.includes('cast') ? 100 : (isLogo ? 60 : 225))),
      rotation: 0,
      zIndex: this.elements().length + 1, content: 'New Text', visible: true,
      styles: { 
          backgroundColor: '#334155', 
          backgroundOpacity: 1,
          color: '#f1f5f9', fontFamily: 'Inter', fontSize: 16, fontWeight: '400', textAlign: 'left', borderRadius: 8, borderWidth: 0, borderColor: '#f1f5f9', opacity: 1, filterBlur: 0, filterGrayscale: 0 
      },
      tmdbItemType: itemType,
      tmdbCollectionType: collectionType,
      discoverFilters: { sortBy: 'popularity.desc', genres: [], year: null },
      imageFit: isLogo ? 'contain' : 'cover',
      linkGroup: ''
    };
    if (type === 'image') newElement.content = 'https://picsum.photos/200/300';
    if (type === 'shape') newElement.height = 100;
    this.elements.update(els => [...els, newElement]);
    this.selectElement(newElement.id);
    this.activeRightPanelTab.set('properties');
    this.saveStateToHistory();
  }

  deleteElement(id: string) {
    this.elements.update(els => els.filter(el => el.id !== id));
    if (this.selectedElementId() === id) this.selectedElementId.set(null);
    if(this.slideshowIntervals.has(id)) { clearInterval(this.slideshowIntervals.get(id)); this.slideshowIntervals.delete(id); }
    this.saveStateToHistory();
  }

  selectElement(id: string | null) {
    this.selectedElementId.set(id);
    if(id) {
        this.bringToFront(id, false);
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
  
  setImageFit(id: string, fit: ImageFit) {
      this.elements.update(els => els.map(el => el.id === id ? { ...el, imageFit: fit } : el));
      this.saveStateToHistory();
      this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }
  
  updateDiscoverFilter(prop: keyof DiscoverFilters, value: any) { this.updateSelectedElement(el => { el.discoverFilters = { ...el.discoverFilters, [prop]: value }; }); }

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
    const allElements = this.elements();
    const sourceEl = allElements.find(e => e.id === sourceId);
    const targetEl = allElements.find(e => e.id === targetId);
    if (!sourceEl || !targetEl) return;
    let groupId = targetEl.linkGroup;
    if (!groupId) {
      groupId = 'group_' + Date.now().toString(36);
      this.elements.update(els => els.map(el => el.id === targetId ? { ...el, linkGroup: groupId } : el));
    }
    this.elements.update(els => els.map(el => {
      if (el.id === sourceId) return { ...el, linkGroup: groupId, tmdbId: targetEl.tmdbId, tmdbItemType: targetEl.tmdbItemType, tmdbData: null };
      return el;
    }));
    this.fetchTmdbDataForElement(sourceId);
    this.saveStateToHistory();
  }

  unlinkElement(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.elements.update(els => els.map(el => el.id === id ? { ...el, linkGroup: '' } : el));
    this.saveStateToHistory();
  }

  // --- TMDB API & DATA HANDLING ---
  fetchTmdbGenres() {
    const apiKey = this.tmdbApiKey();
    if(!apiKey) return;
    const movieUrl = `https://api.themoviedb.org/3/genre/movie/list?api_key=${apiKey}`;
    const tvUrl = `https://api.themoviedb.org/3/genre/tv/list?api_key=${apiKey}`;
    this.http.get<any>(movieUrl).pipe(catchError(() => of({genres: []}))).subscribe(data => this.tmdbGenres.update(g => ({...g, movie: data.genres})));
    this.http.get<any>(tvUrl).pipe(catchError(() => of({genres: []}))).subscribe(data => this.tmdbGenres.update(g => ({...g, tv: data.genres})));
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
          if (el.linkGroup === groupName && el.id !== excludeElementId) {
              return { ...el, tmdbId: tmdbId, tmdbItemType: itemType, tmdbData: null }; 
          }
          return el;
      }));
      this.elements().forEach(el => {
          if (el.linkGroup === groupName && el.id !== excludeElementId) this.fetchTmdbDataForElement(el.id);
      });
      if (!excludeElementId) this.saveStateToHistory();
  }

  fetchTmdbDataForElement(id: string, isInitial = false) {
    const element = this.elements().find(el => el.id === id);
    if (!element || !this.tmdbApiKey() || (isInitial && element.tmdbData)) return;

    let obs: Observable<any>;
    const apiKey = this.tmdbApiKey();
    const params = new URLSearchParams({ api_key: apiKey, language: this.language(), include_adult: this.includeAdult().toString() });
    
    if (element.tmdbId && element.tmdbItemType) {
        params.append('append_to_response', 'credits,images,videos,content_ratings');
        obs = this.http.get(`https://api.themoviedb.org/3/${element.tmdbItemType}/${element.tmdbId}?${params.toString()}`);
    } else if (element.tmdbEndpoint) {
        if (element.tmdbEndpoint.startsWith('discover')) {
          params.append('sort_by', element.discoverFilters.sortBy);
          if (element.discoverFilters.genres.length > 0) params.append('with_genres', element.discoverFilters.genres.join(','));
          const yearKey = element.tmdbCollectionType === 'movie' ? 'primary_release_year' : 'first_air_date_year';
          if (element.discoverFilters.year) params.append(yearKey, element.discoverFilters.year.toString());
        }
        params.append('watch_region', this.watchRegion());
        obs = this.http.get(`https://api.themoviedb.org/3/${element.tmdbEndpoint}?${params.toString()}`);
    } else { return; }
    
    obs.pipe(catchError(() => of(null))).subscribe(data => {
      if (!data) return;
      this.elements.update(els => els.map(el => el.id === id ? {...el, tmdbData: data} : el));
      if (element.type === 'tmdb-backdrop-slideshow') this.setupSlideshow(id);
      this.cdr.detectChanges();
    });
  }
  
  setupSlideshow(elementId: string) {
    if (this.slideshowIntervals.has(elementId)) clearInterval(this.slideshowIntervals.get(elementId));
    
    const element = this.elements().find(e => e.id === elementId);
    if (!element?.tmdbData?.results) return;

    const items = element.tmdbData.results;
    const backdrops = items.map((item: any) => item.backdrop_path).filter(Boolean).slice(0, 20).map((path: string) => 'https://image.tmdb.org/t/p/w1280' + path);
    if (backdrops.length < 2) return;

    this.slideshowState.update(s => ({...s, [elementId]: { idx1: 0, idx2: 1, fade: false, backdrops, items }}));
    
    const interval = setInterval(() => {
        this.slideshowState.update(s => {
            const current = s[elementId];
            if (!current) return s;
            return {...s, [elementId]: { ...current, fade: true } };
        });
        this.cdr.detectChanges();

        const el = this.elements().find(e => e.id === elementId);
        const state = this.slideshowState()[elementId];
        if (el && el.linkGroup && state.items && state.items.length > state.idx2) {
            const nextItem = state.items[state.idx2]; 
            if (nextItem) {
                 const itemType = nextItem.media_type || el.tmdbCollectionType || 'movie';
                 this.propagateTmdbId(el.linkGroup, nextItem.id, itemType as TmdbItemType, elementId);
            }
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
    interact('.draggable-element').unset();
    interact('.draggable-element').draggable({
      listeners: {
        move: (event: any) => {
          const target = event.target;
          const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
          
          // Preserve rotation during drag
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
            const newX = element.x + (parseFloat(target.getAttribute('data-x')) || 0);
            const newY = element.y + (parseFloat(target.getAttribute('data-y')) || 0);
            this.updateElementProperty('x', newX, true);
            this.updateElementProperty('y', newY, true);
            
            // Reset transform, Angular binding will take over for rotation
            target.style.transform = `rotate(${element.rotation}deg)`;
            target.removeAttribute('data-x');
            target.removeAttribute('data-y');
            this.saveStateToHistory();
          }
        }
      },
      modifiers: [interact.modifiers.snap({ targets: [], range: Infinity, relativePoints: [{ x: 0.5, y: 0.5 }] }), interact.modifiers.restrictRect({ restriction: 'parent' })],
      inertia: false
    }).resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      listeners: {
        move: (event: any) => {
          const id = event.target.id;
          this.elements.update(els =>
            els.map(el => {
              if (el.id === id) {
                return { ...el, width: event.rect.width, height: event.rect.height, x: el.x + event.deltaRect.left, y: el.y + event.deltaRect.top, };
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
    const { width: cw, height: ch } = this.canvasConfig();
    this.elements.update(els => els.map(el => {
      if (el.id !== id) return el;
      switch(type) {
        case 'fill': return { ...el, x: 0, y: 0, width: cw, height: ch };
        case 'fitW': return { ...el, x: 0, width: cw };
        case 'fitH': return { ...el, y: 0, height: ch };
        case 'center': return { ...el, x: (cw - el.width) / 2, y: (ch - el.height) / 2 };
        case 'centerH': return { ...el, x: (cw - el.width) / 2 };
        case 'centerV': return { ...el, y: (ch - el.height) / 2 };
        case 'top': return { ...el, y: 0 };
        case 'bottom': return { ...el, y: ch - el.height };
        case 'left': return { ...el, x: 0 };
        case 'right': return { ...el, x: cw - el.width };
      }
      return el;
    }));
    this.saveStateToHistory();
    this.contextMenu.update(cm => ({ ...cm, visible: false }));
  }
  
  // --- UTILITY & FORMATTING ---
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
  
  // Convert HEX to RGBA string
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
  private minifyJS(js: string): string { return js.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1').replace(/\s+/g, ' ').trim(); }

  generatePHP(): string {
    if (!this.tmdbApiKey()) return '<!-- Enter TMDB API Key to generate code -->';
    const { width, height } = this.canvasConfig();
    const config = { apiKey: this.tmdbApiKey(), lang: this.language(), region: this.watchRegion(), adult: this.includeAdult() };
    
    const styles = this.elements().filter(el => el.visible).map(el => {
        const s = el.styles;
        // Use helper to get RGBA for background
        const bgRgba = this.hexToRgba(s.backgroundColor, s.backgroundOpacity ?? 1); // Default to 1 if undefined
        
        let styleString = `position:absolute;top:${el.y}px;left:${el.x}px;width:${el.width}px;height:${el.height}px;z-index:${el.zIndex};background-color:${bgRgba};color:${s.color};font-family:'${s.fontFamily}',sans-serif;font-size:${s.fontSize}px;font-weight:${s.fontWeight};text-align:${s.textAlign};border-radius:${s.borderRadius}px;border:${s.borderWidth}px solid ${s.borderColor};opacity:${s.opacity};box-sizing:border-box;overflow:hidden;`;
        if(el.rotation) styleString += `transform:rotate(${el.rotation}deg);`;
        if(s.backgroundGradient) styleString += `background-image:linear-gradient(${s.backgroundGradient.angle}deg,${s.backgroundGradient.from},${s.backgroundGradient.to});`;
        if(s.boxShadow) styleString += `box-shadow:${s.boxShadow.x}px ${s.boxShadow.y}px ${s.boxShadow.blur}px ${s.boxShadow.color};`;
        if(s.textShadow) styleString += `text-shadow:${s.textShadow.x}px ${s.textShadow.y}px ${s.textShadow.blur}px ${s.textShadow.color};`;
        const filters = [];
        if(s.filterBlur > 0) filters.push(`blur(${s.filterBlur}px)`);
        if(s.filterGrayscale > 0) filters.push(`grayscale(${s.filterGrayscale * 100}%)`);
        if(filters.length > 0) styleString += `backdrop-filter:${filters.join(' ')};-webkit-backdrop-filter:${filters.join(' ')};`;
        return `#${el.id}{${styleString}}`;
    }).join('');

    const bodyHtml = this.elements().filter(el => el.visible).map(el => {
      let dataAttrs = `data-type="${el.type}"`;
      if (el.tmdbId) dataAttrs += ` data-tmdb-id="${el.tmdbId}"`;
      dataAttrs += ` data-item-type="${el.tmdbItemType}"`;
      if (el.tmdbEndpoint) dataAttrs += ` data-tmdb-endpoint="${el.tmdbEndpoint.replace(/"/g, '&quot;')}"`;
      if (el.tmdbEndpoint?.startsWith('discover')) {
          dataAttrs += ` data-discover-filters="${encodeURIComponent(JSON.stringify(el.discoverFilters))}"`;
      }
      
      const imgStyle = `width:100%;height:100%;object-fit:${el.imageFit || 'cover'};`;
      let content = '';
      if (el.type === 'text') content = el.content;
      if (el.type === 'image') content = `<img src="${el.content}" style="${imgStyle}" alt="User Image">`;
      
      dataAttrs += ` data-image-fit="${el.imageFit || 'cover'}"`;
      
      return `<div id="${el.id}" ${dataAttrs}>${content}</div>`;
    }).join('\n        ');
    
    const jsScript = `
      const config = <?php echo json_encode($config); ?>;
      const baseImgUrl = 'https://image.tmdb.org/t/p/w500';
      const baseBackdropUrl = 'https://image.tmdb.org/t/p/w1280';

      async function fetchData(url) {
        try {
          const r = await fetch(url);
          return r.ok ? await r.json() : null;
        } catch (e) {
          console.error('Fetch error:', e);
          return null;
        }
      }

      function getBestLogo(logos, lang) {
        if (!logos || logos.length === 0) return null;
        const langLogo = logos.find(l => l.iso_639_1 === lang.substring(0,2));
        const enLogo = logos.find(l => l.iso_639_1 === 'en');
        const logo = langLogo || enLogo || logos[0];
        return baseImgUrl + (logo?.file_path || '');
      }

      document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-type^="tmdb-"]').forEach(el => {
          const { type, tmdbId, itemType, tmdbEndpoint, discoverFilters, imageFit } = el.dataset;
          const imgStyle = \`width:100%;height:100%;object-fit:\${imageFit || 'cover'}\`;
          
          let url;
          const p = new URLSearchParams({ api_key: config.apiKey, language: config.lang, include_adult: config.adult });
          
          if (tmdbId && itemType) {
            p.append('append_to_response', 'credits,images,videos');
            url = \`https://api.themoviedb.org/3/\${itemType}/\${tmdbId}?\${p.toString()}\`;
          } else if (tmdbEndpoint) {
            if (tmdbEndpoint.startsWith('discover') && discoverFilters) {
                const filters = JSON.parse(decodeURIComponent(discoverFilters));
                p.append('sort_by', filters.sortBy);
                if (filters.genres && filters.genres.length > 0) p.append('with_genres', filters.genres.join(','));
                const yearKey = itemType === 'movie' ? 'primary_release_year' : 'first_air_date_year';
                if (filters.year) p.append(yearKey, filters.year.toString());
            }
            p.append('watch_region', config.region);
            url = \`https://api.themoviedb.org/3/\${tmdbEndpoint}?\${p.toString()}\`;
          } else {
            return;
          }

          fetchData(url).then(data => {
            if (!data) return;
            const isSingleItem = !!tmdbId;
            const results = isSingleItem ? [data] : (data.results || []);
            const item = results[0];
            if (!item) return;

            switch (type) {
              case 'tmdb-poster': el.innerHTML = \`<img src="\${baseImgUrl + item.poster_path}" style="\${imgStyle}" alt="Poster">\`; break;
              case 'tmdb-backdrop': el.innerHTML = \`<img src="\${baseBackdropUrl + item.backdrop_path}" style="\${imgStyle}" alt="Backdrop">\`; break;
              case 'tmdb-logo':
                const logoUrl = getBestLogo(item.images?.logos, config.lang);
                if (logoUrl) el.innerHTML = \`<img src="\${logoUrl}" style="\${imgStyle}" alt="Logo">\`;
                break;
              case 'tmdb-title': el.innerText = item.title || item.name; break;
              case 'tmdb-overview': el.innerText = item.overview; break;
              case 'tmdb-tagline': el.innerText = item.tagline; break;
              case 'tmdb-release-date': el.innerText = item.release_date || item.first_air_date; break;
              case 'tmdb-runtime':
                const rt = item.runtime || (item.episode_run_time && item.episode_run_time[0]);
                if(rt) el.innerText = \`\${rt} min\`;
                break;
              case 'tmdb-season-episode-count':
                  if (item.number_of_seasons) el.innerHTML = \`<span>\${item.number_of_seasons} S</span><span class="mx-2 opacity-50">|</span><span>\${item.number_of_episodes} E</span>\`;
                  break;
              case 'tmdb-network-logo':
                if (item.networks && item.networks.length > 0 && item.networks[0].logo_path) 
                  el.innerHTML = \`<img src="\${baseImgUrl + item.networks[0].logo_path}" style="\${imgStyle}" alt="Network Logo">\`;
                break;
              case 'tmdb-rating':
                const rating = Math.round(item.vote_average / 2);
                el.innerHTML = Array(5).fill(0).map((_, j) => \`<span class="\${j < rating ? 'text-yellow-400' : 'text-gray-600'}">★</span>\`).join('');
                break;
              case 'tmdb-genres':
                if (item.genres) el.innerHTML = item.genres.map(g => \`<span class="genre-pill">\${g.name}</span>\`).join('');
                break;
              case 'tmdb-poster-scroll':
                el.style.cssText = 'display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:5px;';
                results.forEach(m => { if (m.poster_path) el.innerHTML += \`<img src="\${baseImgUrl + m.poster_path}" class="scroll-img" alt="\${m.title || m.name}">\` });
                break;
              case 'tmdb-cast':
                el.style.cssText = 'display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:5px;text-align:center;font-size:0.8em;';
                if (item.credits && item.credits.cast) item.credits.cast.slice(0, 15).forEach(c => {
                  if (c.profile_path) el.innerHTML += \`<div class="cast-member"><img src="\${baseImgUrl + c.profile_path}" alt="\${c.name}"><p>\${c.name}</p></div>\`;
                });
                break;
              case 'tmdb-backdrop-slideshow':
                const backdrops = results.map(m => m.backdrop_path).filter(Boolean);
                if (backdrops.length > 0) {
                  let currentIdx = 0;
                  const paths = backdrops.map(p => baseBackdropUrl + p);
                  el.style.backgroundImage = \`url(\${paths[0]})\`;
                  el.style.backgroundSize = 'cover';
                  el.style.backgroundPosition = 'center';
                  el.style.transition = 'background-image 1s ease-in-out';
                  if (paths.length > 1) {
                    setInterval(() => {
                      currentIdx = (currentIdx + 1) % paths.length;
                      el.style.backgroundImage = \`url(\${paths[currentIdx]})\`;
                    }, 5000);
                  }
                }
                break;
            }
          });
        });
      });
    `;

    return `<?php $config = array("apiKey" => "${config.apiKey}", "lang" => "${config.lang}", "region" => "${config.region}", "adult" => ${config.adult ? 'true' : 'false'}); ?>
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"><title>TMDB Dynamic Layout</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Montserrat:wght@400;500;600;700&family=Lato:wght@400;700&family=Oswald:wght@400;500;600;700&display=swap');body{margin:0;background-color:#0f172a;}#canvas{position:relative;width:${width}px;height:${height}px;margin:auto;overflow:hidden;}#canvas::-webkit-scrollbar{display:none;}${styles}
.genre-pill{background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:99px;margin-right:4px;font-size:0.8em;display:inline-block;}.scroll-img{height:95%;width:auto;border-radius:4px;flex-shrink:0;scroll-snap-align:start;}.cast-member{flex-shrink:0;width:80px;}.cast-member img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:50%;}.cast-member p{font-size:0.7em;margin:4px 0 0 0;white-space:normal;line-height:1.2;}</style>
</head><body><div id="canvas">${bodyHtml}</div><script>${this.minifyJS(jsScript)}</script></body></html>`;
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
