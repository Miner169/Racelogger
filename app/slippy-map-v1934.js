/* Race Bib Logger v19.3.4 — dependency-free interactive OpenStreetMap renderer.
 * Loads only the raster tiles visible in the current viewport. No API key,
 * account, geocoder, tile prefetch, or background map download is used.
 */
(function (global) {
  'use strict';

  const TILE_SIZE = 256;
  const MIN_LAT = -85.05112878;
  const MAX_LAT = 85.05112878;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normaliseLng(lng) {
    let value = Number(lng) || 0;
    while (value < -180) value += 360;
    while (value >= 180) value -= 360;
    return value;
  }

  function latLngToWorld(lat, lng, zoom) {
    const safeLat = clamp(Number(lat) || 0, MIN_LAT, MAX_LAT);
    const safeLng = normaliseLng(lng);
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const sin = Math.sin(safeLat * Math.PI / 180);
    return {
      x: (safeLng + 180) / 360 * scale,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
    };
  }

  function worldToLatLng(x, y, zoom) {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const lng = x / scale * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / scale;
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat: clamp(lat, MIN_LAT, MAX_LAT), lng: normaliseLng(lng) };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function safeText(value) {
    return String(value == null ? '' : value);
  }

  class RaceSlippyMap {
    constructor(container, options = {}) {
      if (!container) throw new Error('Map container is missing.');
      this.container = container;
      this.options = {
        minZoom: Number.isFinite(options.minZoom) ? options.minZoom : 2,
        maxZoom: Number.isFinite(options.maxZoom) ? options.maxZoom : 19,
        tileUrl: options.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: options.attribution || '© OpenStreetMap contributors'
      };
      this.center = { lat: Number(options.center?.lat) || 0, lng: Number(options.center?.lng) || 0 };
      this.zoom = clamp(Math.round(Number(options.zoom) || 13), this.options.minZoom, this.options.maxZoom);
      this.markers = [];
      this.polylines = [];
      this.fitPoints = [];
      this.pointerMap = new Map();
      this.dragState = null;
      this.pinchState = null;
      this.renderFrame = 0;
      this.tileLoadCount = 0;
      this.tileErrorCount = 0;
      this.destroyed = false;
      this.popupMarkerId = '';

      this._build();
      this._bind();
      this.scheduleRender();
    }

    _build() {
      this.container.innerHTML = `
        <div class="race-slippy-map" role="application" aria-label="Interactive map of checkpoints and PWA devices">
          <div class="race-slippy-tiles" aria-hidden="true"></div>
          <svg class="race-slippy-lines" aria-hidden="true"></svg>
          <div class="race-slippy-markers"></div>
          <div class="race-slippy-popup hidden" role="dialog" aria-live="polite"></div>
          <div class="race-slippy-controls" aria-label="Map controls">
            <button type="button" data-map-action="zoom-in" aria-label="Zoom in">+</button>
            <button type="button" data-map-action="zoom-out" aria-label="Zoom out">−</button>
            <button type="button" data-map-action="fit" aria-label="Show all checkpoints and devices">◎</button>
          </div>
          <div class="race-slippy-tile-status hidden" role="status">Map tiles unavailable. Checkpoints and device positions are still shown.</div>
          <a class="race-slippy-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">${this.options.attribution}</a>
        </div>`;
      this.viewport = this.container.querySelector('.race-slippy-map');
      this.tilePane = this.container.querySelector('.race-slippy-tiles');
      this.linePane = this.container.querySelector('.race-slippy-lines');
      this.markerPane = this.container.querySelector('.race-slippy-markers');
      this.popup = this.container.querySelector('.race-slippy-popup');
      this.tileStatus = this.container.querySelector('.race-slippy-tile-status');
    }

    _bind() {
      this.onPointerDown = (event) => this._pointerDown(event);
      this.onPointerMove = (event) => this._pointerMove(event);
      this.onPointerUp = (event) => this._pointerUp(event);
      this.onWheel = (event) => this._wheel(event);
      this.onDoubleClick = (event) => {
        event.preventDefault();
        this._zoomAt(event.clientX, event.clientY, this.zoom + 1);
      };
      this.onKeyDown = (event) => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); this.setZoom(this.zoom + 1); }
        if (event.key === '-') { event.preventDefault(); this.setZoom(this.zoom - 1); }
        if (event.key === 'Escape') this.closePopup();
      };
      this.onControlClick = (event) => {
        const action = event.target.closest('[data-map-action]')?.dataset.mapAction;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        if (action === 'zoom-in') this.setZoom(this.zoom + 1);
        else if (action === 'zoom-out') this.setZoom(this.zoom - 1);
        else if (action === 'fit') this.fitBounds(this.fitPoints, 54);
      };
      this.onMarkerClick = (event) => {
        const marker = event.target.closest('[data-race-map-marker]');
        if (!marker) return;
        event.preventDefault();
        event.stopPropagation();
        const item = this.markers.find(entry => entry.id === marker.dataset.raceMapMarker);
        if (item) this.openPopup(item);
      };

      this.viewport.tabIndex = 0;
      this.viewport.addEventListener('pointerdown', this.onPointerDown);
      this.viewport.addEventListener('pointermove', this.onPointerMove);
      this.viewport.addEventListener('pointerup', this.onPointerUp);
      this.viewport.addEventListener('pointercancel', this.onPointerUp);
      this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
      this.viewport.addEventListener('dblclick', this.onDoubleClick);
      this.viewport.addEventListener('keydown', this.onKeyDown);
      this.viewport.addEventListener('click', this.onControlClick);
      this.markerPane.addEventListener('click', this.onMarkerClick);
      this.viewport.addEventListener('click', (event) => {
        if (!event.target.closest('[data-race-map-marker], .race-slippy-popup, .race-slippy-controls')) this.closePopup();
      });
      if ('ResizeObserver' in global) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
        this.resizeObserver.observe(this.container);
      } else {
        this.onWindowResize = () => this.scheduleRender();
        global.addEventListener('resize', this.onWindowResize);
      }
    }

    setData({ markers = [], polylines = [] } = {}) {
      this.markers = markers.filter(item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng))).map((item, index) => ({
        ...item,
        id: safeText(item.id || `marker-${index}`),
        lat: Number(item.lat),
        lng: Number(item.lng)
      }));
      this.polylines = polylines.map((line, index) => ({
        ...line,
        id: safeText(line.id || `line-${index}`),
        points: (line.points || []).filter(point => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng))).map(point => ({ lat: Number(point.lat), lng: Number(point.lng) }))
      })).filter(line => line.points.length > 1);
      this.fitPoints = this.markers.map(marker => ({ lat: marker.lat, lng: marker.lng }));
      this.scheduleRender();
      return this;
    }

    setView(center, zoom = this.zoom) {
      if (center && Number.isFinite(Number(center.lat)) && Number.isFinite(Number(center.lng))) {
        this.center = { lat: clamp(Number(center.lat), MIN_LAT, MAX_LAT), lng: normaliseLng(center.lng) };
      }
      this.zoom = clamp(Math.round(Number(zoom) || this.zoom), this.options.minZoom, this.options.maxZoom);
      this.closePopup();
      this.scheduleRender();
      return this;
    }

    setZoom(zoom) {
      return this.setView(this.center, zoom);
    }

    fitBounds(points, padding = 48) {
      const valid = (points || []).filter(point => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
      if (!valid.length) return this;
      if (valid.length === 1) return this.setView(valid[0], Math.min(16, this.options.maxZoom));
      const width = Math.max(180, this.viewport.clientWidth || this.container.clientWidth || 320);
      const height = Math.max(180, this.viewport.clientHeight || this.container.clientHeight || 320);
      let selectedZoom = this.options.minZoom;
      let selectedCenter = valid[0];
      for (let zoom = this.options.maxZoom; zoom >= this.options.minZoom; zoom--) {
        const worlds = valid.map(point => latLngToWorld(point.lat, point.lng, zoom));
        const minX = Math.min(...worlds.map(point => point.x));
        const maxX = Math.max(...worlds.map(point => point.x));
        const minY = Math.min(...worlds.map(point => point.y));
        const maxY = Math.max(...worlds.map(point => point.y));
        if (maxX - minX <= width - padding * 2 && maxY - minY <= height - padding * 2) {
          selectedZoom = zoom;
          selectedCenter = worldToLatLng((minX + maxX) / 2, (minY + maxY) / 2, zoom);
          break;
        }
      }
      return this.setView(selectedCenter, selectedZoom);
    }

    scheduleRender() {
      if (this.destroyed || this.renderFrame) return;
      this.renderFrame = global.requestAnimationFrame(() => {
        this.renderFrame = 0;
        this.render();
      });
    }

    render() {
      if (this.destroyed) return;
      const width = this.viewport.clientWidth;
      const height = this.viewport.clientHeight;
      if (!width || !height) return;
      const centerWorld = latLngToWorld(this.center.lat, this.center.lng, this.zoom);
      const origin = { x: centerWorld.x - width / 2, y: centerWorld.y - height / 2 };
      this.lastOrigin = origin;
      this.lastSize = { width, height };
      this._renderTiles(origin, width, height);
      this._renderLines(origin, width, height);
      this._renderMarkers(origin);
      if (this.popupMarkerId) {
        const item = this.markers.find(marker => marker.id === this.popupMarkerId);
        if (item) this._positionPopup(item, origin);
      }
    }

    _renderTiles(origin, width, height) {
      const zoom = this.zoom;
      const tileCount = Math.pow(2, zoom);
      const startX = Math.floor(origin.x / TILE_SIZE) - 1;
      const endX = Math.floor((origin.x + width) / TILE_SIZE) + 1;
      const startY = Math.floor(origin.y / TILE_SIZE) - 1;
      const endY = Math.floor((origin.y + height) / TILE_SIZE) + 1;
      const fragment = document.createDocumentFragment();
      this.tilePane.replaceChildren();
      this.tileLoadCount = 0;
      this.tileErrorCount = 0;
      for (let tileY = startY; tileY <= endY; tileY++) {
        if (tileY < 0 || tileY >= tileCount) continue;
        for (let tileX = startX; tileX <= endX; tileX++) {
          const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
          const img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.decoding = 'async';
          img.loading = 'eager';
          img.width = TILE_SIZE;
          img.height = TILE_SIZE;
          img.style.left = `${Math.round(tileX * TILE_SIZE - origin.x)}px`;
          img.style.top = `${Math.round(tileY * TILE_SIZE - origin.y)}px`;
          img.src = this.options.tileUrl.replace('{z}', zoom).replace('{x}', wrappedX).replace('{y}', tileY);
          img.addEventListener('load', () => {
            this.tileLoadCount += 1;
            this.tileStatus.classList.add('hidden');
          }, { once: true });
          img.addEventListener('error', () => {
            this.tileErrorCount += 1;
            if (!this.tileLoadCount && this.tileErrorCount >= 3) this.tileStatus.classList.remove('hidden');
          }, { once: true });
          fragment.appendChild(img);
        }
      }
      this.tilePane.appendChild(fragment);
    }

    _project(point, origin) {
      const world = latLngToWorld(point.lat, point.lng, this.zoom);
      return { x: world.x - origin.x, y: world.y - origin.y };
    }

    _renderLines(origin, width, height) {
      this.linePane.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.linePane.replaceChildren();
      this.polylines.forEach(line => {
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', line.points.map(point => {
          const pos = this._project(point, origin);
          return `${pos.x.toFixed(1)},${pos.y.toFixed(1)}`;
        }).join(' '));
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', line.color || '#22c55e');
        polyline.setAttribute('stroke-width', String(line.width || 4));
        polyline.setAttribute('stroke-opacity', String(line.opacity == null ? 0.62 : line.opacity));
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('stroke-linejoin', 'round');
        this.linePane.appendChild(polyline);
      });
    }

    _renderMarkers(origin) {
      const fragment = document.createDocumentFragment();
      this.markerPane.replaceChildren();
      this.markers.forEach(marker => {
        const pos = this._project(marker, origin);
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.raceMapMarker = marker.id;
        button.className = `race-slippy-marker ${marker.kind === 'checkpoint' ? 'is-checkpoint' : 'is-device'} ${marker.state || ''}`.trim();
        button.style.left = `${pos.x}px`;
        button.style.top = `${pos.y}px`;
        if (marker.color) button.style.setProperty('--marker-color', marker.color);
        button.setAttribute('aria-label', marker.ariaLabel || marker.title || 'Map marker');
        button.title = marker.title || '';
        button.innerHTML = marker.kind === 'checkpoint'
          ? '<span class="race-slippy-checkpoint-flag" aria-hidden="true">⚑</span>'
          : `<span aria-hidden="true">${safeText(marker.label || '•')}</span>`;
        fragment.appendChild(button);
      });
      this.markerPane.appendChild(fragment);
    }

    openPopup(marker) {
      this.popupMarkerId = marker.id;
      this.popup.innerHTML = `<button type="button" class="race-slippy-popup-close" aria-label="Close map information">×</button><div>${marker.popupHtml || safeText(marker.title)}</div>`;
      this.popup.classList.remove('hidden');
      this.popup.querySelector('.race-slippy-popup-close')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.closePopup();
      });
      this._positionPopup(marker, this.lastOrigin || latLngToWorld(this.center.lat, this.center.lng, this.zoom));
    }

    _positionPopup(marker, origin) {
      if (!this.lastSize || !origin || this.popup.classList.contains('hidden')) return;
      const pos = this._project(marker, origin);
      const left = clamp(pos.x, 90, this.lastSize.width - 90);
      const top = clamp(pos.y - 26, 76, this.lastSize.height - 38);
      this.popup.style.left = `${left}px`;
      this.popup.style.top = `${top}px`;
    }

    closePopup() {
      this.popupMarkerId = '';
      this.popup?.classList.add('hidden');
    }

    _localPoint(clientX, clientY) {
      const rect = this.viewport.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    _pointerDown(event) {
      if (event.target.closest('button, a, .race-slippy-popup')) return;
      event.preventDefault();
      this.viewport.setPointerCapture?.(event.pointerId);
      this.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.closePopup();
      this._resetGestureState();
    }

    _pointerMove(event) {
      if (!this.pointerMap.has(event.pointerId)) return;
      event.preventDefault();
      this.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = Array.from(this.pointerMap.values());
      if (points.length === 1 && this.dragState) {
        const current = points[0];
        const dx = current.x - this.dragState.pointer.x;
        const dy = current.y - this.dragState.pointer.y;
        const world = { x: this.dragState.centerWorld.x - dx, y: this.dragState.centerWorld.y - dy };
        this.center = worldToLatLng(world.x, world.y, this.zoom);
        this.scheduleRender();
      } else if (points.length >= 2 && this.pinchState) {
        const currentMid = midpoint(points[0], points[1]);
        const ratio = Math.max(0.25, distance(points[0], points[1]) / Math.max(1, this.pinchState.distance));
        const nextZoom = clamp(Math.round(this.pinchState.zoom + Math.log2(ratio)), this.options.minZoom, this.options.maxZoom);
        const localMid = this._localPoint(currentMid.x, currentMid.y);
        const worldFocus = latLngToWorld(this.pinchState.focus.lat, this.pinchState.focus.lng, nextZoom);
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
        const centerWorld = {
          x: worldFocus.x - (localMid.x - width / 2),
          y: worldFocus.y - (localMid.y - height / 2)
        };
        this.zoom = nextZoom;
        this.center = worldToLatLng(centerWorld.x, centerWorld.y, nextZoom);
        this.scheduleRender();
      }
    }

    _pointerUp(event) {
      if (!this.pointerMap.has(event.pointerId)) return;
      this.pointerMap.delete(event.pointerId);
      try { this.viewport.releasePointerCapture?.(event.pointerId); } catch (_) { /* already released */ }
      this._resetGestureState();
    }

    _resetGestureState() {
      const points = Array.from(this.pointerMap.values());
      this.dragState = null;
      this.pinchState = null;
      if (points.length === 1) {
        this.dragState = {
          pointer: { ...points[0] },
          centerWorld: latLngToWorld(this.center.lat, this.center.lng, this.zoom)
        };
      } else if (points.length >= 2) {
        const mid = midpoint(points[0], points[1]);
        const localMid = this._localPoint(mid.x, mid.y);
        const centerWorld = latLngToWorld(this.center.lat, this.center.lng, this.zoom);
        const focusWorld = {
          x: centerWorld.x + localMid.x - this.viewport.clientWidth / 2,
          y: centerWorld.y + localMid.y - this.viewport.clientHeight / 2
        };
        this.pinchState = {
          distance: distance(points[0], points[1]),
          zoom: this.zoom,
          focus: worldToLatLng(focusWorld.x, focusWorld.y, this.zoom)
        };
      }
    }

    _wheel(event) {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      this._zoomAt(event.clientX, event.clientY, this.zoom + direction);
    }

    _zoomAt(clientX, clientY, nextZoom) {
      const zoom = clamp(Math.round(nextZoom), this.options.minZoom, this.options.maxZoom);
      if (zoom === this.zoom) return;
      const local = this._localPoint(clientX, clientY);
      const oldCenterWorld = latLngToWorld(this.center.lat, this.center.lng, this.zoom);
      const focusWorld = {
        x: oldCenterWorld.x + local.x - this.viewport.clientWidth / 2,
        y: oldCenterWorld.y + local.y - this.viewport.clientHeight / 2
      };
      const focus = worldToLatLng(focusWorld.x, focusWorld.y, this.zoom);
      const newFocusWorld = latLngToWorld(focus.lat, focus.lng, zoom);
      const newCenterWorld = {
        x: newFocusWorld.x - (local.x - this.viewport.clientWidth / 2),
        y: newFocusWorld.y - (local.y - this.viewport.clientHeight / 2)
      };
      this.zoom = zoom;
      this.center = worldToLatLng(newCenterWorld.x, newCenterWorld.y, zoom);
      this.closePopup();
      this.scheduleRender();
    }

    destroy() {
      this.destroyed = true;
      if (this.renderFrame) global.cancelAnimationFrame(this.renderFrame);
      this.resizeObserver?.disconnect?.();
      if (this.onWindowResize) global.removeEventListener('resize', this.onWindowResize);
      this.viewport?.removeEventListener('pointerdown', this.onPointerDown);
      this.viewport?.removeEventListener('pointermove', this.onPointerMove);
      this.viewport?.removeEventListener('pointerup', this.onPointerUp);
      this.viewport?.removeEventListener('pointercancel', this.onPointerUp);
      this.viewport?.removeEventListener('wheel', this.onWheel);
      this.viewport?.removeEventListener('dblclick', this.onDoubleClick);
      this.viewport?.removeEventListener('keydown', this.onKeyDown);
      this.viewport?.removeEventListener('click', this.onControlClick);
      this.markerPane?.removeEventListener('click', this.onMarkerClick);
      this.container.innerHTML = '';
    }
  }

  global.RaceSlippyMap = RaceSlippyMap;
})(window);
