(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TTOBOK_GEOMETRY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Coordinates and this numerical tolerance are in mm, independent of zoom.
  const EPS = 1e-7;
  const finite = Number.isFinite;
  const samePoint = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  function validRectangle(a) {
    return !!a && [a.x, a.y, a.w, a.h, a.x + a.w, a.y + a.h].every(finite) && a.w > 0 && a.h > 0;
  }

  function onSegment(x, y, a, b) {
    const tolerance = EPS * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
    return Math.abs(cross(a, b, [x, y])) <= tolerance &&
      x >= Math.min(a[0], b[0]) - EPS && x <= Math.max(a[0], b[0]) + EPS &&
      y >= Math.min(a[1], b[1]) - EPS && y <= Math.max(a[1], b[1]) + EPS;
  }

  function orientation(a, b, c) {
    const n = cross(a, b, c);
    const tolerance = EPS * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
    return n > tolerance ? 1 : n < -tolerance ? -1 : 0;
  }

  function segmentsIntersect(a, b, c, d) {
    const abC = orientation(a, b, c), abD = orientation(a, b, d);
    const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
    if (abC * abD < 0 && cdA * cdB < 0) return true;
    return (!abC && onSegment(c[0], c[1], a, b)) || (!abD && onSegment(d[0], d[1], a, b)) ||
      (!cdA && onSegment(a[0], a[1], c, d)) || (!cdB && onSegment(b[0], b[1], c, d));
  }

  function polygonRing(points) {
    if (!Array.isArray(points) || points.length < 3 || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(finite))) return null;
    // Zero-width recesses and coincident step widths can generate repeated
    // adjacent vertices; they describe the same boundary and are harmless.
    const p = points.filter((v, i) => i === 0 || !samePoint(v, points[i - 1]));
    if (p.length > 1 && samePoint(p[0], p[p.length - 1])) p.pop();
    if (p.length < 3) return null;
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
      if (samePoint(a, b)) return null;
      // Reject an adjacent edge that doubles back over its predecessor.
      if (!orientation(a, b, c) && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > EPS * EPS) return null;
      area += cross(p[0], a, b);
      for (let j = i + 2; j < p.length; j++) {
        if (i === 0 && j === p.length - 1) continue;
        if (segmentsIntersect(a, b, p[j], p[(j + 1) % p.length])) return null;
      }
    }
    return finite(area) && Math.abs(area) > EPS * EPS ? p : null;
  }

  function validatePolygon(points) { return !!polygonRing(points); }

  function pointInRing(x, y, p) {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j], b = p[i];
      if (onSegment(x, y, a, b)) return true;
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(x, y, points) {
    const p = polygonRing(points);
    return finite(x) && finite(y) && !!p && pointInRing(x, y, p);
  }

  // Clip a wall segment to the open rectangle. A boundary touching the item
  // is allowed; any wall passing through its interior proves a crossing.
  function segmentEntersRectangle(a, b, r) {
    let lo = 0, hi = 1;
    const bounds = [[r.x + EPS, r.x + r.w - EPS], [r.y + EPS, r.y + r.h - EPS]];
    for (let axis = 0; axis < 2; axis++) {
      const min = bounds[axis][0], max = bounds[axis][1], delta = b[axis] - a[axis];
      if (min >= max) return false;
      if (Math.abs(delta) <= EPS) {
        if (a[axis] < min || a[axis] > max) return false;
      } else {
        let first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
        if (first > last) [first, last] = [last, first];
        lo = Math.max(lo, first); hi = Math.min(hi, last);
        if (lo > hi) return false;
      }
    }
    return lo <= hi;
  }

  function rectangleInsideRing(a, p) {
    if (!validRectangle(a)) return false;
    const right = a.x + a.w, bottom = a.y + a.h;
    if (![[a.x, a.y], [right, a.y], [right, bottom], [a.x, bottom], [a.x + a.w / 2, a.y + a.h / 2]].every(q => pointInRing(q[0], q[1], p))) return false;
    return !p.some((v, i) => segmentEntersRectangle(v, p[(i + 1) % p.length], a));
  }

  function rectangleInsidePolygon(a, points) {
    const p = polygonRing(points);
    return !!p && rectangleInsideRing(a, p);
  }

  // closed/open are absolute leaf endpoints. An SVG arc can use
  // M closed.x closed.y A r r 0 0 sweep open.x open.y at any display scale.
  function doorSector(g) {
    if (!g || !finite(g.dw) || g.dw <= 0) return null;
    const side = g.doorSide || 'top', p = g.dp ?? 0;
    const r = g.doorLeafW ?? g.dw, off = g.doorHingeOffset ?? 0;
    if (![p, r, off].every(finite) || p < 0 || off < 0 || r <= 0) return null;
    let cx, cy, sx, sy, closed, open;
    if (side === 'top' || side === 'bottom') {
      if (side === 'bottom' && (!finite(g.h) || g.h <= 0)) return null;
      const right = g.doorHinge === 'right';
      cx = p + (right ? g.dw - off : off); cy = side === 'top' ? 0 : g.h;
      sx = right ? -1 : 1; sy = side === 'top' ? 1 : -1;
      closed = {x: cx + sx * r, y: cy}; open = {x: cx, y: cy + sy * r};
    } else if (side === 'left' || side === 'right') {
      if (side === 'right' && (!finite(g.w) || g.w <= 0)) return null;
      const bottom = g.doorHinge === 'bottom';
      cx = side === 'left' ? 0 : g.w; cy = p + (bottom ? g.dw - off : off);
      sx = side === 'left' ? 1 : -1; sy = bottom ? -1 : 1;
      closed = {x: cx, y: cy + sy * r}; open = {x: cx + sx * r, y: cy};
    } else return null;
    if (![cx, cy, closed.x, closed.y, open.x, open.y].every(finite)) return null;
    const sweep = (closed.x - cx) * (open.y - cy) - (closed.y - cy) * (open.x - cx) > 0 ? 1 : 0;
    return {cx, cy, r, sx, sy, closed, open, sweep};
  }

  function rectangleIntersectsSector(a, s) {
    if (!validRectangle(a) || !s || ![s.cx, s.cy, s.r].every(finite) || s.r <= 0 || ![-1, 1].includes(s.sx) || ![-1, 1].includes(s.sy)) return false;
    const minX = s.sx === 1 ? a.x - s.cx : s.cx - a.x - a.w;
    const maxX = s.sx === 1 ? a.x + a.w - s.cx : s.cx - a.x;
    const minY = s.sy === 1 ? a.y - s.cy : s.cy - a.y - a.h;
    const maxY = s.sy === 1 ? a.y + a.h - s.cy : s.cy - a.y;
    const x = Math.max(0, minX), y = Math.max(0, minY);
    // Require positive area in the quadrant and circle, allowing tangency.
    return maxX - x > EPS && maxY - y > EPS && Math.hypot(x, y) < s.r - EPS;
  }

  function doorHit(a, g) { return rectangleIntersectsSector(a, doorSector(g)); }

  // Project the part of a wall spanning the OPEN extent of an item's side.
  // Ignoring a coincident endpoint permits sliding along a notch boundary.
  function wallProjection(a, b, axis, start, end) {
    const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    if (hi <= start + EPS || lo >= end - EPS) return null;
    const other = 1 - axis, delta = b[axis] - a[axis];
    if (Math.abs(delta) <= EPS) return [Math.min(a[other], b[other]), Math.max(a[other], b[other])];
    const t1 = (Math.max(start, lo) - a[axis]) / delta, t2 = (Math.min(end, hi) - a[axis]) / delta;
    const v1 = a[other] + t1 * (b[other] - a[other]), v2 = a[other] + t2 * (b[other] - a[other]);
    return [Math.min(v1, v2), Math.max(v1, v2)];
  }

  function wallClearances(a, g) {
    if (!g) return null;
    const points = g.poly ?? [[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]];
    const p = polygonRing(points);
    if (!p || !rectangleInsideRing(a, p)) return null;
    const result = {left: Infinity, right: Infinity, top: Infinity, bottom: Infinity};
    const right = a.x + a.w, bottom = a.y + a.h;
    p.forEach((v, i) => {
      const next = p[(i + 1) % p.length];
      const x = wallProjection(v, next, 1, a.y, bottom);
      if (x) {
        if (x[1] <= a.x + EPS) result.left = Math.min(result.left, Math.max(0, a.x - x[1]));
        if (x[0] >= right - EPS) result.right = Math.min(result.right, Math.max(0, x[0] - right));
      }
      const y = wallProjection(v, next, 0, a.x, right);
      if (y) {
        if (y[1] <= a.y + EPS) result.top = Math.min(result.top, Math.max(0, a.y - y[1]));
        if (y[0] >= bottom - EPS) result.bottom = Math.min(result.bottom, Math.max(0, y[0] - bottom));
      }
    });
    return Object.values(result).every(finite) ? result : null;
  }

  return Object.freeze({validatePolygon, pointInPolygon, rectangleInsidePolygon, doorSector, rectangleIntersectsSector, doorHit, wallClearances});
});
