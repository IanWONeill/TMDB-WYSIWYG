# 🎬 TMDB WYSIWYG Layout Editor

A powerful, browser-based visual editor for creating dynamic layouts using The Movie Database (TMDB) API. Design custom movie/TV show interfaces with drag-and-drop elements, real-time data binding, and professional styling—no coding required.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Angular](https://img.shields.io/badge/Angular-20-red.svg)](https://angular.io/)
[![TMDB](https://img.shields.io/badge/Powered%20by-TMDB-01b4e4.svg)](https://www.themoviedb.org/)

> **Built with Google AI Studio** - This project was developed using Google's AI Studio platform.

---

## 🌟 Features

### Visual Canvas Editor
- **Drag & Drop Interface** - Position elements anywhere on the canvas with pixel-perfect precision
- **Real-time Preview** - See your changes instantly as you design
- **Responsive Presets** - Switch between Desktop (1920×1080), Tablet (1280×720), and Mobile (375×667) layouts
- **Grid & Snap** - Optional grid overlay with snap-to-grid functionality for precise alignment
- **Multi-device Preview** - Test your layout across different screen sizes

### Rich Element Library
- **Basic Elements**
  - Text blocks with custom styling
  - Images with URL support
  - Shapes and backgrounds

- **TMDB Data Elements**
  - **Poster** - Movie/TV show poster images
  - **Backdrop** - High-resolution backdrop images
  - **Logo** - Official logos (language-aware)
  - **Network Logo** - TV network branding
  - **Title** - Movie/show titles
  - **Overview** - Plot descriptions
  - **Tagline** - Marketing taglines
  - **Release Date** - Release/air dates
  - **Runtime** - Duration information
  - **Genres** - Category pills
  - **Rating** - Star rating display (5-star system)
  - **Cast** - Actor profiles with photos
  - **Season/Episode Count** - TV show episode information
  - **Dynamic Fields** - Custom data from any API field using dot notation

- **Collection Elements**
  - **Poster Scroll** - Horizontal scrolling poster gallery
  - **Backdrop Slideshow** - Auto-cycling backdrop slideshow

### Advanced Styling
- **Typography**
  - 5 Google Fonts: Inter, Roboto, Montserrat, Lato, Oswald
  - Font size, weight (400/500/600/700), and alignment
  - Text shadows with customizable offset, blur, and color

- **Colors & Effects**
  - Background colors with opacity control
  - Linear gradients (angle, start/end colors)
  - Border radius, width, and color
  - Box shadows
  - Backdrop filters (blur, grayscale)
  - Overall opacity

- **Layout**
  - Rotation (0-360°)
  - Z-index layer ordering
  - Visibility toggle
  - Alignment tools (center, top, bottom, left, right, stretch)

### Layer Management & Data Binding

#### 🔗 Smart Layer Linking
One of the most powerful features is **layer linking** - connect multiple elements to share the same TMDB data source:

**How it works:**
1. Create multiple TMDB elements (poster, title, overview, etc.)
2. Drag one layer onto another in the **Layers panel**
3. All linked layers automatically share the same movie/TV show data
4. Change the TMDB ID on any linked element - all connected elements update together

**Example Use Case:**
```
📁 Movie Card Group
  ├─ Backdrop (linked)
  ├─ Poster (linked)
  ├─ Title (linked)
  ├─ Overview (linked)
  └─ Rating (linked)
```
Search for "Inception" on any element → All elements show Inception data!

#### Dynamic Data Fields
Access any TMDB API field using **dot notation**:
- `vote_average` → Rating score
- `vote_count` → Number of votes
- `credits.cast.0.name` → First actor name
- `production_companies.0.name` → Studio name
- `release_date` → Release date

Add custom **prefix/suffix** text:
- Prefix: "⭐ Rating: " + `vote_average` → "⭐ Rating: 8.1"
- Suffix: `vote_count` + " votes" → "12,534 votes"

### TMDB Integration
- **Dual Authentication** - Support for both TMDB API v3 (Key) and v4 (Bearer Token)
- **Live Search** - Real-time movie/TV show search with instant results
- **Rich Metadata** - Access full TMDB API including credits, images, videos, ratings
- **Collection Endpoints** - Popular, Top Rated, Upcoming, Now Playing, Discover
- **Advanced Filtering** - Genre filters, year filters, sort options for Discover mode
- **Localization** - 100+ languages and regional settings
- **Include Adult Content** - Optional toggle

### Project Management
- **JSON Import/Export** - Save and load entire projects
- **Undo/Redo** - Full history tracking (50 states)
- **Auto-save** - localStorage persistence
- **PHP Code Export** - Generate production-ready PHP files with embedded JavaScript

### Interactive Controls
- **Context Menu** - Right-click elements for quick actions:
  - Duplicate, Delete
  - Copy/Paste styles
  - Bring to front / Send to back
  - Alignment options
  - Image fit modes (Cover/Contain/Fill)

- **Keyboard Shortcuts**
  - `Ctrl+Z` / `Cmd+Z` - Undo
  - `Ctrl+Shift+Z` / `Cmd+Shift+Z` - Redo
  - `Delete` - Remove selected element

---

## 🚀 Getting Started

### Prerequisites
- Node.js v22.12+ or v20.19+
- TMDB API Key or Bearer Token ([Get one here](https://www.themoviedb.org/settings/api))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/IanWONeill/TMDB-WYSIWYG.git
   cd TMDB-WYSIWYG
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run development server**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000
   

4. **Build for production**
   ```bash
   npm run build
   ```
   Output will be in the `dist/` folder

---

## 📖 Usage Guide

### 1. Configure TMDB API

**Settings → API Configuration**
- Choose between **v3 (API Key)** or **v4 (Bearer Token)** authentication
- Paste your credentials
- Set your preferred language and region
- Toggle adult content if needed

**Getting Credentials:**
1. Sign up at [themoviedb.org](https://www.themoviedb.org/)
2. Go to Settings → API
3. For v3: Copy your API Key
4. For v4: Request a Read Access Token (recommended)

### 2. Set Canvas Size

**Settings → Canvas Settings**
- Choose a device category (Mobile/Tablet/TV)
- Pick a resolution from the toolbar dropdown
- Review the current size, aspect ratio, and device preset directly in the resolution selector
- Enable grid overlay for precision
- Toggle snap-to-grid

Defaults are TV landscape at `1280×720` (`16:9`). TV presets include resolutions up to `1920×1080`, while mobile and tablet presets include common device sizes similar to browser device emulation tools.

The zoom control lives in the bottom-right of the canvas viewport. Use **Fit** to scale the canvas to the available editor space while preserving the canvas aspect ratio.

### 3. Add Elements

**Elements Tab → Browse Categories**
- **Basic** - Text, Images, Shapes
- **TMDB** - All movie/TV data elements
- **Collections** - Scrolling galleries and slideshows

**Click any element** to add it to the canvas

### 4. Configure Elements

**Select an element** → Properties Panel shows:
- **Position** - X, Y coordinates
- **Size** - Width, Height
- **Rotation** - 0-360 degrees
- **Content** - Text, image URL, or TMDB search
- **Styles** - Typography, colors, effects
- **TMDB Settings** - Search, collection endpoints, filters

### 5. Link Elements (Data Sharing)

**To create linked groups:**
1. Add multiple TMDB elements (poster, title, overview, etc.)
2. Open the **Layers Panel** (right sidebar)
3. **Drag one layer** onto another layer
4. Both layers are now linked (shown with 🔗 icon)
5. Search for a movie on any linked element
6. All linked elements update together!

**To unlink:**
- Click the 🔗 icon next to any layer in the Layers panel

**Sync from Properties:**
- Select any TMDB content element such as poster, title, overview, cast, rating, logo, or dynamic field
- Open **Properties → TMDB Data Source → Sync with layer**
- Choose a slideshow, poster scroll, or other TMDB source layer
- The synced element will share that layer's data and can follow the current slideshow item
- For backdrop slideshows, synced posters, titles, overviews, cast, ratings, logos, and dynamic fields update to the same TMDB item as the visible backdrop slide

### 6. Style Elements

**Properties → Styles**
- **Background**: Color, opacity, gradient
- **Typography**: Font, size, weight, alignment, color
- **Borders**: Radius, width, color
- **Effects**: Shadows, blur, grayscale, opacity

**Quick Actions (Right-click menu):**
- Copy/Paste styles between elements
- Alignment shortcuts
- Layer ordering

**Backdrop sizing shortcuts:**
- Select a TMDB backdrop or backdrop slideshow
- Use **Fill Width**, **Fill Height**, or **Cover Canvas** in Properties
- The element keeps TMDB's standard `16:9` backdrop ratio while fitting the current canvas

### 7. Work with Collections

**Poster Scroll / Backdrop Slideshow:**
1. Add the collection element
2. Select it → Properties
3. Choose TMDB collection type (Popular, Top Rated, etc.)
4. For Discover: Set genre filters, year, sort order
5. Set **Items Shown** to control how many TMDB results are displayed
6. Element auto-populates with TMDB results

**Link with other elements:**
- Slideshows can control linked elements
- When slideshow changes, linked elements update to show current item
- Synced collection layers use the source collection's item count
- Backdrop slideshows can use **Global Scene Fade** so the backdrop and synced layers fade together

**Scene-synchronised layouts:**
- Add a **Backdrop Slideshow** as the scene source
- Add poster, overview, cast, rating, logo, or dynamic-field layers
- Select each TMDB layer and choose the slideshow in **Properties → Sync with layer**
- Enable **Global Scene Fade** on the slideshow for a single fade between full scene states
- The editor and generated PHP export keep every linked layer on the same TMDB item for each slide

### 8. Export Your Layout

**Settings → Project Management**

**Option 1: Save Project (JSON)**
- Click "Export JSON"
- Save the `.json` file
- Re-import later to continue editing

**Option 2: Generate PHP Code**
- Click "Generate PHP"
- Download the `.php` file
- Upload to your web server
- Fully functional, standalone HTML/PHP/JavaScript file

The PHP export includes:
- Responsive CSS (percentage-based positioning)
- TMDB API integration through the generated PHP file
- Server-side credential handling (the browser receives source IDs, not the TMDB key/token)
- File-based response caching with lock protection for concurrent viewers
- Auto-updating content
- Production-ready code

**Concurrent viewer behavior:** the exported PHP file now acts as a same-origin TMDB proxy. Browser JavaScript calls `layout.php?tmdb_source=<id>`, and PHP fetches/caches the TMDB response server-side. Cache writes use file locks so multiple users loading the same layout at once do not all request the same TMDB endpoint simultaneously. Serve the export through PHP; do not publish it as plain text.

---

## 🎨 Design Tips

### Creating Movie Cards
1. Add a **Backdrop** as background
2. Add a **Poster** on top
3. Add **Title**, **Overview**, **Rating**
4. **Link all elements** by dragging layers together
5. Search for any movie - entire card updates!

### Building Galleries
1. Use **Poster Scroll** for horizontal galleries
2. Set collection to "Popular" or "Top Rated"
3. Style the container (background, borders)
4. Auto-scrolling animation included

### Dynamic Slideshows
1. Add **Backdrop Slideshow** as background
2. Add linked elements (title, tagline, overview)
3. Set collection source (Trending, Upcoming, etc.)
4. Slideshow auto-cycles every 5 seconds
5. Linked elements update with each slide

### Responsive Design
- Use percentage values mentally (canvas scales automatically)
- Test all three presets (Desktop/Tablet/Mobile)
- Consider mobile-first or desktop-first approach
- Hide elements on specific sizes using visibility toggle

---

## 🛠️ Technical Details

### Built With
- **Framework**: Angular 20 (Zoneless)
- **Styling**: TailwindCSS
- **Icons**: Font Awesome 6
- **Interactions**: Interact.js (drag, resize)
- **API**: TMDB API v3 & v4
- **Language**: TypeScript

### Browser Support
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

### Performance
- Virtual scrolling for large layer lists
- Debounced API calls
- Efficient change detection
- Local state management

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Credits

- **TMDB API** - Movie and TV show data provided by [The Movie Database](https://www.themoviedb.org/)
- **Google AI Studio** - This project was built using Google's AI Studio platform
- **Icons** - Font Awesome
- **Fonts** - Google Fonts

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📧 Contact

Made with ❤️ by [Ian](https://t.me/ianwoneill)

**Repository**: [https://github.com/IanWONeill/TMDB-WYSIWYG](https://github.com/IanWONeill/TMDB-WYSIWYG)

---

## 🎬 Screenshots

![TMDB WYSIWYG Editor Interface](assets/editor-screenshot.png)
*The intuitive drag-and-drop interface with element library, canvas, and properties panel*

---

**Disclaimer**: This product uses the TMDB API but is not endorsed or certified by TMDB.
