// Vector Drawing Canvas App
// Minimal implementation with smooth drawing, pan/zoom, and sharing

// --- Tactus (MIT) — https://github.com/aadeexyz/tactus — inlined so one script file loads everywhere (no ES module / .mjs fetch on GitHub Pages or strict MIME hosts)
const HAPTIC_ID = '___haptic-switch___';
const HAPTIC_DURATION_MS = 10;

function tactusIsIOS() {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const iOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return iOSDevice || iPadOS;
}

let tactusInput = null;
let tactusLabel = null;

function tactusMount() {
    if (tactusLabel && tactusInput) return;
    try {
        tactusInput = document.querySelector(`#${HAPTIC_ID}`);
        tactusLabel = document.querySelector(`label[for="${HAPTIC_ID}"]`);
        if (tactusInput && tactusLabel) return;
        if (!document.body) return;
        tactusInput = document.createElement('input');
        tactusInput.type = 'checkbox';
        tactusInput.id = HAPTIC_ID;
        tactusInput.setAttribute('switch', '');
        tactusInput.style.display = 'none';
        document.body.appendChild(tactusInput);
        tactusLabel = document.createElement('label');
        tactusLabel.htmlFor = HAPTIC_ID;
        tactusLabel.style.display = 'none';
        document.body.appendChild(tactusLabel);
    } catch (e) {
        /* Home-screen WebKit can be strict; haptics are optional */
    }
}

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tactusMount, { once: true });
    } else {
        tactusMount();
    }
}

function triggerHaptic(duration = HAPTIC_DURATION_MS) {
    if (typeof window === 'undefined') return;
    try {
        if (tactusIsIOS()) {
            if (!tactusInput || !tactusLabel) tactusMount();
            tactusLabel?.click();
        } else if (navigator?.vibrate) {
            navigator.vibrate(duration);
        } else {
            if (!tactusInput || !tactusLabel) tactusMount();
            tactusLabel?.click();
        }
    } catch (e) {
        /* iOS standalone often rejects synthetic clicks; must not break the app */
    }
}

// Triple "tik tik tik" when tool toggle is tapped but eraser is unavailable (no strokes yet)
let lastDisabledToolToggleHapticAt = 0;
function triggerDisabledToolToggleHaptic() {
    const now = Date.now();
    if (now - lastDisabledToolToggleHapticAt < 400) return;
    lastDisabledToolToggleHapticAt = now;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (typeof navigator.vibrate === 'function') {
        try {
            navigator.vibrate([10, 45, 10, 45, 10]);
        } catch (e) { /* ignore */ }
    }
    if (isIOS || typeof navigator.vibrate !== 'function') {
        triggerHaptic();
        setTimeout(() => triggerHaptic(), 52);
        setTimeout(() => triggerHaptic(), 104);
    }
}

// Detect if app is running in standalone mode (home screen web app)
function detectStandaloneMode() {
    if (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches) {
        document.body.classList.add('standalone-mode');
    }
}

// Run detection when page loads
detectStandaloneMode();

// Prevent browser zoom while keeping canvas zoom
function preventBrowserZoom() {
    // Prevent zoom with keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '0')) {
            e.preventDefault();
        }
    });
    
    // Prevent zoom with mouse wheel + Ctrl/Cmd
    document.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // Prevent zoom gestures on touch devices (but allow on canvas)
    document.addEventListener('touchstart', function(e) {
        if (e.touches.length > 1 && e.target !== document.getElementById('drawingCanvas')) {
            e.preventDefault();
        }
    }, { passive: false });
    
    document.addEventListener('touchmove', function(e) {
        if (e.touches.length > 1 && e.target !== document.getElementById('drawingCanvas')) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // More aggressive double-tap prevention for toolbar area
    let touchHistory = [];
    
    // Track all touches in toolbar area
    document.addEventListener('touchstart', function(e) {
        const touch = e.touches[0];
        const rect = document.querySelector('.toolbar')?.getBoundingClientRect();
        
        if (rect && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
            const now = Date.now();
            
            // Add this touch to history
            touchHistory.push({
                time: now,
                x: touch.clientX,
                y: touch.clientY
            });
            
            // Keep only last 500ms of touches
            touchHistory = touchHistory.filter(t => now - t.time < 500);
            
            // If we have multiple touches in toolbar area within 500ms, prevent zoom
            if (touchHistory.length > 1) {
                // Check if any recent touches are close to current one (double-tap)
                const recent = touchHistory.filter(t => now - t.time < 400);
                for (let prevTouch of recent.slice(0, -1)) {
                    const distance = Math.sqrt(
                        Math.pow(touch.clientX - prevTouch.x, 2) + 
                        Math.pow(touch.clientY - prevTouch.y, 2)
                    );
                    
                    // If touches are close together (within 50px), it's likely a double-tap
                    if (distance < 50) {
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    }
                }
            }
        }
    }, { passive: false });
    
    // Also prevent on touchend for extra safety
    document.addEventListener('touchend', function(e) {
        const rect = document.querySelector('.toolbar')?.getBoundingClientRect();
        if (rect && e.changedTouches[0].clientY >= rect.top && e.changedTouches[0].clientY <= rect.bottom) {
            const now = Date.now();
            
            // Check recent touch history for potential double-tap
            const recentTouches = touchHistory.filter(t => now - t.time < 400);
            if (recentTouches.length > 1) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }
    }, { passive: false });
}

// Initialize zoom prevention
preventBrowserZoom();

// Canvas tap timing: single tap deselects, double tap creates text.
const CANVAS_DOUBLE_TAP_MS = 280;
const CANVAS_DOUBLE_TAP_DISTANCE_PX = 44;
const CANVAS_TAP_MOVE_THRESHOLD_PX = 6;
// Touch-hold timing: hold a text box for this long to auto-select it.
// Keep a short delay so pinch gestures can register a second finger first.
const TEXT_HOLD_TO_SELECT_MS = 100;

class DrawingApp {
    constructor() {
        // Canvas and context setup
        this.canvas = document.getElementById('drawingCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Drawing state
        this.strokes = []; // Array of stroke objects
        this.currentStroke = null; // Currently being drawn
        this.isDirty = true; // Needs redraw
        
        // Transform state (pan/zoom)
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        
        // Gesture state
        this.isDrawing = false;
        this.pointers = new Map(); // Track active pointers
        this.lastTwoFingerDistance = 0;
        this.lastTwoFingerCenter = { x: 0, y: 0 };
        
        // Lazy brush state (smooth drawing)
        this.lazyRadius = 8; // Radius of lazy area
        this.pointerPos = { x: 0, y: 0 }; // Current pointer position
        this.brushPos = { x: 0, y: 0 }; // Current brush position
        this.lazyEnabled = true;
        
        // Drawing settings
        this.baseLineWidth = 5;
        
        // Tool state
        this.currentTool = 'brush'; // 'brush' or 'eraser'
        
        // History system
        this.history = [];
        this.historyIndex = -1;
        
        // Clear confirmation state
        this.clearConfirmMode = false;
        this.clearClickInProgress = false;
        
        // Splash screen state
        this.drawingEnabled = false; // Start with drawing disabled
        this.splashScreen = document.getElementById('splashScreen');

        // Text labels (world coordinates; drawn as DOM above canvas)
        this.textObjects = [];
        this.textLayer = document.getElementById('textLayer');
        this.textEditPanel = document.getElementById('textEditPanel');
        this.selectedTextId = null;
        this.canvasTapDeselectTimer = null;
        this.lastCanvasTap = null;
        this.pointerTapCandidates = new Map();
        this.lastPointerScreenPos = { x: 0, y: 0 };
        this.textDragState = null;
        this.pendingStrokeHistoryBefore = null;
        this.pendingTextStyleHistoryBefore = null;
        this.pendingTextInputHistory = new Map();
        this.textViewportTweenRafId = null;
        this.instantTextViewportFit = false;
        this.instantTextViewportFitAt = 0;

        // Local-only share preview state (used in localhost/home-screen testing).
        this.localSharePreviewOverlay = null;
        this.localSharePreviewImage = null;
        this.localSharePreviewObjectUrl = null;
        this.localSharePreviewShowRaf = null;

            // Initialize
    this.setupSplashScreen();
    this.setupCanvas();
    this.setupEventListeners();
    this.setupUI();
    this.setupTextLayer();
    this.setupThemeObserver();
    this.render();
    }

    // Splash screen management
    setupSplashScreen() {
        // Check if user has seen the splash screen before
        let hasSeenSplash = false;
        try {
            hasSeenSplash = localStorage.getItem('canvas-app-splash-seen') === 'true';
        } catch (e) {
            /* Treat as first launch if storage is unavailable (rare in home-screen) */
        }
        
        // Show splash screen if first time or if forced for testing
        if (!hasSeenSplash || this.shouldShowSplashForTesting()) {
            this.showSplashScreen();
        } else {
            this.hideSplashScreen();
        }
        
        // Set up "Got it" button
        const gotItBtn = document.getElementById('gotItBtn');
        gotItBtn.addEventListener('click', () => this.dismissSplashScreen());
        gotItBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dismissSplashScreen();
        });
        
        // Add testing keyboard shortcuts (for development/testing)
        this.setupTestingControls();
        
        // Add mobile-friendly reset gesture
        this.setupMobileResetGesture();
    }
    
    // Check if splash should be shown for testing purposes
    shouldShowSplashForTesting() {
        // Check for URL parameter or sessionStorage flag for testing
        const urlParams = new URLSearchParams(window.location.search);
        const forceShow = urlParams.get('showSplash') === 'true';
        const resetSplash = urlParams.get('reset') === 'true';
        const sessionForce = sessionStorage.getItem('canvas-force-splash') === 'true';
        
        // If reset parameter is found, clear the localStorage and show splash
        if (resetSplash) {
            localStorage.removeItem('canvas-app-splash-seen');
            console.log('Splash screen reset via URL parameter');
        }
        
        return forceShow || sessionForce || resetSplash;
    }
    
    // Show the splash screen and disable drawing
    showSplashScreen() {
        this.splashScreen.style.removeProperty('display');
        this.splashScreen.classList.remove('hidden');
        this.drawingEnabled = false;
        console.log('Splash screen shown - drawing disabled');
    }
    
    // Hide the splash screen and enable drawing
    hideSplashScreen() {
        this.splashScreen.classList.add('hidden');
        
        // Wait for the transition to complete before enabling drawing
        setTimeout(() => {
            this.drawingEnabled = true;
            console.log('Splash screen hidden - drawing enabled');
        }, 300); // 0.3 seconds to match CSS transition
        
        // iOS home-screen: invisible fixed layers can still steal touches; remove overlay from layout
        setTimeout(() => {
            this.splashScreen.style.display = 'none';
        }, 320);
    }
    
    // Dismiss splash screen and remember user has seen it
    dismissSplashScreen() {
        // Haptics first must never block enabling drawing (home-screen WebKit is picky)
        try {
            triggerHaptic();
        } catch (e) { /* ignore */ }
        this.hideSplashScreen();
        try {
            localStorage.setItem('canvas-app-splash-seen', 'true');
        } catch (e) {
            /* Some home-screen / private contexts restrict storage */
        }
        // Clear any testing flags
        sessionStorage.removeItem('canvas-force-splash');
        console.log('Splash screen dismissed and saved to localStorage');
    }
    
    // Testing controls for splash screen
    setupTestingControls() {
        // Listen for keyboard shortcuts (for testing)
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Shift + S = Show splash screen
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
                e.preventDefault();
                sessionStorage.setItem('canvas-force-splash', 'true');
                this.showSplashScreen();
                console.log('Testing: Splash screen force-shown');
            }
            
            // Ctrl/Cmd + Shift + H = Hide splash screen
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
                e.preventDefault();
                sessionStorage.removeItem('canvas-force-splash');
                this.hideSplashScreen();
                console.log('Testing: Splash screen force-hidden');
            }
            
            // Ctrl/Cmd + Shift + R = Reset (clear localStorage)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
                e.preventDefault();
                localStorage.removeItem('canvas-app-splash-seen');
                sessionStorage.removeItem('canvas-force-splash');
                this.showSplashScreen();
                console.log('Testing: Reset splash screen state');
            }
        });
        
        // Add a simple console method for testing
        window.canvasSplashTesting = {
            show: () => {
                sessionStorage.setItem('canvas-force-splash', 'true');
                this.showSplashScreen();
            },
            hide: () => {
                sessionStorage.removeItem('canvas-force-splash');
                this.hideSplashScreen();
            },
            reset: () => {
                localStorage.removeItem('canvas-app-splash-seen');
                sessionStorage.removeItem('canvas-force-splash');
                this.showSplashScreen();
            }
        };
        
        console.log('Testing controls available:');
        console.log('- canvasSplashTesting.show() - Force show splash');
        console.log('- canvasSplashTesting.hide() - Force hide splash');
        console.log('- canvasSplashTesting.reset() - Reset to first-time state');
        console.log('- Ctrl/Cmd + Shift + S - Show splash');
        console.log('- Ctrl/Cmd + Shift + H - Hide splash');
        console.log('- Ctrl/Cmd + Shift + R - Reset splash state');
        console.log('- Add ?reset=true to URL - Reset splash and show it');
        console.log('- Long press on empty canvas - Reset splash state');
    }
    
    // Mobile-friendly reset gesture
    setupMobileResetGesture() {
        let longPressTimer = null;
        let touchStartTime = 0;
        
        // Add long press listener to canvas
        this.canvas.addEventListener('touchstart', (e) => {
            // Only trigger on empty canvas (no strokes) and when splash is hidden
            if (
                this.strokes.length === 0 &&
                this.textObjects.length === 0 &&
                this.drawingEnabled &&
                e.touches.length === 1
            ) {
                touchStartTime = Date.now();
                
                // Set timer for long press (1.5 seconds)
                longPressTimer = setTimeout(() => {
                    // Reset splash screen state
                    localStorage.removeItem('canvas-app-splash-seen');
                    this.showSplashScreen();
                    console.log('Splash screen reset via long press on empty canvas');
                    
                    // Provide haptic feedback if available
                    if (navigator.vibrate) {
                        navigator.vibrate(100);
                    }
                }, 1500);
            }
        }, { passive: true });
        
        // Cancel long press if touch moves or ends early
        this.canvas.addEventListener('touchmove', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });
        
        this.canvas.addEventListener('touchend', (e) => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });
        
        this.canvas.addEventListener('touchcancel', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });
    }

    // Canvas initialization with proper high-DPI support and accurate coordinates
    setupCanvas() {
        // Debounced resize function to prevent performance issues
        let resizeTimeout;
        const resizeCanvas = () => {
            // Clear any pending resize to debounce rapid calls
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
            }
            
            resizeTimeout = setTimeout(() => {
                const dpr = window.devicePixelRatio || 1;
                const rect = this.canvas.getBoundingClientRect();
                
                // Store device pixel ratio and display dimensions
                this.devicePixelRatio = dpr;
                this.canvasWidth = rect.width;
                this.canvasHeight = rect.height;
                
                // Set internal canvas size with device pixel ratio for crisp rendering
                this.canvas.width = rect.width * dpr;
                this.canvas.height = rect.height * dpr;
                
                // Scale context for high-DPI, but we'll handle coordinates manually
                this.ctx.scale(dpr, dpr);
                
                // Set CSS size to display size
                this.canvas.style.width = rect.width + 'px';
                this.canvas.style.height = rect.height + 'px';
                
                this.isDirty = true;
                
                console.log('Canvas resized:', rect.width, 'x', rect.height, 'DPR:', dpr);
            }, 100); // 100ms debounce
        };
        
        // Initial setup
        resizeCanvas();
        
        // Listen for window resize events
        window.addEventListener('resize', resizeCanvas);
        
        // Listen for orientation changes specifically (mobile devices)
        window.addEventListener('orientationchange', () => {
            // Clear any active drawing when orientation changes to prevent coordinate issues
            this.stopDrawing();
            
            // Add extra delay for orientation changes as they can be slower
            setTimeout(() => {
                resizeCanvas();
                // Force recalibration of drawing coordinates
                this.recalibrateCoordinates();
            }, 200);
        });
        
        // Listen for visual viewport changes (iOS Safari address bar, etc.)
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', resizeCanvas);
        }
        
        // Fallback: Periodic check for size changes (helps with some edge cases)
        this.setupCanvasSizeWatcher();
    }
    
    // Size watcher for devices that don't fire resize events properly
    setupCanvasSizeWatcher() {
        let lastWidth = window.innerWidth;
        let lastHeight = window.innerHeight;
        
        // Check every second for size changes
        setInterval(() => {
            const currentWidth = window.innerWidth;
            const currentHeight = window.innerHeight;
            
            if (currentWidth !== lastWidth || currentHeight !== lastHeight) {
                console.log('Size change detected via watcher:', currentWidth, 'x', currentHeight);
                
                // Trigger a resize after a short delay
                setTimeout(() => {
                    const rect = this.canvas.getBoundingClientRect();
                    const dpr = window.devicePixelRatio || 1;
                    
                    this.devicePixelRatio = dpr;
                    this.canvasWidth = rect.width;
                    this.canvasHeight = rect.height;
                    
                    this.canvas.width = rect.width * dpr;
                    this.canvas.height = rect.height * dpr;
                    
                    this.ctx.scale(dpr, dpr);
                    
                    this.canvas.style.width = rect.width + 'px';
                    this.canvas.style.height = rect.height + 'px';
                    
                    this.isDirty = true;
                }, 100);
                
                lastWidth = currentWidth;
                lastHeight = currentHeight;
            }
        }, 1000);
    }
    
    // Recalibrate coordinate system after orientation change
    recalibrateCoordinates() {
        // Reset any cached coordinate calculations
        this.pointers.clear();
        this.isDrawing = false;
        this.currentStroke = null;
        
        // Force a fresh coordinate calculation by triggering a redraw
        this.isDirty = true;
        
        console.log('Coordinates recalibrated after orientation change');
    }

    // Coordinate transformation helpers
    screenToWorld(screenPoint) {
        return {
            x: (screenPoint.x - this.panX) / this.scale,
            y: (screenPoint.y - this.panY) / this.scale
        };
    }

    worldToScreen(worldPoint) {
        return {
            x: worldPoint.x * this.scale + this.panX,
            y: worldPoint.y * this.scale + this.panY
        };
    }

    // Get pointer position relative to canvas (handles high-DPI properly)
    getPointerPos(event) {
        const rect = this.canvas.getBoundingClientRect();
        // Use display coordinates directly - devicePixelRatio scaling is handled by context
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    // Lazy brush math helpers
    getDistance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    getAngle(p1, p2) {
        return Math.atan2(p2.y - p1.y, p2.x - p1.x);
    }

    // Update lazy brush position based on pointer movement (inspired by lazy-brush library)
    updateLazyBrush(newPointerPos, friction = 0) {
        this.pointerPos = newPointerPos;
        
        if (!this.lazyEnabled) {
            this.brushPos = { ...newPointerPos };
            return true;
        }

        const distance = this.getDistance(this.brushPos, this.pointerPos);
        
        // Only move brush if pointer is outside the lazy radius
        if (distance > this.lazyRadius) {
            const angle = this.getAngle(this.brushPos, this.pointerPos);
            
            // Calculate how far to move the brush
            let moveDistance = distance - this.lazyRadius;
            
            // Apply friction if specified
            if (friction > 0) {
                moveDistance *= (1 - friction);
            }
            
            // Move brush toward pointer
            this.brushPos.x += Math.cos(angle) * moveDistance;
            this.brushPos.y += Math.sin(angle) * moveDistance;
            
            return true; // Brush moved
        }
        
        return false; // Brush didn't move
    }

    // Event listeners setup
    setupEventListeners() {
        // Add aggressive iOS input actions prevention
        this.setupIOSInputActionsPrevention();
        
        // Use pointer events with touch/mouse fallback
        if ('PointerEvent' in window) {
            this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this), { passive: false });
            this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this), { passive: false });
            this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this), { passive: false });
            this.canvas.addEventListener('pointercancel', this.handlePointerUp.bind(this), { passive: false });
        } else {
            // Fallback to touch and mouse events
            this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
            this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
            this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
            this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this), { passive: false });
            this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this), { passive: false });
            this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this), { passive: false });
        }
    }

    // iOS input actions prevention - prevents context menus and text selection behaviors
    setupIOSInputActionsPrevention() {
        // Prevent context menu on long press or right click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }, { passive: false });
        
        // Prevent selection start on canvas
        this.canvas.addEventListener('selectstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }, { passive: false });
        
        // Prevent drag events that can trigger iOS behaviors
        this.canvas.addEventListener('dragstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }, { passive: false });
        
        // Additional touchstart prevention for iOS input actions
        this.canvas.addEventListener('touchstart', (e) => {
            // Prevent default to stop iOS from interpreting touches as text selection
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false, capture: true });
        
        // Prevent iOS from showing selection handles on touchend
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false, capture: true });
        
        // Prevent focus events that might trigger input behaviors
        this.canvas.addEventListener('focus', (e) => {
            e.preventDefault();
            this.canvas.blur(); // Remove focus immediately
        }, { passive: false });
        
        // Global prevention for the entire document when canvas is active
        let isCanvasActive = false;
        
        this.canvas.addEventListener('touchstart', () => {
            isCanvasActive = true;
        }, { passive: true });
        
        document.addEventListener('touchend', () => {
            isCanvasActive = false;
        }, { passive: true });
        
        // Prevent document-level selection when canvas is active
        document.addEventListener('selectstart', (e) => {
            if (isCanvasActive || e.target === this.canvas) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }, { passive: false });
        
        // Additional prevention for iOS Safari specific behaviors
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
            // iOS-specific prevention
            this.canvas.addEventListener('touchstart', (e) => {
                // Clear any existing selection
                if (window.getSelection) {
                    window.getSelection().removeAllRanges();
                }
                if (document.selection) {
                    document.selection.empty();
                }
            }, { passive: true });
        }
    }

    // Pointer event handlers
    handlePointerDown(event) {
        event.preventDefault();
        const pos = this.getPointerPos(event);
        this.lastPointerScreenPos = pos;
        this.pointers.set(event.pointerId, pos);

        // Track pointer as a potential tap (used for double-tap text insertion).
        this.pointerTapCandidates.set(event.pointerId, {
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            hadMultiTouch: false
        });
        
        if (this.pointers.size === 1) {
            // Text selected/focused: allow tap-to-deselect only, never draw.
            if (this.isTextInputInteractionActive()) {
                return;
            }
            // Single finger - start drawing
            this.startDrawing(pos);
        } else if (this.pointers.size === 2) {
            this.markTapCandidatesAsMultiTouch();
            // Two fingers - stop drawing and prepare for pan/zoom
            this.stopDrawing();
            this.initializeTwoFingerGesture();
        }
    }

    handlePointerMove(event) {
        event.preventDefault();
        const pos = this.getPointerPos(event);
        if (this.pointers.size === 1 && this.isDrawing) {
            this.lastPointerScreenPos = pos;
        }

        if (this.pointers.has(event.pointerId)) {
            this.pointers.set(event.pointerId, pos);

            const tapCandidate = this.pointerTapCandidates.get(event.pointerId);
            if (tapCandidate && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
                const dx = event.clientX - tapCandidate.startX;
                const dy = event.clientY - tapCandidate.startY;
                if (dx * dx + dy * dy > CANVAS_TAP_MOVE_THRESHOLD_PX * CANVAS_TAP_MOVE_THRESHOLD_PX) {
                    tapCandidate.moved = true;
                }
            }
            
            if (this.pointers.size === 1 && this.isDrawing) {
                // Single finger - continue drawing
                this.continueDrawing(pos);
            } else if (this.pointers.size === 2) {
                this.markTapCandidatesAsMultiTouch();
                // Two fingers - pan and zoom
                this.handleTwoFingerGesture();
            }
        }
    }

    handlePointerUp(event) {
        event.preventDefault();
        const wasLastPointer = this.pointers.size === 1;
        const tapCandidate = this.pointerTapCandidates.get(event.pointerId);
        if (typeof event.clientX === 'number') {
            this.lastPointerScreenPos = this.getPointerPos(event);
        }
        this.pointers.delete(event.pointerId);
        this.pointerTapCandidates.delete(event.pointerId);

        if (
            wasLastPointer &&
            tapCandidate &&
            !tapCandidate.moved &&
            !tapCandidate.hadMultiTouch &&
            typeof event.clientX === 'number' &&
            typeof event.clientY === 'number'
        ) {
            const screenPos = { x: event.clientX, y: event.clientY };
            this.handleCanvasTap(this.screenToWorld(screenPos), screenPos);
        }
        
        if (this.pointers.size === 0) {
            // No more pointers - stop drawing
            this.stopDrawing();
        } else if (this.pointers.size === 1) {
            // Back to one finger - could resume drawing
            const remainingPos = this.pointers.values().next().value;
            this.startDrawing(remainingPos);
        }
    }

    // Mark current touch candidates as multi-touch (not valid as taps).
    markTapCandidatesAsMultiTouch() {
        for (const candidate of this.pointerTapCandidates.values()) {
            candidate.hadMultiTouch = true;
        }
    }

    // Touch event fallbacks
    handleTouchStart(event) {
        event.preventDefault();
        for (const touch of event.changedTouches) {
            this.handlePointerDown({
                pointerId: touch.identifier,
                clientX: touch.clientX,
                clientY: touch.clientY,
                preventDefault: () => {}
            });
        }
    }

    handleTouchMove(event) {
        event.preventDefault();
        for (const touch of event.changedTouches) {
            this.handlePointerMove({
                pointerId: touch.identifier,
                clientX: touch.clientX,
                clientY: touch.clientY,
                preventDefault: () => {}
            });
        }
    }

    handleTouchEnd(event) {
        event.preventDefault();
        for (const touch of event.changedTouches) {
            this.handlePointerUp({
                pointerId: touch.identifier,
                clientX: touch.clientX,
                clientY: touch.clientY,
                preventDefault: () => {}
            });
        }
    }

    // Mouse event fallbacks
    handleMouseDown(event) {
        this.handlePointerDown({
            pointerId: 'mouse',
            clientX: event.clientX,
            clientY: event.clientY,
            preventDefault: () => event.preventDefault()
        });
    }

    handleMouseMove(event) {
        this.handlePointerMove({
            pointerId: 'mouse',
            clientX: event.clientX,
            clientY: event.clientY,
            preventDefault: () => event.preventDefault()
        });
    }

    handleMouseUp(event) {
        this.handlePointerUp({
            pointerId: 'mouse',
            clientX: event.clientX,
            clientY: event.clientY,
            preventDefault: () => event.preventDefault()
        });
    }

    // Shared guard: while text is selected or focused, brush/eraser must stay inactive.
    isTextInputInteractionActive() {
        const active = document.activeElement;
        const textareaFocused =
            active && active.classList && active.classList.contains('canvas-text-item__input');
        return !!this.selectedTextId || !!textareaFocused;
    }

    // Drawing functions with lazy brush
    startDrawing(screenPos) {
        // Don't start drawing if drawing is disabled (splash screen visible)
        if (!this.drawingEnabled) {
            return;
        }

        // Hard stop for drawing while text editing/selection is active.
        if (this.isTextInputInteractionActive()) {
            return;
        }

        this.isDrawing = true;
        this.pendingStrokeHistoryBefore = this.captureCanvasState();
        
        // Initialize both pointer and brush to start position for smooth drawing start
        this.updateLazyBrush(screenPos);
        this.brushPos = { ...screenPos }; // Set brush to pointer for immediate start
        
        const worldPos = this.screenToWorld(this.brushPos);
        this.currentStroke = {
            points: [worldPos],
            timestamp: Date.now(),
            tool: this.currentTool // Store which tool was used
        };
    }

    continueDrawing(screenPos) {
        // Don't continue drawing if drawing is disabled
        if (!this.drawingEnabled || !this.isDrawing || !this.currentStroke) return;
        
        // Update lazy brush - only add point if brush actually moved
        const brushMoved = this.updateLazyBrush(screenPos);
        
        if (brushMoved) {
            const worldPos = this.screenToWorld(this.brushPos);
            this.currentStroke.points.push(worldPos);
            this.isDirty = true;
        }
    }

    stopDrawing() {
        const beforeState = this.pendingStrokeHistoryBefore;
        if (this.isDrawing && this.currentStroke && this.currentStroke.points.length > 1) {
            // Add stroke directly - lazy brush provides natural smoothing
            this.strokes.push(this.currentStroke);

            // Keep stroke drawing undoable through the same snapshot system as text edits.
            this.recordStateChange(beforeState, this.captureCanvasState());
        }
        
        this.pendingStrokeHistoryBefore = null;
        this.isDrawing = false;
        this.currentStroke = null;
        this.isDirty = true;
    }

    // Two-finger gesture handling
    initializeTwoFingerGesture() {
        const positions = Array.from(this.pointers.values());
        if (positions.length === 2) {
            this.lastTwoFingerDistance = this.getTwoFingerDistance(positions[0], positions[1]);
            this.lastTwoFingerCenter = this.getCenter(positions[0], positions[1]);
        }
    }

    handleTwoFingerGesture() {
        const positions = Array.from(this.pointers.values());
        if (positions.length !== 2) return;
        
        const currentDistance = this.getTwoFingerDistance(positions[0], positions[1]);
        const currentCenter = this.getCenter(positions[0], positions[1]);
        
        if (this.lastTwoFingerDistance > 0) {
            // Calculate zoom factor
            const zoomFactor = currentDistance / this.lastTwoFingerDistance;
            const newScale = this.scale * zoomFactor;
            const clampedScale = Math.max(0.05, Math.min(10, newScale)); // Limit zoom range
            const actualZoomFactor = clampedScale / this.scale;
            
            // Calculate pan from finger movement
            const panDx = currentCenter.x - this.lastTwoFingerCenter.x;
            const panDy = currentCenter.y - this.lastTwoFingerCenter.y;
            
            // Zoom around the pinch center point
            // This keeps the point under your fingers stationary during zoom
            const zoomCenterX = this.lastTwoFingerCenter.x;
            const zoomCenterY = this.lastTwoFingerCenter.y;
            
            // Calculate how much the zoom center point will move due to scaling
            const offsetX = (zoomCenterX - this.panX) * (actualZoomFactor - 1);
            const offsetY = (zoomCenterY - this.panY) * (actualZoomFactor - 1);
            
            // Apply the zoom
            this.scale = clampedScale;
            
            // Adjust pan to keep zoom center stationary, plus add finger movement
            this.panX = this.panX - offsetX + panDx;
            this.panY = this.panY - offsetY + panDy;
        }
        
        this.lastTwoFingerDistance = currentDistance;
        this.lastTwoFingerCenter = currentCenter;
        this.isDirty = true;
    }

    getTwoFingerDistance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    getCenter(p1, p2) {
        return {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        };
    }

    // Path length in world space — tiny paths count as taps (deselect text / defer dot)
    strokePathLength(stroke) {
        const pts = stroke.points;
        if (!pts || pts.length < 2) return 0;
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
            len += this.getDistance(pts[i - 1], pts[i]);
        }
        return len;
    }

    // Center of stroke in world space (for mapping a “tap” to a point)
    strokeWorldCenter(stroke) {
        const pts = stroke.points;
        if (!pts.length) return { x: 0, y: 0 };
        let sx = 0;
        let sy = 0;
        for (const p of pts) {
            sx += p.x;
            sy += p.y;
        }
        return { x: sx / pts.length, y: sy / pts.length };
    }

    // Clear pending single-tap timer used for double-tap vs deselect
    clearCanvasTapDeselectTimer() {
        if (this.canvasTapDeselectTimer) {
            clearTimeout(this.canvasTapDeselectTimer);
            this.canvasTapDeselectTimer = null;
        }
    }

    // Canvas tap behavior:
    // - First tap: immediately dismiss selected/editing text.
    // - Second quick tap (nearby): create a new text box.
    handleCanvasTap(worldPos, screenPos) {
        if (!this.drawingEnabled || this.clearConfirmMode) return;
        if (!screenPos || typeof screenPos.x !== 'number' || typeof screenPos.y !== 'number') return;

        const now = Date.now();
        const lastTap = this.lastCanvasTap;
        const isSecondTap =
            !!lastTap &&
            now - lastTap.time <= CANVAS_DOUBLE_TAP_MS &&
            this.getDistance(screenPos, lastTap.screenPos) <= CANVAS_DOUBLE_TAP_DISTANCE_PX;

        this.clearCanvasTapDeselectTimer();
        
        if (isSecondTap) {
            this.lastCanvasTap = null;
            this.createTextAt(worldPos.x, worldPos.y);
            return;
        }

        this.lastCanvasTap = { time: now, screenPos };
        
        // Immediate deselect keeps edit dismissal feeling responsive.
        if (this.selectedTextId) {
            this.selectTextObject(null);
        }
    }

    // Rendering
    render() {
        if (this.isDirty) {
            // Clear canvas (use display dimensions since context is already scaled)
            this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

            // Apply transform
            this.ctx.save();
            this.ctx.translate(this.panX, this.panY);
            this.ctx.scale(this.scale, this.scale);

            // Set drawing style
            this.ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
            this.ctx.lineWidth = this.baseLineWidth;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            for (const stroke of this.strokes) {
                this.renderStroke(stroke);
            }

            if (this.currentStroke && this.currentStroke.points.length > 1) {
                this.renderStroke(this.currentStroke);
            }

            this.ctx.restore();
            this.isDirty = false;
        }

        this.updateTextLayerPositions();

        requestAnimationFrame(() => this.render());
    }

    renderStroke(stroke) {
        const points = stroke.points;
        if (points.length < 2) return;

        // Set drawing context based on tool
        if (stroke.tool === 'eraser') {
            // Eraser mode: use destination-out to clear canvas
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.lineWidth = this.baseLineWidth * 4; // 4x thickness for eraser
        } else {
            // Brush mode: normal drawing
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.lineWidth = this.baseLineWidth;
        }
        
        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        
        if (points.length === 2) {
            // Simple line for two points
            this.ctx.lineTo(points[1].x, points[1].y);
        } else {
            // Simple smooth curves using quadratic curves
            for (let i = 1; i < points.length - 1; i++) {
                const currentPoint = points[i];
                const nextPoint = points[i + 1];
                
                // Create smooth curve to midpoint between current and next
                const midX = (currentPoint.x + nextPoint.x) / 2;
                const midY = (currentPoint.y + nextPoint.y) / 2;
                
                this.ctx.quadraticCurveTo(currentPoint.x, currentPoint.y, midX, midY);
            }
            
            // Draw final segment to last point
            const lastPoint = points[points.length - 1];
            this.ctx.lineTo(lastPoint.x, lastPoint.y);
        }
        
        this.ctx.stroke();
        
        // Reset composite operation to default
        this.ctx.globalCompositeOperation = 'source-over';
    }

    // History system
    // Snapshot helpers: copy only the parts we want undo/redo to restore.
    cloneStrokes(strokes) {
        return strokes.map((stroke) => ({
            ...stroke,
            points: (stroke.points || []).map((p) => ({ x: p.x, y: p.y }))
        }));
    }

    cloneTextObjects(textObjects) {
        return textObjects.map((obj) => ({ ...obj }));
    }

    // Keep state/history free of empty labels (blank/whitespace-only text).
    pruneEmptyTextObjects(textObjects) {
        return textObjects.filter((obj) => ((obj.text || '').trim().length > 0));
    }

    captureCanvasState() {
        const nonEmptyTextObjects = this.pruneEmptyTextObjects(this.textObjects);
        return {
            strokes: this.cloneStrokes(this.strokes),
            textObjects: this.cloneTextObjects(nonEmptyTextObjects)
        };
    }

    restoreCanvasState(state) {
        if (!state) return;

        const currentSelection = this.selectedTextId;
        this.strokes = this.cloneStrokes(state.strokes || []);
        const stateTextObjects = this.pruneEmptyTextObjects(state.textObjects || []);
        this.textObjects = this.cloneTextObjects(stateTextObjects);

        if (this.textLayer) {
            this.textLayer.innerHTML = '';
            for (const obj of this.textObjects) {
                this.textLayer.appendChild(this.createTextItemElement(obj));
            }
        }

        const canRestoreSelection =
            currentSelection && this.textObjects.some((t) => t.id === currentSelection);
        this.selectTextObject(canRestoreSelection ? currentSelection : null);
        this.updateTextLayerPositions();
        this.isDirty = true;
        this.updateUI();
    }

    recordStateChange(beforeState, afterState) {
        if (!beforeState || !afterState) return;
        if (JSON.stringify(beforeState) === JSON.stringify(afterState)) return;
        this.addToHistory({
            type: 'STATE_CHANGE',
            beforeState,
            afterState
        });
    }

    // Text typing transaction: one undo step per edit session.
    beginTextInputHistoryTransaction(id) {
        if (!id || this.pendingTextInputHistory.has(id)) return;
        this.pendingTextInputHistory.set(id, this.captureCanvasState());
    }

    commitTextInputHistoryTransaction(id) {
        if (!id) return;
        const beforeState = this.pendingTextInputHistory.get(id);
        if (!beforeState) return;
        this.pendingTextInputHistory.delete(id);
        this.recordStateChange(beforeState, this.captureCanvasState());
    }

    addToHistory(action) {
        // Remove any redo history when adding new action
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(action);
        this.historyIndex++;
        
        // Limit history size
        if (this.history.length > 50) {
            this.history.shift();
            this.historyIndex--;
        }
        
        this.updateUI();
    }

    undo() {
        if (this.historyIndex >= 0) {
            const action = this.history[this.historyIndex];
            
            if (action.type === 'STATE_CHANGE') {
                this.restoreCanvasState(action.beforeState);
            } else if (action.type === 'ADD_STROKE') {
                this.strokes.pop();
            } else if (action.type === 'CLEAR') {
                this.strokes = [...action.previousStrokes];
            }
            
            this.historyIndex--;
            this.isDirty = true;
            this.updateUI();
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            const action = this.history[this.historyIndex];
            
            if (action.type === 'STATE_CHANGE') {
                this.restoreCanvasState(action.afterState);
            } else if (action.type === 'ADD_STROKE') {
                this.strokes.push(action.stroke);
            } else if (action.type === 'CLEAR') {
                this.strokes = [];
            }
            
            this.isDirty = true;
            this.updateUI();
        }
    }

    // Handle clear button click - either enter confirm mode or actually clear
    handleClearClick() {
        // Prevent double execution from multiple event handlers
        if (this.clearClickInProgress) return;
        this.clearClickInProgress = true;
        
        // Use setTimeout to reset the flag after event handling is complete
        setTimeout(() => {
            this.clearClickInProgress = false;
        }, 50);
        
        if (!this.clearConfirmMode) {
            // First click - enter confirmation mode
            this.enterClearConfirmMode();
        } else {
            // Second click - actually clear the canvas
            this.clear();
        }
    }
    
    // Enter clear confirmation mode
    enterClearConfirmMode() {
        this.clearConfirmMode = true;
        const clearBtn = document.getElementById('clearBtn');
        clearBtn.classList.add('confirm-mode');
        
        // Add body class for visual styling
        document.body.classList.add('clear-confirm-mode');
        
        // Disable all other buttons
        this.disableOtherButtons();
        
        // Add outside click listener to exit confirm mode
        this.addOutsideClickListener();
    }
    
    // Exit clear confirmation mode
    exitClearConfirmMode() {
        this.clearConfirmMode = false;
        const clearBtn = document.getElementById('clearBtn');
        clearBtn.classList.remove('confirm-mode');
        
        // Remove body class
        document.body.classList.remove('clear-confirm-mode');
        
        // Re-enable other buttons (with proper state)
        this.updateUI();
        
        // Remove outside click listener
        this.removeOutsideClickListener();
    }

    clear() {
        if (this.strokes.length > 0 || this.textObjects.length > 0) {
            // Clear strokes, text, history, and reset view
            this.strokes = [];
            this.textObjects = [];
            if (this.textLayer) {
                this.textLayer.innerHTML = '';
            }
            this.selectTextObject(null);

            this.history = [];
            this.historyIndex = -1;

            this.scale = 1;
            this.panX = 0;
            this.panY = 0;

            this.isDirty = true;
            this.updateUI();
        }

        this.exitClearConfirmMode();
    }
    
    // Disable other buttons when in confirm mode (undo/redo use soft-disable via updateUI)
    disableOtherButtons() {
        this.updateUI();
    }
    
    // Outside click listener management
    addOutsideClickListener() {
        // Bind the method so we can remove it later
        this.outsideClickHandler = this.handleOutsideClick.bind(this);
        
        // Create delayed handlers and store references for removal
        this.delayedClickHandler = (e) => {
            setTimeout(() => this.outsideClickHandler(e), 15);
        };
        this.delayedTouchHandler = (e) => {
            setTimeout(() => this.outsideClickHandler(e), 15);
        };
        this.delayedCanvasClickHandler = (e) => {
            setTimeout(() => this.outsideClickHandler(e), 15);
        };
        this.delayedCanvasTouchHandler = (e) => {
            setTimeout(() => this.outsideClickHandler(e), 15);
        };
        
        // Add a small delay to prevent race conditions with button handlers
        // Use capture phase to ensure we catch all clicks before other handlers
        document.addEventListener('click', this.delayedClickHandler, true);
        document.addEventListener('touchend', this.delayedTouchHandler, true);
        // Also listen on the canvas specifically for better coverage
        this.canvas.addEventListener('click', this.delayedCanvasClickHandler, true);
        this.canvas.addEventListener('touchend', this.delayedCanvasTouchHandler, true);
    }
    
    removeOutsideClickListener() {
        // Store references to the delayed handlers so we can remove them
        if (this.delayedClickHandler) {
            document.removeEventListener('click', this.delayedClickHandler, true);
            this.delayedClickHandler = null;
        }
        if (this.delayedTouchHandler) {
            document.removeEventListener('touchend', this.delayedTouchHandler, true);
            this.delayedTouchHandler = null;
        }
        if (this.delayedCanvasClickHandler) {
            this.canvas.removeEventListener('click', this.delayedCanvasClickHandler, true);
            this.delayedCanvasClickHandler = null;
        }
        if (this.delayedCanvasTouchHandler) {
            this.canvas.removeEventListener('touchend', this.delayedCanvasTouchHandler, true);
            this.delayedCanvasTouchHandler = null;
        }
        this.outsideClickHandler = null;
    }
    
    handleOutsideClick(event) {
        // Only handle outside clicks if we're actually in confirm mode
        if (!this.clearConfirmMode) return;

        if (this.textEditPanel && this.textEditPanel.contains(event.target)) {
            return;
        }

        const clearBtn = document.getElementById('clearBtn');
        
        // Check if the click was outside the clear button (original working logic)
        if (!clearBtn.contains(event.target)) {
            // Prevent the event from bubbling to avoid triggering other button actions
            event.preventDefault();
            event.stopPropagation();
            this.exitClearConfirmMode();
        }
    }

    // Share functionality - prioritizes native OS share sheet with size optimization
    async share() {
        if (this.strokes.length === 0 && this.textObjects.length === 0) {
            alert('Nothing to share yet. Draw something or add text first.');
            return;
        }
        
        try {
            // Create the image first
            const bounds = this.calculateBounds();
            const padding = 32;
            
            // Calculate desired dimensions
            let width = bounds.maxX - bounds.minX + padding * 2;
            let height = bounds.maxY - bounds.minY + padding * 2;
            
            // Set maximum export dimensions to prevent memory issues
            // Maximum area of 4 megapixels (2048x2048) which is reasonable for sharing
            const MAX_DIMENSION = 2048;
            const MAX_AREA = MAX_DIMENSION * MAX_DIMENSION;
            
            // Calculate scale factor to fit within limits
            let scaleFactor = 1;
            const currentArea = width * height;
            
            if (currentArea > MAX_AREA) {
                scaleFactor = Math.sqrt(MAX_AREA / currentArea);
            }
            
            // Also ensure no single dimension exceeds the maximum
            if (width > MAX_DIMENSION) {
                scaleFactor = Math.min(scaleFactor, MAX_DIMENSION / width);
            }
            if (height > MAX_DIMENSION) {
                scaleFactor = Math.min(scaleFactor, MAX_DIMENSION / height);
            }
            
            // Apply scale factor
            width *= scaleFactor;
            height *= scaleFactor;
            
            // For very large images, use lower DPR to save memory
            let dpr = window.devicePixelRatio || 1;
            if (scaleFactor < 0.5) {
                // For heavily scaled down images, use lower DPR
                dpr = Math.max(1, dpr * 0.5);
            }
            
            // Create offscreen canvas for export
            const offscreenCanvas = document.createElement('canvas');
            const offscreenCtx = offscreenCanvas.getContext('2d');
            
            // Check if context was created successfully
            if (!offscreenCtx) {
                throw new Error('Failed to create canvas context');
            }
            
            // Set canvas size with memory-optimized DPR
            try {
                offscreenCanvas.width = width * dpr;
                offscreenCanvas.height = height * dpr;
                
                // Check if canvas dimensions were set successfully (memory check)
                if (offscreenCanvas.width === 0 || offscreenCanvas.height === 0) {
                    throw new Error('Canvas size too large for device memory');
                }
                
                offscreenCtx.scale(dpr, dpr);
            } catch (memoryError) {
                console.error('Canvas memory error:', memoryError);
                throw new Error('Drawing too large to export. Try zooming in and sharing a smaller portion.');
            }
            
            // Always use white background for export to ensure eraser strokes work properly
            // Clear the entire canvas first to remove any artifacts
            offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            
            // Fill with white background - use the actual canvas dimensions
            offscreenCtx.fillStyle = '#FFFFFF';
            offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            
            // Set up drawing style - always use black for export to ensure visibility on white background
            offscreenCtx.strokeStyle = '#000000';
            offscreenCtx.lineWidth = this.baseLineWidth * scaleFactor;
            offscreenCtx.lineCap = 'round';
            offscreenCtx.lineJoin = 'round';
            
            // Apply scaling and translation to fit the drawing in the export canvas
            offscreenCtx.save();
            offscreenCtx.scale(scaleFactor, scaleFactor);
            offscreenCtx.translate(-bounds.minX + padding / scaleFactor, -bounds.minY + padding / scaleFactor);
            
            // Render all strokes, then text on top
            for (const stroke of this.strokes) {
                this.renderStrokeToContext(offscreenCtx, stroke);
            }
            this.drawTextObjectsToExportContext(offscreenCtx);

            offscreenCtx.restore();
            
            // Convert to blob and share using native OS share sheet
            offscreenCanvas.toBlob(async (blob) => {
                if (!blob) {
                    console.error('Failed to create image blob');
                    alert('Failed to create image. The drawing might be too large. Try clearing part of it and sharing again.');
                    return;
                }

                // Local-only testing fallback: show exported file inside the app.
                if (this.isLocalTestingEnvironment()) {
                    this.showLocalSharePreviewForTesting(blob);
                    return;
                }

                // Check if Web Share API is available
                if (navigator.share) {
                    try {
                        const file = new File([blob], 'drawing.png', { type: 'image/png' });
                        
                        // Try sharing with files (preferred method for images)
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file]
                            });
                            return;
                        }
                        
                    } catch (shareError) {
                        console.log('Native share result:', shareError.name, shareError.message);
                        
                        // Check if user canceled vs actual sharing error
                        // Safari iOS and other browsers can throw different error types when user cancels
                        if (shareError.name === 'AbortError' || 
                            shareError.name === 'NotAllowedError' ||
                            shareError.name === 'InvalidStateError' ||
                            shareError.message.includes('cancel') ||
                            shareError.message.includes('abort') ||
                            shareError.message.includes('dismiss') ||
                            shareError.message.includes('denied') ||
                            shareError.message.includes('User denied')) {
                            // User canceled or denied - do nothing, no error message needed
                            console.log('Share canceled by user');
                            return;
                        }
                        
                        // Check if it's a browser/environment limitation rather than HTTPS issue
                        if (shareError.name === 'NotSupportedError' || 
                            shareError.message.includes('not supported') ||
                            shareError.message.includes('not available')) {
                            console.log('Web Share API not fully supported in this context');
                            return;
                        }
                        
                        // Only show HTTPS error for actual network/security issues
                        if (shareError.message.includes('secure context') || 
                            shareError.message.includes('HTTPS') ||
                            shareError.message.includes('secure origin')) {
                            alert('Sharing failed. This feature requires HTTPS to work properly.');
                        } else {
                            // For other errors, just log them without showing user error
                            console.log('Share completed or failed silently');
                        }
                        return;
                    }
                }
                
                console.log('Web Share API not supported in this browser/environment.');
                
            }, 'image/png');
            
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to prepare drawing for sharing. Please try again.');
        }
    }

    // Detect local/dev runtime so we can use local share-preview fallback.
    isLocalTestingEnvironment() {
        const host = (location.hostname || '').toLowerCase();

        // Localhost variants.
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
            return true;
        }

        // Private-network IPv4 (typical local phone testing URL, e.g. 192.168.x.x).
        const isPrivateIpv4 =
            /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
            /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
            /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);
        if (isPrivateIpv4) {
            return true;
        }

        // Non-GitHub hosts are treated as local/dev for your testing workflow.
        return !host.endsWith('github.io');
    }

    // Create local preview UI only when needed (localhost testing mode).
    ensureLocalSharePreviewElements() {
        if (this.localSharePreviewOverlay) return;

        const overlay = document.createElement('div');
        overlay.className = 'local-share-preview-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        // Keep detached from rendering until opened (avoids iOS ghost backdrop artifacts).
        overlay.style.display = 'none';

        const panel = document.createElement('div');
        panel.className = 'local-share-preview-panel';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'local-share-preview-close';
        closeBtn.setAttribute('aria-label', 'Close preview');
        closeBtn.textContent = 'close';

        const image = document.createElement('img');
        image.className = 'local-share-preview-image';
        image.alt = 'Exported drawing preview';

        closeBtn.addEventListener('click', () => this.hideLocalSharePreviewForTesting());
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                this.hideLocalSharePreviewForTesting();
            }
        });

        panel.appendChild(closeBtn);
        panel.appendChild(image);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        this.localSharePreviewOverlay = overlay;
        this.localSharePreviewImage = image;
    }

    // Local-only behavior: show export on top of app (works in home-screen mode too).
    showLocalSharePreviewForTesting(blob) {
        this.ensureLocalSharePreviewElements();
        if (!this.localSharePreviewOverlay || !this.localSharePreviewImage) return;

        if (this.localSharePreviewShowRaf) {
            cancelAnimationFrame(this.localSharePreviewShowRaf);
            this.localSharePreviewShowRaf = null;
        }

        this.cleanupLocalSharePreviewObjectUrl();
        this.localSharePreviewObjectUrl = URL.createObjectURL(blob);
        this.localSharePreviewImage.src = this.localSharePreviewObjectUrl;

        this.localSharePreviewOverlay.style.display = 'flex';
        this.localSharePreviewShowRaf = requestAnimationFrame(() => {
            if (!this.localSharePreviewOverlay) return;
            this.localSharePreviewOverlay.classList.add('local-share-preview-overlay--visible');
            this.localSharePreviewOverlay.setAttribute('aria-hidden', 'false');
            this.localSharePreviewShowRaf = null;
        });
    }

    // Close local export preview and release temporary image URL.
    hideLocalSharePreviewForTesting() {
        if (!this.localSharePreviewOverlay || !this.localSharePreviewImage) return;

        if (this.localSharePreviewShowRaf) {
            cancelAnimationFrame(this.localSharePreviewShowRaf);
            this.localSharePreviewShowRaf = null;
        }

        this.localSharePreviewOverlay.classList.remove('local-share-preview-overlay--visible');
        this.localSharePreviewOverlay.setAttribute('aria-hidden', 'true');
        this.localSharePreviewOverlay.style.display = 'none';
        this.localSharePreviewImage.removeAttribute('src');
        this.cleanupLocalSharePreviewObjectUrl();
    }

    // Shared cleanup for temporary blob URL memory.
    cleanupLocalSharePreviewObjectUrl() {
        if (!this.localSharePreviewObjectUrl) return;
        URL.revokeObjectURL(this.localSharePreviewObjectUrl);
        this.localSharePreviewObjectUrl = null;
    }

    calculateBounds() {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let hasAny = false;

        for (const stroke of this.strokes) {
            for (const point of stroke.points) {
                hasAny = true;
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        }

        for (const t of this.textObjects) {
            hasAny = true;
            const b = this.getTextWorldBounds(t);
            minX = Math.min(minX, b.minX);
            minY = Math.min(minY, b.minY);
            maxX = Math.max(maxX, b.maxX);
            maxY = Math.max(maxY, b.maxY);
        }

        if (!hasAny) {
            return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
        }
        return { minX, minY, maxX, maxY };
    }

    renderStrokeToContext(ctx, stroke) {
        const points = stroke.points;
        if (points.length < 2) return;

        // Set drawing context based on tool
        if (stroke.tool === 'eraser') {
            // For export: use white brush strokes to cover black strokes underneath
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = this.baseLineWidth * 4; // 4x thickness for eraser
        } else {
            // Brush mode: normal drawing
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#000000'; // Always black for export
            ctx.lineWidth = this.baseLineWidth;
        }
        
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        
        if (points.length === 2) {
            ctx.lineTo(points[1].x, points[1].y);
        } else {
            // Use the same smooth curve rendering as main canvas
            for (let i = 1; i < points.length - 1; i++) {
                const currentPoint = points[i];
                const nextPoint = points[i + 1];
                
                const midX = (currentPoint.x + nextPoint.x) / 2;
                const midY = (currentPoint.y + nextPoint.y) / 2;
                
                ctx.quadraticCurveTo(currentPoint.x, currentPoint.y, midX, midY);
            }
            
            const lastPoint = points[points.length - 1];
            ctx.lineTo(lastPoint.x, lastPoint.y);
        }
        
        ctx.stroke();
        
        // Reset composite operation to default
        ctx.globalCompositeOperation = 'source-over';
    }

    // --- Text layer (DOM above canvas) ---
    setupTextLayer() {
        if (!this.textLayer || !this.textEditPanel) return;

        const decreaseBtn = document.getElementById('textSizeDecreaseBtn');
        const increaseBtn = document.getElementById('textSizeIncreaseBtn');
        const alignBtn = document.getElementById('textAlignBtn');
        const delBtn = document.getElementById('textDeleteBtn');
        const minFontSize = 8;
        const maxFontSize = 72;
        const fontStep = 3;

        // Keep typing focus when interacting with toolbar controls.
        const preventToolbarTapDefocus = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        for (const btn of [decreaseBtn, increaseBtn, alignBtn, delBtn]) {
            if (!btn) continue;
            btn.addEventListener('pointerdown', preventToolbarTapDefocus);
        }

        if (alignBtn) {
            alignBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const obj = this.getTextObjectById(this.selectedTextId);
                if (!obj) return;
                const beforeState = this.captureCanvasState();
                const order = ['center', 'right', 'left'];
                const cur = order.indexOf(obj.textAlign || 'center');
                obj.textAlign = order[(cur + 1) % 3];
                this.applyTextObjectToDom(obj);
                this.syncTextEditPanelFromSelection();
                this.isDirty = true;
                this.recordStateChange(beforeState, this.captureCanvasState());
                triggerHaptic();
            });
        }

        // Size controls are step buttons so each tap creates one undo-able history entry.
        const changeSelectedTextSize = (delta) => {
            const obj = this.getTextObjectById(this.selectedTextId);
            if (!obj) return;
            const beforeState = this.captureCanvasState();
            const current = Number(obj.fontSize) || 24;
            const next = Math.max(minFontSize, Math.min(maxFontSize, current + delta));
            if (next === current) return;
            obj.fontSize = next;
            this.applyTextObjectToDom(obj);
            // Keep selected text visible after size changes, same behavior as typing flow.
            this.instantTextViewportFit = false;
            this.instantTextViewportFitAt = 0;
            this.scheduleKeepSelectedTextInEditingViewport();
            this.isDirty = true;
            this.recordStateChange(beforeState, this.captureCanvasState());
            triggerHaptic();
        };

        if (decreaseBtn) {
            decreaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                changeSelectedTextSize(-fontStep);
            });
        }

        if (increaseBtn) {
            increaseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                changeSelectedTextSize(fontStep);
            });
        }

        delBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.selectedTextId) {
                this.removeTextObject(this.selectedTextId);
            }
            this.selectTextObject(null);
        });

        document.addEventListener('pointermove', this.onDocumentPointerMoveForText.bind(this));
        document.addEventListener('pointerup', this.onDocumentPointerUpForText.bind(this));
        document.addEventListener('pointercancel', this.onDocumentPointerUpForText.bind(this));

        this.setupTextEditPanelViewport();
    }

    // Position text toolbar near top with safe-area spacing.
    setupTextEditPanelViewport() {
        if (!this.textEditPanel) return;

        const schedule = () => {
            if (this._textPanelGeomRaf) {
                cancelAnimationFrame(this._textPanelGeomRaf);
            }
            this._textPanelGeomRaf = requestAnimationFrame(() => {
                this._textPanelGeomRaf = null;
                this.updateTextEditPanelGeometry();
            });
        };
        this._scheduleTextEditPanelGeometry = schedule;

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', schedule);
            window.visualViewport.addEventListener('scroll', schedule);
        }
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);

        document.addEventListener(
            'focusin',
            (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('canvas-text-item__input')) {
                    this.instantTextViewportFit = true;
                    this.instantTextViewportFitAt = performance.now();
                    schedule();
                    // Keep a single source of truth for first-fit timing: geometry updater.
                    this.updateCanvasTextEditingChrome();
                }
            },
            true
        );
        document.addEventListener(
            'focusout',
            (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('canvas-text-item__input')) {
                    schedule();
                    requestAnimationFrame(() => {
                        const removedEmptyText = this.removeEmptyTextObjectOnDefocus(e.target);
                        const active = document.activeElement;
                        const stillOnCanvasTextInput =
                            active && active.classList && active.classList.contains('canvas-text-item__input');
                        if (!stillOnCanvasTextInput && !removedEmptyText) {
                            this.instantTextViewportFit = false;
                            this.instantTextViewportFitAt = 0;
                            this.stopCameraTweenForTextEditing();
                            this.dismissCanvasTextKeyboard(e.target);
                        }
                        this.updateCanvasTextEditingChrome();
                    });
                }
            },
            true
        );
    }

    // Keyboard-dismiss helper for mobile browsers that keep the IME open after blur
    dismissCanvasTextKeyboard(sourceInput = null) {
        if (sourceInput && typeof sourceInput.blur === 'function') {
            sourceInput.blur();
        }

        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('canvas-text-item__input')) {
            active.blur();
        }

        // iOS/Android fallback: move focus to an offscreen readonly input, then blur it.
        const sink = document.createElement('input');
        sink.type = 'text';
        sink.readOnly = true;
        sink.tabIndex = -1;
        sink.setAttribute('aria-hidden', 'true');
        sink.style.cssText =
            'position:fixed;opacity:0;pointer-events:none;left:-9999px;top:0;width:1px;height:1px;';
        document.body.appendChild(sink);
        try {
            sink.focus({ preventScroll: true });
        } catch (err) {
            sink.focus();
        }
        sink.blur();
        document.body.removeChild(sink);
    }

    // Cleanup: remove text labels that were left empty when user exits the input.
    removeEmptyTextObjectOnDefocus(inputEl) {
        if (!inputEl) return false;
        const text = (inputEl.value || '').trim();
        if (text.length > 0) return false;

        const item = inputEl.closest('.canvas-text-item');
        const id = item && item.dataset ? item.dataset.textId : null;
        if (!id) return false;
        if (!this.getTextObjectById(id)) return false;

        this.removeTextObject(id, false);
        return true;
    }

    updateTextEditPanelGeometry() {
        const panel = this.textEditPanel;
        if (!panel || panel.classList.contains('hidden')) return;

        const margin = 8;
        let safeTopPx = 0;
        try {
            const t = document.createElement('div');
            t.style.cssText =
                'position:fixed;top:0;left:0;height:0;padding-top:env(safe-area-inset-top);visibility:hidden;pointer-events:none;';
            document.body.appendChild(t);
            const cs = getComputedStyle(t);
            const pad = parseFloat(cs.paddingTop) || 0;
            safeTopPx = pad;
            document.body.removeChild(t);
        } catch (err) {
            /* env() unavailable */
        }

        panel.style.left = margin + 'px';
        panel.style.right = margin + 'px';
        panel.style.width = 'auto';
        panel.style.top = safeTopPx + margin + 'px';
        panel.style.bottom = 'auto';

        // Re-fit camera when keyboard/panel geometry changes during active text editing.
        const active = document.activeElement;
        const editingTextInput =
            active && active.classList && active.classList.contains('canvas-text-item__input');
        if (editingTextInput) {
            this.scheduleKeepSelectedTextInEditingViewport();
        }
    }

    // One camera-fit pass per frame max while editing selected text.
    scheduleKeepSelectedTextInEditingViewport() {
        if (this._textViewportFitRafId != null) return;
        this._textViewportFitRafId = requestAnimationFrame(() => {
            this._textViewportFitRafId = null;
            this.keepSelectedTextInEditingViewport();
        });
    }

    // Smoothly animate camera changes (pan/zoom) for text editing viewport fit.
    animateCameraTo(targetScale, targetPanX, targetPanY, durationMs = 200) {
        if (this.textViewportTweenRafId != null) {
            cancelAnimationFrame(this.textViewportTweenRafId);
            this.textViewportTweenRafId = null;
        }

        const startScale = this.scale;
        const startPanX = this.panX;
        const startPanY = this.panY;
        const startTime = performance.now();

        const step = (now) => {
            const t = Math.min(1, (now - startTime) / durationMs);
            const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

            this.scale = startScale + (targetScale - startScale) * eased;
            this.panX = startPanX + (targetPanX - startPanX) * eased;
            this.panY = startPanY + (targetPanY - startPanY) * eased;
            this.isDirty = true;

            if (t < 1) {
                this.textViewportTweenRafId = requestAnimationFrame(step);
            } else {
                this.textViewportTweenRafId = null;
                this.scale = targetScale;
                this.panX = targetPanX;
                this.panY = targetPanY;
                this.isDirty = true;
            }
        };

        this.textViewportTweenRafId = requestAnimationFrame(step);
    }

    // Stop in-progress camera tween when text editing mode ends.
    stopCameraTweenForTextEditing() {
        if (this.textViewportTweenRafId != null) {
            cancelAnimationFrame(this.textViewportTweenRafId);
            this.textViewportTweenRafId = null;
        }
    }

    // During text edit mode, pan/zoom canvas so selected text stays centered and fully visible.
    keepSelectedTextInEditingViewport() {
        if (!this.selectedTextId || !this.textEditPanel || this.textEditPanel.classList.contains('hidden')) {
            return;
        }

        const active = document.activeElement;
        const isEditingText =
            active && active.classList && active.classList.contains('canvas-text-item__input');
        if (!isEditingText) return;

        const obj = this.getTextObjectById(this.selectedTextId);
        if (!obj) return;

        const vv = window.visualViewport;
        const viewLeft = vv ? vv.offsetLeft : 0;
        const viewTop = vv ? vv.offsetTop : 0;
        const viewWidth = vv ? vv.width : window.innerWidth;
        const viewHeight = vv ? vv.height : window.innerHeight;
        const viewRight = viewLeft + viewWidth;
        const viewBottom = viewTop + viewHeight;
        const viewMargin = 16;

        const panelRect = this.textEditPanel.getBoundingClientRect();
        const editingTop = Math.max(viewTop + viewMargin, panelRect.bottom + viewMargin);
        const editingBottom = viewBottom - viewMargin;
        const availableHeight = Math.max(120, editingBottom - editingTop);
        const availableWidth = Math.max(120, viewWidth - viewMargin * 2);

        const selectedEl =
            this.textLayer &&
            this.textLayer.querySelector(`[data-text-id="${CSS.escape(this.selectedTextId)}"]`);
        const selectedRect = selectedEl && selectedEl.getBoundingClientRect();
        const currentScreenWidth = Math.max(1, selectedRect ? selectedRect.width : 1);
        const currentScreenHeight = Math.max(1, selectedRect ? selectedRect.height : 1);

        // Use real DOM size so fit math includes textarea padding and visual styling.
        const fitScaleW = this.scale * (availableWidth / currentScreenWidth);
        const fitScaleH = this.scale * (availableHeight / currentScreenHeight);

        // Fit selected text into available view, but only zoom out (never zoom in).
        const fitScale = Math.max(0.35, Math.min(4, Math.min(fitScaleW, fitScaleH)));
        const targetScale = Math.min(this.scale, fitScale);

        const targetCenterX = viewLeft + viewWidth / 2;
        const targetCenterY = editingTop + availableHeight / 2;
        const targetPanX = targetCenterX - obj.worldX * targetScale;
        const targetPanY = targetCenterY - obj.worldY * targetScale;

        if (this.instantTextViewportFit) {
            // Avoid an early "wrong" snap before keyboard/viewport settles.
            const keyboardOverlap = vv
                ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
                : 0;
            const elapsed = performance.now() - (this.instantTextViewportFitAt || 0);
            const keyboardReady = !vv || keyboardOverlap > 1 || elapsed > 220;
            if (!keyboardReady) return;

            this.stopCameraTweenForTextEditing();
            this.scale = targetScale;
            this.panX = targetPanX;
            this.panY = targetPanY;
            this.isDirty = true;
            this.instantTextViewportFit = false;
            this.instantTextViewportFitAt = 0;
            return;
        }

        this.animateCameraTo(targetScale, targetPanX, targetPanY, 200);
    }

    getTextObjectById(id) {
        if (!id) return null;
        return this.textObjects.find((t) => t.id === id) || null;
    }

    // First strong letter Hebrew/Arabic script → RTL; otherwise LTR (default)
    isCodePointHebrewOrArabicScript(cp) {
        return (
            (cp >= 0x0590 && cp <= 0x05ff) ||
            (cp >= 0x0600 && cp <= 0x06ff) ||
            (cp >= 0x0750 && cp <= 0x077f) ||
            (cp >= 0x08a0 && cp <= 0x08ff) ||
            (cp >= 0xfb50 && cp <= 0xfdff) ||
            (cp >= 0xfe70 && cp <= 0xfeff)
        );
    }

    inferTextDirectionFromContent(text) {
        if (!text) return 'ltr';
        for (const ch of text) {
            if (/\s/.test(ch)) continue;
            const cp = ch.codePointAt(0);
            if (this.isCodePointHebrewOrArabicScript(cp)) return 'rtl';
            return 'ltr';
        }
        return 'ltr';
    }

    applyTextDirectionToTextarea(ta, text) {
        if (!ta) return;
        ta.dir = this.inferTextDirectionFromContent(text);
    }

    createTextAt(worldX, worldY) {
        const beforeState = this.captureCanvasState();
        const id = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const obj = {
            id,
            worldX,
            worldY,
            text: '',
            textAlign: 'center',
            fontSize: 24,
            hasBackground: true
        };
        this.textObjects.push(obj);
        this.textLayer.appendChild(this.createTextItemElement(obj));
        /* Synchronous focus keeps iOS/Android in the same user gesture as the double-tap */
        this.selectTextObject(id, true);
        this.isDirty = true;
        this.updateUI();
        this.recordStateChange(beforeState, this.captureCanvasState());
        triggerHaptic();
    }

    removeTextObject(id, withHaptic = true) {
        const idx = this.textObjects.findIndex((t) => t.id === id);
        if (idx === -1) return;
        const beforeState = this.captureCanvasState();
        this.pendingTextInputHistory.delete(id);
        this.textObjects.splice(idx, 1);
        const el = this.textLayer.querySelector(`[data-text-id="${CSS.escape(id)}"]`);
        if (el) el.remove();
        if (this.selectedTextId === id) {
            this.selectTextObject(null);
        }
        this.isDirty = true;
        this.updateUI();
        this.recordStateChange(beforeState, this.captureCanvasState());
        if (withHaptic) {
            triggerHaptic();
        }
    }

    // immediateFocus: true when opening a brand-new box (same stack as pointerup → keyboard allowed on iOS)
    selectTextObject(id, immediateFocus = false) {
        this.selectedTextId = id;
        this.clearCanvasTapDeselectTimer();

        for (const el of this.textLayer.querySelectorAll('.canvas-text-item')) {
            el.classList.toggle('selected', el.dataset.textId === id);
            const ta = el.querySelector('.canvas-text-item__input');
            if (ta) {
                ta.readOnly = el.dataset.textId !== id;
                this.setTextareaEditingMode(ta, document.activeElement === ta);
                /* Only one label in tab order → iOS often hides the prev/next/check accessory bar */
                ta.tabIndex = id !== null && el.dataset.textId === id ? 0 : -1;
            }
        }

        if (id) {
            this.textEditPanel.classList.remove('hidden');
            this.textEditPanel.setAttribute('aria-hidden', 'false');
            if (this.textLayer) {
                this.textLayer.setAttribute('aria-hidden', 'false');
            }
            this.syncTextEditPanelFromSelection();
            const el = this.textLayer.querySelector(`[data-text-id="${CSS.escape(id)}"]`);
            const ta = el && el.querySelector('.canvas-text-item__input');
            // Focus only when explicitly entering edit mode (e.g., new text creation).
            if (ta && immediateFocus) {
                this.setTextareaEditingMode(ta, true);
                const placeCaret = () => {
                    try {
                        const len = ta.value.length;
                        ta.setSelectionRange(len, len);
                    } catch (err) { /* some mobile browsers */ }
                };
                ta.focus({ preventScroll: true });
                placeCaret();
            }

            this._scheduleTextEditPanelGeometry?.();
            /* Keyboard animates in — re-measure after layout settles (esp. iOS) */
            setTimeout(() => this._scheduleTextEditPanelGeometry?.(), 150);
            setTimeout(() => this._scheduleTextEditPanelGeometry?.(), 450);
        } else {
            this.stopCameraTweenForTextEditing();
            this.dismissCanvasTextKeyboard();
            this.textEditPanel.classList.add('hidden');
            this.textEditPanel.setAttribute('aria-hidden', 'true');
            if (this.textLayer && this.textObjects.length === 0) {
                this.textLayer.setAttribute('aria-hidden', 'true');
            }
        }

        this.updateCanvasTextEditingChrome();
    }

    // Fade top tool row whenever text editing UI is active (selection or typing).
    updateCanvasTextEditingChrome() {
        const el = document.activeElement;
        const labelTyping =
            el && el.classList && el.classList.contains('canvas-text-item__input');
        // Keep top tool toggle hidden as long as a text object is selected.
        const active = !!this.selectedTextId || !!labelTyping;
        document.body.classList.toggle('canvas-text-editing-active', active);
    }

    syncTextEditPanelFromSelection() {
        const obj = this.getTextObjectById(this.selectedTextId);
        const alignBtn = document.getElementById('textAlignBtn');
        if (!obj) return;

        const align = obj.textAlign || 'center';
        const iconNames = {
            left: 'format_align_left',
            center: 'format_align_center',
            right: 'format_align_right'
        };
        const iconSpan = alignBtn && alignBtn.querySelector('.text-edit-panel__align-icon');
        if (iconSpan) {
            iconSpan.textContent = iconNames[align] || iconNames.center;
        }
        if (alignBtn) {
            alignBtn.setAttribute(
                'aria-label',
                align === 'left'
                    ? 'Align text left'
                    : align === 'right'
                      ? 'Align text right'
                      : 'Align text center'
            );
        }
    }

    createTextItemElement(obj) {
        const wrap = document.createElement('div');
        wrap.className = 'canvas-text-item';
        wrap.dataset.textId = obj.id;
        // Show a newline-friendly keyboard action on mobile instead of "done/check".
        // Disable browser spellcheck/autocorrect to avoid persistent red underlines in view mode.
        wrap.innerHTML =
            '<div class="canvas-text-item__body">' +
            '<textarea class="canvas-text-item__input" rows="1" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" enterkeyhint="enter" placeholder="Type here"></textarea>' +
            '</div>';

        const ta = wrap.querySelector('.canvas-text-item__input');
        ta.placeholder = 'Type here';
        ta.value = obj.text;
        ta.addEventListener('focusin', () => {
            this.setTextareaEditingMode(ta, true);
            this.beginTextInputHistoryTransaction(obj.id);
        });
        ta.addEventListener('focusout', () => {
            this.setTextareaEditingMode(ta, false);
            this.commitTextInputHistoryTransaction(obj.id);
        });
        ta.addEventListener('input', () => {
            this.beginTextInputHistoryTransaction(obj.id);
            obj.text = ta.value;
            this.applyTextDirectionToTextarea(ta, ta.value);
            this.autoGrowTextarea(ta);
            this.instantTextViewportFit = false;
            this.instantTextViewportFitAt = 0;
            this.scheduleKeepSelectedTextInEditingViewport();
            this.isDirty = true;
        });

        const onPointerDown = (e) => this.onTextItemPointerDown(e, obj.id);
        wrap.addEventListener('pointerdown', onPointerDown);

        this.applyTextObjectToDom(obj);
        return wrap;
    }

    applyTextObjectToDom(obj) {
        const el = this.textLayer && this.textLayer.querySelector(`[data-text-id="${CSS.escape(obj.id)}"]`);
        if (!el) return;
        const ta = el.querySelector('.canvas-text-item__input');
        obj.hasBackground = true;
        const screenFont = obj.fontSize * this.scale;
        if (ta) {
            if (!obj.textAlign) obj.textAlign = 'center';
            // Spellcheck underline appears only while this textarea is actively edited.
            this.setTextareaEditingMode(ta, document.activeElement === ta);
            ta.style.fontSize = screenFont + 'px';
            ta.style.textAlign = obj.textAlign;
            ta.placeholder = 'Type here';
            if (ta.value !== obj.text) ta.value = obj.text;
            this.applyTextDirectionToTextarea(ta, obj.text);
            this.autoGrowTextarea(ta);
        }
        el.classList.add('canvas-text-item--bg');
    }

    // Grow height and width to match typed content (textarea defaults to a fixed width)
    autoGrowTextarea(ta) {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';

        const supportsFieldSizing =
            typeof CSS !== 'undefined' &&
            CSS.supports &&
            CSS.supports('field-sizing', 'content');
        if (!supportsFieldSizing) {
            ta.style.width = '1px';
            ta.style.width = Math.max(32, ta.scrollWidth + 4) + 'px';
        }
    }

    // Toggle browser writing aids by mode:
    // - edit mode (focused): spellcheck/autocorrect enabled
    // - view mode (not focused): red underline hidden
    setTextareaEditingMode(ta, isEditing) {
        if (!ta) return;
        const editing = !!isEditing;
        ta.spellcheck = editing;
        ta.setAttribute('spellcheck', editing ? 'true' : 'false');
        ta.setAttribute('autocomplete', editing ? 'on' : 'off');
        ta.setAttribute('autocorrect', editing ? 'on' : 'off');
        ta.setAttribute('autocapitalize', editing ? 'sentences' : 'off');
    }

    updateTextLayerPositions() {
        if (!this.textLayer) return;
        for (const obj of this.textObjects) {
            const el = this.textLayer.querySelector(`[data-text-id="${CSS.escape(obj.id)}"]`);
            if (!el) continue;
            const scr = this.worldToScreen({ x: obj.worldX, y: obj.worldY });
            el.style.left = scr.x + 'px';
            el.style.top = scr.y + 'px';
            this.applyTextObjectToDom(obj);
        }
    }

    onTextItemPointerDown(e, id) {
        if (!this.drawingEnabled || this.clearConfirmMode) return;
        const item = e.currentTarget;
        const isSelected = this.selectedTextId === id;
        if (!isSelected) {
            // Unselected label:
            // - block native textarea focus (no edit mode on first tap)
            // - keep this finger in the shared pointer map for pan/zoom gestures
            // - select only on true single-finger tap release
            e.stopPropagation();
            e.preventDefault();

            const pos = this.getPointerPos(e);
            this.pointers.set(e.pointerId, pos);
            this.lastPointerScreenPos = pos;

            const tapState = {
                moved: false,
                hadMultiTouch: this.pointers.size >= 2,
                startClientX: e.clientX,
                startClientY: e.clientY,
                holdSelected: false,
                holdTimer: null
            };

            // Touch-only shortcut: hold briefly to auto-select before dragging.
            if (e.pointerType === 'touch') {
                tapState.holdTimer = setTimeout(() => {
                    // Only auto-select when this is still a true single-finger hold.
                    if (
                        tapState.moved ||
                        tapState.hadMultiTouch ||
                        !this.pointers.has(e.pointerId) ||
                        this.pointers.size !== 1
                    ) return;
                    tapState.holdSelected = true;
                    if (this.selectedTextId !== id) {
                        this.selectTextObject(id);
                    }
                }, TEXT_HOLD_TO_SELECT_MS);
            }

            if (this.pointers.size === 2) {
                this.stopDrawing();
                this.initializeTwoFingerGesture();
            }

            const onMove = (evt) => {
                if (evt.pointerId !== e.pointerId) return;
                const movePos = this.getPointerPos(evt);
                this.pointers.set(e.pointerId, movePos);
                this.lastPointerScreenPos = movePos;

                const dx = evt.clientX - tapState.startClientX;
                const dy = evt.clientY - tapState.startClientY;
                if (!tapState.moved && dx * dx + dy * dy > 36) {
                    tapState.moved = true;
                    if (tapState.holdTimer) {
                        clearTimeout(tapState.holdTimer);
                        tapState.holdTimer = null;
                    }
                }

                if (this.pointers.size >= 2) {
                    tapState.hadMultiTouch = true;
                    if (tapState.holdTimer) {
                        clearTimeout(tapState.holdTimer);
                        tapState.holdTimer = null;
                    }
                    this.handleTwoFingerGesture();
                }

                // After hold-to-select, start drag immediately when finger starts moving.
                if (
                    tapState.holdSelected &&
                    tapState.moved &&
                    !tapState.hadMultiTouch &&
                    !this.textDragState
                ) {
                    this.startTextDragFromPointer(item, id, evt, false);
                    this.onDocumentPointerMoveForText(evt);
                }
            };

            // Cleanup this touch from the shared pointer map when it ends; select on real tap only.
            const clearGesturePointer = (evt) => {
                if (evt.pointerId !== e.pointerId) return;
                if (tapState.holdTimer) {
                    clearTimeout(tapState.holdTimer);
                    tapState.holdTimer = null;
                }
                if (this.pointers.size >= 2) {
                    tapState.hadMultiTouch = true;
                }
                this.pointers.delete(e.pointerId);
                document.removeEventListener('pointermove', onMove, true);
                document.removeEventListener('pointerup', clearGesturePointer, true);
                document.removeEventListener('pointercancel', clearGesturePointer, true);

                if (
                    evt.type === 'pointerup' &&
                    !tapState.moved &&
                    !tapState.hadMultiTouch &&
                    this.selectedTextId !== id
                ) {
                    this.selectTextObject(id);
                }
            };
            document.addEventListener('pointermove', onMove, true);
            document.addEventListener('pointerup', clearGesturePointer, true);
            document.addEventListener('pointercancel', clearGesturePointer, true);
            return;
        }

        // Dragging is available only when the label is already selected.
        e.stopPropagation();
        e.preventDefault();

        this.startTextDragFromPointer(item, id, e, isSelected);
    }

    // Shared drag initializer so selected drag and hold-to-drag use one path.
    startTextDragFromPointer(item, id, e, wasSelectedAtStart) {
        const obj = this.getTextObjectById(id);
        if (!obj) return;
        this.textDragState = {
            pointerId: e.pointerId,
            id,
            wasSelectedAtStart: !!wasSelectedAtStart,
            startClientX: e.clientX,
            startClientY: e.clientY,
            originWorldX: obj.worldX,
            originWorldY: obj.worldY,
            historyBeforeState: this.captureCanvasState(),
            dragging: false
        };

        try {
            item.setPointerCapture(e.pointerId);
        } catch (err) { /* ignore */ }
    }

    onDocumentPointerMoveForText(e) {
        if (!this.textDragState || e.pointerId !== this.textDragState.pointerId) return;
        const s = this.textDragState;
        const dx = e.clientX - s.startClientX;
        const dy = e.clientY - s.startClientY;
        if (!s.dragging && dx * dx + dy * dy > 36) {
            s.dragging = true;
        }
        if (!s.dragging) return;

        const obj = this.getTextObjectById(s.id);
        if (!obj) return;
        obj.worldX = s.originWorldX + dx / this.scale;
        obj.worldY = s.originWorldY + dy / this.scale;
        this.updateTextLayerPositions();
    }

    onDocumentPointerUpForText(e) {
        if (!this.textDragState || e.pointerId !== this.textDragState.pointerId) return;
        const s = this.textDragState;
        const item = this.textLayer.querySelector(`[data-text-id="${CSS.escape(s.id)}"]`);

        // If already selected and the user taps (no drag), switch into text edit mode.
        if (!s.dragging && s.wasSelectedAtStart) {
            const ta = item && item.querySelector('.canvas-text-item__input');
            if (ta) {
                this.setTextareaEditingMode(ta, true);
                try {
                    ta.focus({ preventScroll: true });
                } catch (err) {
                    ta.focus();
                }
                try {
                    const len = ta.value.length;
                    ta.setSelectionRange(len, len);
                } catch (err) { /* mobile browser selection quirks */ }
                this._scheduleTextEditPanelGeometry?.();
                this.updateCanvasTextEditingChrome();
            }
        }

        try {
            if (item) item.releasePointerCapture(e.pointerId);
        } catch (err) { /* ignore */ }
        if (s.dragging) {
            this.recordStateChange(s.historyBeforeState, this.captureCanvasState());
        }
        this.textDragState = null;
    }

    // Shared export textbox metrics so bounds and drawing stay identical.
    getExportTextLayoutMetrics(fontSize) {
        return {
            lineHeight: fontSize * 1.25,
            padX: fontSize * 0.5, // Matches CSS: padding-inline 0.5em
            padY: fontSize * 0.333, // Matches CSS: padding-block 0.333em
            radius: fontSize * 0.833 // Visual equivalent of large pill radius
        };
    }

    // Canvas round-rect helper with fallback for older browsers.
    drawExportRoundedRect(ctx, x, y, w, h, radius) {
        const r = Math.max(0, Math.min(radius, w / 2, h / 2));
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
            ctx.fill();
            return;
        }
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
    }

    // Measure one text object in world-ish units for export bounds
    getTextWorldBounds(obj) {
        const fs = obj.fontSize;
        const lines = (obj.text || ' ').split('\n');
        const metrics = this.getExportTextLayoutMetrics(fs);
        this.ctx.save();
        this.ctx.font = `500 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        let maxW = 0;
        for (const line of lines) {
            const w = this.ctx.measureText(line || ' ').width;
            maxW = Math.max(maxW, w);
        }
        this.ctx.restore();
        const textBlockH = lines.length * metrics.lineHeight;
        const h = textBlockH + metrics.padY * 2;
        const w = maxW + metrics.padX * 2;
        return {
            minX: obj.worldX - w / 2,
            maxX: obj.worldX + w / 2,
            minY: obj.worldY - h / 2,
            maxY: obj.worldY + h / 2
        };
    }

    drawTextObjectsToExportContext(ctx) {
        ctx.save();
        ctx.textBaseline = 'middle';
        const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

        for (const t of this.textObjects) {
            if (!t.text || !t.text.trim()) continue;

            const textDir = this.inferTextDirectionFromContent(t.text);
            if ('direction' in ctx) {
                ctx.direction = textDir;
            }

            const align = t.textAlign || 'center';
            const lines = t.text.split('\n');
            const fs = t.fontSize;
            const metrics = this.getExportTextLayoutMetrics(fs);
            const lh = metrics.lineHeight;
            const textBlockH = lines.length * lh;
            const startY = t.worldY - ((lines.length - 1) * lh) / 2;
            ctx.font = `500 ${fs}px ${fontFamily}`;

            let maxW = 0;
            for (const line of lines) {
                maxW = Math.max(maxW, ctx.measureText(line || ' ').width);
            }
            const bgW = maxW + metrics.padX * 2;
            const bgH = textBlockH + metrics.padY * 2;
            const bgX = t.worldX - bgW / 2;
            const bgY = t.worldY - bgH / 2;

            // Match the pill background from the live canvas textbox.
            ctx.fillStyle = '#F4F4F4';
            this.drawExportRoundedRect(ctx, bgX, bgY, bgW, bgH, metrics.radius);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] || ' ';
                const y = startY + i * lh;

                let xText;

                if (align === 'left') {
                    ctx.textAlign = 'left';
                    xText = t.worldX - maxW / 2;
                } else if (align === 'right') {
                    ctx.textAlign = 'right';
                    xText = t.worldX + maxW / 2;
                } else {
                    ctx.textAlign = 'center';
                    xText = t.worldX;
                }

                ctx.fillStyle = '#000000';
                ctx.fillText(line, xText, y);
            }
        }
        ctx.restore();
    }

    // UI setup and updates
    setupUI() {
        // Toolbar buttons that look disabled but still receive taps (haptic + shake)
        const addSoftDisabledToolbarHandler = (
            id,
            isActionBlocked,
            handler,
            shakeSelector,
            beforeBlockedCheck = null
        ) => {
            const btn = document.getElementById(id);
            let isProcessing = false;
            let lastEventTime = 0;
            
            const protectedHandler = () => {
                const now = Date.now();
                if (isProcessing || (now - lastEventTime) < 100) {
                    return;
                }

                if (typeof beforeBlockedCheck === 'function') {
                    beforeBlockedCheck.call(this);
                }
                
                if (isActionBlocked.call(this)) {
                    isProcessing = true;
                    lastEventTime = now;
                    triggerDisabledToolToggleHaptic();
                    const shakeEl = document.querySelector(shakeSelector);
                    if (shakeEl) {
                        shakeEl.classList.add('shake');
                        setTimeout(() => shakeEl.classList.remove('shake'), 300);
                    }
                    setTimeout(() => {
                        isProcessing = false;
                    }, 50);
                    return;
                }
                
                isProcessing = true;
                lastEventTime = now;
                try {
                    triggerHaptic();
                    handler.call(this);
                } catch (error) {
                    console.error(`Button handler error for ${id}:`, error);
                }
                setTimeout(() => {
                    isProcessing = false;
                }, 50);
            };
            
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                protectedHandler();
            });
            
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.touches.length === 0 && e.changedTouches.length === 1) {
                    protectedHandler();
                }
            }, { passive: false });
        };
        
        addSoftDisabledToolbarHandler(
            'undoBtn',
            function undoBlocked() {
                return this.historyIndex < 0 || !this.drawingEnabled || this.clearConfirmMode;
            },
            () => this.undo(),
            '.undo-redo-container',
            () => this.selectTextObject(null)
        );
        addSoftDisabledToolbarHandler(
            'redoBtn',
            function redoBlocked() {
                return this.historyIndex >= this.history.length - 1 || !this.drawingEnabled || this.clearConfirmMode;
            },
            () => this.redo(),
            '.undo-redo-container',
            () => this.selectTextObject(null)
        );
        addSoftDisabledToolbarHandler(
            'clearBtn',
            function clearBlocked() {
                return (
                    (this.strokes.length === 0 && this.textObjects.length === 0) ||
                    !this.drawingEnabled
                );
            },
            () => this.handleClearClick(),
            '#clearBtn'
        );
        addSoftDisabledToolbarHandler(
            'shareBtn',
            function shareBlocked() {
                return (
                    (this.strokes.length === 0 && this.textObjects.length === 0) ||
                    !this.drawingEnabled ||
                    this.clearConfirmMode
                );
            },
            () => this.share(),
            '#shareBtn',
            () => this.selectTextObject(null)
        );
        
        // Setup tool selector
        this.setupToolSelector();

        this.updateUI();
    }

    updateUI() {
        const splashVisible = !this.drawingEnabled;
        const confirmBlock = this.clearConfirmMode;
        
        // Undo/redo: soft-disable so taps still reach handlers (haptics + shake)
        this.setUndoRedoSoftDisabled(
            this.historyIndex < 0 || splashVisible || confirmBlock,
            this.historyIndex >= this.history.length - 1 || splashVisible || confirmBlock
        );
        
        const nothingToExport =
            this.strokes.length === 0 && this.textObjects.length === 0;
        this.setClearShareSoftDisabled(
            nothingToExport || splashVisible,
            nothingToExport || splashVisible || confirmBlock
        );
        
        // Update tool selector state
        this.updateToolSelector();
    }
    
    // Undo/redo look disabled but stay clickable for feedback
    setUndoRedoSoftDisabled(undoBlocked, redoBlocked) {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        
        undoBtn.classList.toggle('toolbar-btn--disabled', undoBlocked);
        redoBtn.classList.toggle('toolbar-btn--disabled', redoBlocked);
        if (undoBlocked) {
            undoBtn.setAttribute('aria-disabled', 'true');
            undoBtn.tabIndex = -1;
        } else {
            undoBtn.removeAttribute('aria-disabled');
            undoBtn.tabIndex = 0;
        }
        if (redoBlocked) {
            redoBtn.setAttribute('aria-disabled', 'true');
            redoBtn.tabIndex = -1;
        } else {
            redoBtn.removeAttribute('aria-disabled');
            redoBtn.tabIndex = 0;
        }
    }
    
    // Clear / share: same soft-disable pattern as undo/redo
    setClearShareSoftDisabled(clearBlocked, shareBlocked) {
        const clearBtn = document.getElementById('clearBtn');
        const shareBtn = document.getElementById('shareBtn');
        
        clearBtn.classList.toggle('toolbar-btn--disabled', clearBlocked);
        shareBtn.classList.toggle('toolbar-btn--disabled', shareBlocked);
        if (clearBlocked) {
            clearBtn.setAttribute('aria-disabled', 'true');
            clearBtn.tabIndex = -1;
        } else {
            clearBtn.removeAttribute('aria-disabled');
            clearBtn.tabIndex = 0;
        }
        if (shareBlocked) {
            shareBtn.setAttribute('aria-disabled', 'true');
            shareBtn.tabIndex = -1;
        } else {
            shareBtn.removeAttribute('aria-disabled');
            shareBtn.tabIndex = 0;
        }
    }
    
    // Setup theme observer to detect light/dark mode changes
    setupThemeObserver() {
        // Create a MediaQueryList to watch for theme changes
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        // Function to handle theme changes
        const handleThemeChange = () => {
            // Force a redraw when theme changes so existing strokes update their colors
            this.isDirty = true;
            console.log('Theme changed, forcing redraw');
        };
        
        // Listen for theme changes
        mediaQuery.addEventListener('change', handleThemeChange);
        
        // Also listen for CSS custom property changes (for manual theme switching)
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    // Check if CSS custom properties changed
                    const oldValue = mutation.oldValue;
                    const newValue = mutation.target.getAttribute('style');
                    if (oldValue !== newValue) {
                        this.isDirty = true;
                        console.log('CSS properties changed, forcing redraw');
                    }
                }
            });
        });
        
        // Observe the document element for style changes
        observer.observe(document.documentElement, {
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['style']
        });
        
        // Store references for cleanup if needed
        this.themeObserver = observer;
        this.themeMediaQuery = mediaQuery;
    }

    // Setup tool selector toggle
    setupToolSelector() {
        const brushBtn = document.getElementById('brushBtn');
        const eraserBtn = document.getElementById('eraserBtn');
        const toolToggle = document.querySelector('.tool-toggle');
        
        // Make entire toggle area clickable to switch tools
        toolToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectTextObject(null);
            
            // If eraser is disabled, only allow switching to brush
            const hasStrokes = this.strokes.length > 0;
            if (!hasStrokes) {
                triggerDisabledToolToggleHaptic();
                // If trying to switch to eraser while disabled, show shake animation
                if (this.currentTool === 'brush') {
                    this.triggerShakeAnimation();
                }
                this.setTool('brush');
                return;
            }
            
            // Toggle between brush and eraser
            const newTool = this.currentTool === 'brush' ? 'eraser' : 'brush';
            this.setTool(newTool);
        });
        
        // Use a more robust approach for standalone mode compatibility
        let touchStartTime = 0;
        let touchStartPos = { x: 0, y: 0 };
        let isLongPress = false;
        let longPressTimer = null;
        
        toolToggle.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const touch = e.touches[0];
            touchStartTime = Date.now();
            touchStartPos = { x: touch.clientX, y: touch.clientY };
            isLongPress = false;
            
            // Only show active state if eraser is not disabled
            if (this.strokes.length > 0) {
                toolToggle.classList.add('active-state');
            }
            
            // Set timer for long press detection (500ms)
            longPressTimer = setTimeout(() => {
                isLongPress = true;
                // Provide haptic feedback for long press
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }, 500);
        });
        
        toolToggle.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Cancel long press if finger moves too much
            if (e.touches[0]) {
                const touch = e.touches[0];
                const distance = Math.sqrt(
                    Math.pow(touch.clientX - touchStartPos.x, 2) + 
                    Math.pow(touch.clientY - touchStartPos.y, 2)
                );
                
                if (distance > 10) { // 10px threshold
                    if (longPressTimer) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                    isLongPress = false;
                }
            }
        });
        
        toolToggle.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectTextObject(null);
            
            // Clear long press timer
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            
            // Always clear background color on touch end
            toolToggle.classList.remove('active-state');
            
            // Calculate touch duration
            const touchDuration = Date.now() - touchStartTime;
            
            // If eraser is disabled, only allow switching to brush
            const hasStrokes = this.strokes.length > 0;
            if (!hasStrokes) {
                triggerDisabledToolToggleHaptic();
                // If trying to switch to eraser while disabled, show shake animation
                if (this.currentTool === 'brush') {
                    this.triggerShakeAnimation();
                }
                this.setTool('brush');
                return;
            }
            
            // Toggle between brush and eraser (works for both short and long taps)
            const newTool = this.currentTool === 'brush' ? 'eraser' : 'brush';
            this.setTool(newTool);
            
            // Log for debugging
            console.log(`Tool switched to ${newTool} after ${touchDuration}ms touch (long press: ${isLongPress})`);
        });
        
        toolToggle.addEventListener('touchcancel', () => {
            // Clear long press timer
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            
            // Always clear background color on touch cancel
            toolToggle.classList.remove('active-state');
        });
        
        toolToggle.addEventListener('mousedown', () => {
            // Only show active state if eraser is not disabled
            if (this.strokes.length > 0) {
                toolToggle.classList.add('active-state');
            }
        });
        
        toolToggle.addEventListener('mouseup', () => {
            // Always clear background color on mouse up
            toolToggle.classList.remove('active-state');
        });
        
        toolToggle.addEventListener('mouseleave', () => {
            // Always clear background color on mouse leave
            toolToggle.classList.remove('active-state');
        });
    }
    
    // Set the current tool
    setTool(tool) {
        if (tool === this.currentTool) return;
        
        triggerHaptic();
        this.currentTool = tool;
        
        // Update UI
        this.updateToolSelector();
        
        // Update cursor
        this.canvas.style.cursor = tool === 'eraser' ? 'crosshair' : 'crosshair';
        
        console.log('Tool changed to:', tool);
    }
    
    // Update tool selector UI state
    updateToolSelector() {
        const brushBtn = document.getElementById('brushBtn');
        const eraserBtn = document.getElementById('eraserBtn');
        const toolToggle = document.querySelector('.tool-toggle');
        
        // Update button states - only show active if tool is selected AND eraser is not disabled
        const hasStrokes = this.strokes.length > 0;
        brushBtn.classList.toggle('active', this.currentTool === 'brush');
        eraserBtn.classList.toggle('active', this.currentTool === 'eraser' && hasStrokes);
        
        // Update toggle handle position
        toolToggle.classList.toggle('eraser-active', this.currentTool === 'eraser');
        
        // Disable eraser if no strokes exist
        eraserBtn.disabled = !hasStrokes;
        
        // Add/remove eraser-disabled class to toggle for CSS styling
        toolToggle.classList.toggle('eraser-disabled', !hasStrokes);
        
        // Clear any stuck background color when eraser becomes disabled
        if (!hasStrokes) {
            toolToggle.style.backgroundColor = '';
        }
        
        // Auto-select brush if eraser is disabled and eraser was selected
        if (!hasStrokes && this.currentTool === 'eraser') {
            this.setTool('brush');
        }
    }
    
    // Trigger shake animation when eraser tool is disabled
    triggerShakeAnimation() {
        const toolToggle = document.querySelector('.tool-toggle');
        
        // Add shake class
        toolToggle.classList.add('shake');
        
        // Remove shake class after animation completes
        setTimeout(() => {
            toolToggle.classList.remove('shake');
        }, 300); // Match the CSS animation duration
    }
    
}

// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new DrawingApp());
} else {
    new DrawingApp();
}
