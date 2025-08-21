// Vector Drawing Canvas App
// Minimal implementation with smooth drawing, pan/zoom, and sharing

// Detect if app is running in standalone mode (home screen web app)
function detectStandaloneMode() {
    if (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches) {
        document.body.classList.add('standalone-mode');
        return true;
    }
    return false;
}

// Run detection when page loads
const isStandaloneMode = detectStandaloneMode();

// Add to Home Screen functionality using native share sheet
class AddToHomeScreenManager {
    constructor() {
        this.addToHomeBtn = document.getElementById('addToHomeBtn');
        this.isStandalone = isStandaloneMode;
        
        // Set up button click handler
        this.setupButtonClickHandler();
        
        // Initially hide the button (will be shown after splash is dismissed)
        this.addToHomeBtn.classList.add('hidden');
    }
    
    // Set up button click handler to trigger share sheet
    setupButtonClickHandler() {
        this.addToHomeBtn.addEventListener('click', async () => {
            try {
                // Trigger share sheet with current page
                if (navigator.share) {
                    await navigator.share({
                        title: 'Canvas Drawing App',
                        text: 'Add this drawing app to your home screen',
                        url: window.location.href
                    });
                }
            } catch (error) {
                // User canceled sharing - do nothing
                if (error.name !== 'AbortError') {
                    console.log('Share error:', error);
                }
            }
        });
        
        // Also handle touch events for better mobile support
        this.addToHomeBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Trigger click after a short delay to prevent double-triggering
            setTimeout(() => {
                this.addToHomeBtn.click();
            }, 10);
        });
    }
    
    // Update button visibility based on conditions
    updateButtonVisibility() {
        const shouldShow = this.shouldShowButton();
        
        if (shouldShow) {
            this.addToHomeBtn.classList.remove('hidden');
        } else {
            this.addToHomeBtn.classList.add('hidden');
        }
    }
    
    // Determine if button should be shown
    shouldShowButton() {
        // Don't show if in standalone mode (already installed)
        if (this.isStandalone) {
            return false;
        }
        
        // Only show if drawing is enabled (splash screen is dismissed)
        if (window.drawingApp && window.drawingApp.drawingEnabled) {
            return true;
        }
        
        // Default to hidden
        return false;
    }
    
    // Method to be called when splash screen state changes
    onSplashScreenStateChange() {
        this.updateButtonVisibility();
    }
}

// Initialize the Add to Home Screen manager
const addToHomeManager = new AddToHomeScreenManager();

// Make it globally available for DrawingApp integration
window.addToHomeManager = addToHomeManager;

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
        this.lazyRadius = 15; // Radius of lazy area
        this.pointerPos = { x: 0, y: 0 }; // Current pointer position
        this.brushPos = { x: 0, y: 0 }; // Current brush position
        this.lazyEnabled = true;
        
        // Drawing settings
        this.baseLineWidth = 5;
        
        // History system
        this.history = [];
        this.historyIndex = -1;
        
        // Clear confirmation state
        this.clearConfirmMode = false;
        this.clearClickInProgress = false;
        
        // Splash screen state
        this.drawingEnabled = false; // Start with drawing disabled
        this.splashScreen = document.getElementById('splashScreen');
        
        // Initialize
        this.setupSplashScreen();
        this.setupCanvas();
        this.setupEventListeners();
        this.setupUI();
        this.render();
    }

    // Splash screen management
    setupSplashScreen() {
        // Check if user has seen the splash screen before
        const hasSeenSplash = localStorage.getItem('canvas-app-splash-seen') === 'true';
        
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
        this.splashScreen.classList.remove('hidden');
        this.drawingEnabled = false;
        console.log('Splash screen shown - drawing disabled');
        
        // Update Add to Home Screen button visibility
        if (window.addToHomeManager) {
            window.addToHomeManager.onSplashScreenStateChange();
        }
    }
    
    // Hide the splash screen and enable drawing
    hideSplashScreen() {
        this.splashScreen.classList.add('hidden');
        
        // Wait for the transition to complete before enabling drawing
        setTimeout(() => {
            this.drawingEnabled = true;
            console.log('Splash screen hidden - drawing enabled');
            
            // Update Add to Home Screen button visibility
            if (window.addToHomeManager) {
                window.addToHomeManager.onSplashScreenStateChange();
            }
        }, 300); // 0.3 seconds to match CSS transition
    }
    
    // Dismiss splash screen and remember user has seen it
    dismissSplashScreen() {
        this.hideSplashScreen();
        localStorage.setItem('canvas-app-splash-seen', 'true');
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
            if (this.strokes.length === 0 && this.drawingEnabled && e.touches.length === 1) {
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
        const resizeCanvas = () => {
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
        };
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
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
        this.pointers.set(event.pointerId, pos);
        
        if (this.pointers.size === 1) {
            // Single finger - start drawing
            this.startDrawing(pos);
        } else if (this.pointers.size === 2) {
            // Two fingers - stop drawing and prepare for pan/zoom
            this.stopDrawing();
            this.initializeTwoFingerGesture();
        }
    }

    handlePointerMove(event) {
        event.preventDefault();
        const pos = this.getPointerPos(event);
        
        if (this.pointers.has(event.pointerId)) {
            this.pointers.set(event.pointerId, pos);
            
            if (this.pointers.size === 1 && this.isDrawing) {
                // Single finger - continue drawing
                this.continueDrawing(pos);
            } else if (this.pointers.size === 2) {
                // Two fingers - pan and zoom
                this.handleTwoFingerGesture();
            }
        }
    }

    handlePointerUp(event) {
        event.preventDefault();
        this.pointers.delete(event.pointerId);
        
        if (this.pointers.size === 0) {
            // No more pointers - stop drawing
            this.stopDrawing();
        } else if (this.pointers.size === 1) {
            // Back to one finger - could resume drawing
            const remainingPos = this.pointers.values().next().value;
            this.startDrawing(remainingPos);
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
            preventDefault: () => event.preventDefault()
        });
    }

    // Drawing functions with lazy brush
    startDrawing(screenPos) {
        // Don't start drawing if drawing is disabled (splash screen visible)
        if (!this.drawingEnabled) {
            return;
        }
        
        this.isDrawing = true;
        
        // Initialize both pointer and brush to start position for smooth drawing start
        this.updateLazyBrush(screenPos);
        this.brushPos = { ...screenPos }; // Set brush to pointer for immediate start
        
        const worldPos = this.screenToWorld(this.brushPos);
        this.currentStroke = {
            points: [worldPos],
            timestamp: Date.now()
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
        if (this.isDrawing && this.currentStroke && this.currentStroke.points.length > 1) {
            // Add stroke directly - lazy brush provides natural smoothing
            this.strokes.push(this.currentStroke);
            
            // Add to history
            this.addToHistory({ type: 'ADD_STROKE', stroke: this.currentStroke });
        }
        
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
            const clampedScale = Math.max(0.1, Math.min(10, newScale)); // Limit zoom range
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



    // Rendering
    render() {
        if (!this.isDirty) {
            requestAnimationFrame(() => this.render());
            return;
        }
        
        // Clear canvas (use display dimensions since context is already scaled)
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        
        // Apply transform
        this.ctx.save();
        this.ctx.translate(this.panX, this.panY);
        this.ctx.scale(this.scale, this.scale);
        
        // Set drawing style
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = this.baseLineWidth; // Scale with zoom
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Render all completed strokes
        for (const stroke of this.strokes) {
            this.renderStroke(stroke);
        }
        
        // Render current stroke being drawn
        if (this.currentStroke && this.currentStroke.points.length > 1) {
            this.renderStroke(this.currentStroke);
        }
        
        this.ctx.restore();
        this.isDirty = false;
        
        requestAnimationFrame(() => this.render());
    }

    renderStroke(stroke) {
        const points = stroke.points;
        if (points.length < 2) return;
        
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
    }

    // History system
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
            
            if (action.type === 'ADD_STROKE') {
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
            
            if (action.type === 'ADD_STROKE') {
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
        if (this.strokes.length > 0) {
            // Clear everything - strokes, history, and reset view
            this.strokes = [];
            
            // Reset history completely (clean slate)
            this.history = [];
            this.historyIndex = -1;
            
            // Reset zoom and pan to baseline
            this.scale = 1;
            this.panX = 0;
            this.panY = 0;
            
            this.isDirty = true;
            this.updateUI(); // Update button states after clearing
        }
        
        // Exit confirm mode after clearing
        this.exitClearConfirmMode();
    }
    
    // Disable other buttons when in confirm mode
    disableOtherButtons() {
        document.getElementById('undoBtn').disabled = true;
        document.getElementById('redoBtn').disabled = true;
        document.getElementById('shareBtn').disabled = true;
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
        if (this.strokes.length === 0) {
            alert('No drawing to share! Draw something first.');
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
            
            // White background
            offscreenCtx.fillStyle = 'white';
            offscreenCtx.fillRect(0, 0, width, height);
            
            // Set up drawing style
            offscreenCtx.strokeStyle = '#000000';
            offscreenCtx.lineWidth = this.baseLineWidth * scaleFactor;
            offscreenCtx.lineCap = 'round';
            offscreenCtx.lineJoin = 'round';
            
            // Apply scaling and translation to fit the drawing in the export canvas
            offscreenCtx.save();
            offscreenCtx.scale(scaleFactor, scaleFactor);
            offscreenCtx.translate(-bounds.minX + padding / scaleFactor, -bounds.minY + padding / scaleFactor);
            
            // Render all strokes
            for (const stroke of this.strokes) {
                this.renderStrokeToContext(offscreenCtx, stroke);
            }
            
            offscreenCtx.restore();
            
            // Convert to blob and share using native OS share sheet
            offscreenCanvas.toBlob(async (blob) => {
                if (!blob) {
                    console.error('Failed to create image blob');
                    alert('Failed to create image. The drawing might be too large. Try clearing part of it and sharing again.');
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
                
                // Web Share API not available - only show message in development
                if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
                    console.log('Web Share API not available on localhost. Deploy with HTTPS to test sharing.');
                } else {
                    console.log('Web Share API not supported in this browser/environment.');
                }
                
            }, 'image/png');
            
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to prepare drawing for sharing. Please try again.');
        }
    }

    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (const stroke of this.strokes) {
            for (const point of stroke.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        }
        
        return { minX, minY, maxX, maxY };
    }

    renderStrokeToContext(ctx, stroke) {
        const points = stroke.points;
        if (points.length < 2) return;
        
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
    }

    // UI setup and updates
    setupUI() {
        // Protected button handler prevents multiple rapid calls
        const addButtonHandler = (id, handler) => {
            const btn = document.getElementById(id);
            let isProcessing = false;
            let lastEventTime = 0;
            
            const protectedHandler = (eventType) => {
                // Prevent multiple rapid calls within 100ms
                const now = Date.now();
                if (isProcessing || (now - lastEventTime) < 100) {
                    return;
                }
                
                isProcessing = true;
                lastEventTime = now;
                
                // Only execute if button is not disabled
                if (!btn.disabled) {
                    try {
                        handler();
                    } catch (error) {
                        console.error(`Button handler error for ${id}:`, error);
                    }
                }
                
                // Reset processing flag after a short delay
                setTimeout(() => {
                    isProcessing = false;
                }, 50);
            };
            
            // Add click handler for desktop/mouse
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                protectedHandler('click');
            });
            
            // Add touchend handler for mobile with extra protection
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Only trigger on single finger release
                if (e.touches.length === 0 && e.changedTouches.length === 1) {
                    protectedHandler('touchend');
                }
            }, { passive: false });
        };
        
        addButtonHandler('undoBtn', () => this.undo());
        addButtonHandler('redoBtn', () => this.redo());
        addButtonHandler('clearBtn', () => this.handleClearClick());
        addButtonHandler('shareBtn', () => this.share());
        
        this.updateUI();
    }

    updateUI() {
        // If splash screen is visible, disable all toolbar buttons except when in confirm mode
        const splashVisible = !this.drawingEnabled;
        
        document.getElementById('undoBtn').disabled = this.historyIndex < 0 || splashVisible;
        document.getElementById('redoBtn').disabled = this.historyIndex >= this.history.length - 1 || splashVisible;
        document.getElementById('clearBtn').disabled = this.strokes.length === 0 || splashVisible;
        document.getElementById('shareBtn').disabled = this.strokes.length === 0 || splashVisible;
    }
}

// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.drawingApp = new DrawingApp();
    });
} else {
    window.drawingApp = new DrawingApp();
}
