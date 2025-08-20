// Vector Drawing Canvas App
// Minimal implementation with smooth drawing, pan/zoom, and sharing

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
        
        // Initialize
        this.setupCanvas();
        this.setupEventListeners();
        this.setupUI();
        this.render();
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
        if (!this.isDrawing || !this.currentStroke) return;
        
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

    clear() {
        if (this.strokes.length > 0) {
            this.addToHistory({ type: 'CLEAR', previousStrokes: [...this.strokes] });
            this.strokes = [];
            this.isDirty = true;
        }
    }

    // Share functionality - prioritizes native OS share sheet
    async share() {
        if (this.strokes.length === 0) {
            alert('No drawing to share! Draw something first.');
            return;
        }
        
        try {
            // Create the image first
            const bounds = this.calculateBounds();
            const padding = 32;
            const dpr = window.devicePixelRatio || 1;
            
            // Create offscreen canvas for export
            const offscreenCanvas = document.createElement('canvas');
            const offscreenCtx = offscreenCanvas.getContext('2d');
            
            const width = bounds.maxX - bounds.minX + padding * 2;
            const height = bounds.maxY - bounds.minY + padding * 2;
            
            // Scale for high-DPI export
            offscreenCanvas.width = width * dpr;
            offscreenCanvas.height = height * dpr;
            offscreenCtx.scale(dpr, dpr);
            
            // White background
            offscreenCtx.fillStyle = 'white';
            offscreenCtx.fillRect(0, 0, width, height);
            
            // Set up drawing style
            offscreenCtx.strokeStyle = '#000000';
            offscreenCtx.lineWidth = this.baseLineWidth;
            offscreenCtx.lineCap = 'round';
            offscreenCtx.lineJoin = 'round';
            
            // Translate to account for bounds and padding
            offscreenCtx.translate(-bounds.minX + padding, -bounds.minY + padding);
            
            // Render all strokes
            for (const stroke of this.strokes) {
                this.renderStrokeToContext(offscreenCtx, stroke);
            }
            
            // Convert to blob and share using native OS share sheet
            offscreenCanvas.toBlob(async (blob) => {
                // Check if Web Share API is available
                if (navigator.share) {
                    try {
                        const file = new File([blob], 'drawing.png', { type: 'image/png' });
                        
                        // Try sharing with files (preferred method for images)
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: 'My Drawing'
                            });
                            return;
                        }
                        
                    } catch (shareError) {
                        console.log('Native share failed:', shareError.message);
                        alert('Sharing failed. This feature requires HTTPS to work properly.');
                        return;
                    }
                }
                
                // Web Share API not available
                alert('Native sharing requires HTTPS. Deploy your app to test the share feature properly.');
                
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
        // Use both click and touchend for better mobile support
        const addButtonHandler = (id, handler) => {
            const btn = document.getElementById(id);
            btn.addEventListener('click', handler);
            
            // Add touchend handler for better mobile response
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Only trigger if it's a single quick tap (not part of double-tap)
                if (e.touches.length === 0) {
                    // Small delay to ensure double-tap prevention has run
                    setTimeout(() => {
                        if (!btn.disabled) {
                            handler();
                        }
                    }, 10);
                }
            }, { passive: false });
        };
        
        addButtonHandler('undoBtn', () => this.undo());
        addButtonHandler('redoBtn', () => this.redo());
        addButtonHandler('clearBtn', () => this.clear());
        addButtonHandler('shareBtn', () => this.share());
        
        this.updateUI();
    }

    updateUI() {
        document.getElementById('undoBtn').disabled = this.historyIndex < 0;
        document.getElementById('redoBtn').disabled = this.historyIndex >= this.history.length - 1;
        document.getElementById('clearBtn').disabled = this.strokes.length === 0;
        document.getElementById('shareBtn').disabled = this.strokes.length === 0;
    }
}

// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new DrawingApp());
} else {
    new DrawingApp();
}
