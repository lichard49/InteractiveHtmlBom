/* PCB rendering code */

var emptyContext2d = document.createElement("canvas").getContext("2d");


// ---- BoardViz Globals ---- //

// Hold transform and canvas elements for manipulating layout, schematic, and board
var allcanvas, schematicCanvas, boardCanvas;

// Highlight colors
const HIGHLIGHT_STROKE = "rgb(208, 64, 64)";
const HIGHLIGHT_FILL = "rgba(208, 64, 64, 0.25)";
const CROSSHAIR_FILL = "rgba(208, 64, 64, 0.5)";

// More highlight consts
const HL_CIRCLE_RADIUS = 20;

// Attempted linear conversion from layout to board img
// TODO use two matrices instead (different horizontal and vertical scale needed)
const LAYOUT_CORNER = {x: 51, y: 107};
const BOARD_CORNER = {x: 67, y: 28};
const LB_SCALE = 5.94;

// -------------------------- //

function deg2rad(deg) {
  return deg * Math.PI / 180;
}

function calcFontPoint(linepoint, text, offsetx, offsety, tilt) {
  var point = [
    linepoint[0] * text.width + offsetx,
    linepoint[1] * text.height + offsety
  ];
  // This approximates pcbnew behavior with how text tilts depending on horizontal justification
  point[0] -= (linepoint[1] + 0.5 * (1 + text.horiz_justify)) * text.height * tilt;
  return point;
}

function drawtext(ctx, text, color, flip) {
  if ("ref" in text && !settings.renderReferences) return;
  if ("val" in text && !settings.renderValues) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = text.thickness;
  if (text.svgpath) {
    ctx.stroke(new Path2D(text.svgpath));
    ctx.restore();
    return;
  }
  ctx.translate(...text.pos);
  ctx.translate(text.thickness * 0.5, 0);
  var angle = -text.angle;
  if (text.attr.includes("mirrored")) {
    ctx.scale(-1, 1);
    angle = -angle;
  }
  var tilt = 0;
  if (text.attr.includes("italic")) {
    tilt = 0.125;
  }
  var interline = (text.height * 1.5 + text.thickness) / 2;
  var txt = text.text.split("\n");
  // KiCad ignores last empty line.
  if (txt[txt.length - 1] == '') txt.pop();
  ctx.rotate(deg2rad(angle));
  for (var i in txt) {
    var offsety = (-(txt.length - 1) + i * 2) * interline + text.height / 2;
    var lineWidth = text.thickness + interline * tilt;
    for (var j = 0; j < txt[i].length; j++) {
      if (txt[i][j] == '\t') {
        var fourSpaces = 4 * pcbdata.font_data[' '].w * text.width;
        lineWidth += fourSpaces - lineWidth % fourSpaces;
      } else {
        if (txt[i][j] == '~') {
          j++;
          if (j == txt[i].length)
            break;
        }
        lineWidth += pcbdata.font_data[txt[i][j]].w * text.width;
      }
    }
    var offsetx = 0;
    switch (text.horiz_justify) {
      case -1:
        // Justify left, do nothing
        break;
      case 0:
        // Justify center
        offsetx -= lineWidth / 2;
        break;
      case 1:
        // Justify right
        offsetx -= lineWidth;
        break;
    }
    var inOverbar = false;
    for (var j = 0; j < txt[i].length; j++) {
      if (txt[i][j] == '\t') {
        var fourSpaces = 4 * pcbdata.font_data[' '].w * text.width;
        offsetx += fourSpaces - offsetx % fourSpaces;
        continue;
      } else if (txt[i][j] == '~') {
        j++;
        if (j == txt[i].length)
          break;
        if (txt[i][j] != '~') {
          inOverbar = !inOverbar;
        }
      }
      var glyph = pcbdata.font_data[txt[i][j]];
      if (inOverbar) {
        var overbarStart = [offsetx, -text.height * 1.4 + offsety];
        var overbarEnd = [offsetx + text.width * glyph.w, overbarStart[1]];

        if (!lastHadOverbar) {
          overbarStart[0] += text.height * 1.4 * tilt;
          lastHadOverbar = true;
        }
        ctx.beginPath();
        ctx.moveTo(...overbarStart);
        ctx.lineTo(...overbarEnd);
        ctx.stroke();
      } else {
        lastHadOverbar = false;
      }
      for (var line of glyph.l) {
        ctx.beginPath();
        ctx.moveTo(...calcFontPoint(line[0], text, offsetx, offsety, tilt));
        for (var k = 1; k < line.length; k++) {
          ctx.lineTo(...calcFontPoint(line[k], text, offsetx, offsety, tilt));
        }
        ctx.stroke();
      }
      offsetx += glyph.w * text.width;
    }
  }
  ctx.restore();
}

function drawedge(ctx, scalefactor, edge, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1 / scalefactor, edge.width);
  ctx.lineCap = "round";
  if (edge.svgpath) {
    ctx.stroke(new Path2D(edge.svgpath));
  } else {
    ctx.beginPath();
    if (edge.type == "segment") {
      ctx.moveTo(...edge.start);
      ctx.lineTo(...edge.end);
    }
    if (edge.type == "arc") {
      ctx.arc(
        ...edge.start,
        edge.radius,
        deg2rad(edge.startangle),
        deg2rad(edge.endangle));
    }
    if (edge.type == "circle") {
      ctx.arc(
        ...edge.start,
        edge.radius,
        0, 2 * Math.PI);
      ctx.closePath();
    }
    if (edge.type == "curve") {
      ctx.moveTo(...edge.start);
      ctx.bezierCurveTo(...edge.cpa, ...edge.cpb, ...edge.end);
    }
    ctx.stroke();
  }
}

function getChamferedRectPath(size, radius, chamfpos, chamfratio) {
  // chamfpos is a bitmask, left = 1, right = 2, bottom left = 4, bottom right = 8
  var path = new Path2D();
  var width = size[0];
  var height = size[1];
  var x = width * -0.5;
  var y = height * -0.5;
  var chamfOffset = Math.min(width, height) * chamfratio;
  path.moveTo(x, 0);
  if (chamfpos & 4) {
    path.lineTo(x, y + height - chamfOffset);
    path.lineTo(x + chamfOffset, y + height);
    path.lineTo(0, y + height);
  } else {
    path.arcTo(x, y + height, x + width, y + height, radius);
  }
  if (chamfpos & 8) {
    path.lineTo(x + width - chamfOffset, y + height);
    path.lineTo(x + width, y + height - chamfOffset);
    path.lineTo(x + width, 0);
  } else {
    path.arcTo(x + width, y + height, x + width, y, radius);
  }
  if (chamfpos & 2) {
    path.lineTo(x + width, y + chamfOffset);
    path.lineTo(x + width - chamfOffset, y);
    path.lineTo(0, y);
  } else {
    path.arcTo(x + width, y, x, y, radius);
  }
  if (chamfpos & 1) {
    path.lineTo(x + chamfOffset, y);
    path.lineTo(x, y + chamfOffset);
    path.lineTo(x, 0);
  } else {
    path.arcTo(x, y, x, y + height, radius);
  }
  path.closePath();
  return path;
}

function getOblongPath(size) {
  return getChamferedRectPath(size, Math.min(size[0], size[1]) / 2, 0, 0);
}

function getPolygonsPath(shape) {
  if (shape.path2d) {
    return shape.path2d;
  }
  if (shape.svgpath) {
    shape.path2d = new Path2D(shape.svgpath);
  } else {
    var path = new Path2D();
    for (var polygon of shape.polygons) {
      path.moveTo(...polygon[0]);
      for (var i = 1; i < polygon.length; i++) {
        path.lineTo(...polygon[i]);
      }
      path.closePath();
    }
    shape.path2d = path;
  }
  return shape.path2d;
}

function drawPolygonShape(ctx, shape, color) {
  ctx.save();
  ctx.fillStyle = color;
  if (!shape.svgpath) {
    ctx.translate(...shape.pos);
    ctx.rotate(deg2rad(-shape.angle));
  }
  ctx.fill(getPolygonsPath(shape));
  ctx.restore();
}

function drawDrawing(ctx, layer, scalefactor, drawing, color) {
  if (["segment", "arc", "circle", "curve"].includes(drawing.type)) {
    drawedge(ctx, scalefactor, drawing, color);
  } else if (drawing.type == "polygon") {
    drawPolygonShape(ctx, drawing, color);
  } else {
    drawtext(ctx, drawing, color, layer == "B");
  }
}

function getCirclePath(radius) {
  var path = new Path2D();
  path.arc(0, 0, radius, 0, 2 * Math.PI);
  path.closePath();
  return path;
}

function getCachedPadPath(pad) {
  if (!pad.path2d) {
    // if path2d is not set, build one and cache it on pad object
    if (pad.shape == "rect") {
      pad.path2d = new Path2D();
      pad.path2d.rect(...pad.size.map(c => -c * 0.5), ...pad.size);
    } else if (pad.shape == "oval") {
      pad.path2d = getOblongPath(pad.size);
    } else if (pad.shape == "circle") {
      pad.path2d = getCirclePath(pad.size[0] / 2);
    } else if (pad.shape == "roundrect") {
      pad.path2d = getChamferedRectPath(pad.size, pad.radius, 0, 0);
    } else if (pad.shape == "chamfrect") {
      pad.path2d = getChamferedRectPath(pad.size, pad.radius, pad.chamfpos, pad.chamfratio)
    } else if (pad.shape == "custom") {
      pad.path2d = getPolygonsPath(pad);
    }
  }
  return pad.path2d;
}

function drawPad(ctx, pad, color, outline, hole) {
  ctx.save();
  ctx.translate(...pad.pos);
  ctx.rotate(deg2rad(pad.angle));
  if (pad.offset) {
    ctx.translate(...pad.offset);
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  var path = getCachedPadPath(pad);
  if (outline) {
    ctx.stroke(path);
  } else {
    ctx.fill(path);
  }
  if (pad.type == "th" && hole) {
    if (pad.offset) {
      ctx.translate(-pad.offset[0], -pad.offset[1]);
    }
    ctx.fillStyle = "#CCCCCC";
    if (pad.drillshape == "oblong") {
      ctx.fill(getOblongPath(pad.drillsize));
    } else {
      ctx.fill(getCirclePath(pad.drillsize[0] / 2));
    }
  }
  ctx.restore();
}

function drawModule(ctx, layer, scalefactor, module, padcolor, outlinecolor, highlight, outline) {
  if (highlight) {
    // draw bounding box
    if (module.layer == layer || layer == "D") {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.translate(...module.bbox.pos);
      ctx.rotate(deg2rad(-module.bbox.angle));
      ctx.translate(...module.bbox.relpos);
      ctx.fillStyle = padcolor;
      ctx.fillRect(0, 0, ...module.bbox.size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = padcolor;
      ctx.strokeRect(0, 0, ...module.bbox.size);
      ctx.restore();
    }
  }
  // draw drawings
  for (var drawing of module.drawings) {
    if (drawing.layer == layer) {
      drawDrawing(ctx, layer, scalefactor, drawing.drawing, padcolor);
    }
  }
  // draw pads
  if (settings.renderPads) {
    for (var pad of module.pads) {
      if (pad.layers.includes(layer)) {
        drawPad(ctx, pad, padcolor, outline, true);
        if (pad.pin1 && settings.highlightpin1) {
          drawPad(ctx, pad, outlinecolor, true, false);
        }
      }
    }
  }
}

function drawEdgeCuts(canvas, scalefactor) {
  var ctx = canvas.getContext("2d");
  var edgecolor = getComputedStyle(topmostdiv).getPropertyValue('--pcb-edge-color');
  for (var edge of pcbdata.edges) {
    drawedge(ctx, scalefactor, edge, edgecolor);
  }
}

function drawModules(canvas, layer, scalefactor, highlight) {
  var ctx = canvas.getContext("2d");
  ctx.lineWidth = 3 / scalefactor;
  var style = getComputedStyle(topmostdiv);
  var padcolor = style.getPropertyValue('--pad-color');
  var outlinecolor = style.getPropertyValue('--pin1-outline-color');
  if (highlight) {
    padcolor = style.getPropertyValue('--pad-color-highlight');
    outlinecolor = style.getPropertyValue('--pin1-outline-color-highlight');
  }
  for (var i = 0; i < pcbdata.modules.length; i++) {
    var mod = pcbdata.modules[i];
    var outline = settings.renderDnpOutline && pcbdata.bom.skipped.includes(i);
    if (!highlight || highlightedModules.includes(i)) {
      drawModule(ctx, layer, scalefactor, mod, padcolor, outlinecolor, highlight, outline);
    }
  }
}

function drawBgLayer(layername, canvas, layer, scalefactor, edgeColor, polygonColor, textColor) {
  var ctx = canvas.getContext("2d");
  for (var d of pcbdata[layername][layer]) {
    if (["segment", "arc", "circle", "curve"].includes(d.type)) {
      drawedge(ctx, scalefactor, d, edgeColor);
    } else if (d.type == "polygon") {
      drawPolygonShape(ctx, d, polygonColor);
    } else {
      drawtext(ctx, d, textColor, layer == "B");
    }
  }
}

function drawTracks(canvas, layer, color, highlight) {
  ctx = canvas.getContext("2d");
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for(var track of pcbdata.tracks[layer]) {
    if (highlight && highlightedNet != track.net) continue;
    ctx.lineWidth = track.width;
    ctx.beginPath();
    ctx.moveTo(...track.start);
    ctx.lineTo(...track.end);
    ctx.stroke();
  }
}

function drawZones(canvas, layer, color, highlight) {
  ctx = canvas.getContext("2d");
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineJoin = "round";
  for(var zone of pcbdata.zones[layer]) {
    if (!zone.path2d) {
      zone.path2d = getPolygonsPath(zone);
    }
    if (highlight && highlightedNet != zone.net) continue;
    ctx.lineWidth = zone.width ? zone.width : 0;
    ctx.fill(zone.path2d);
    ctx.stroke(zone.path2d);
  }
}

function clearCanvas(canvas, color = null) {
  var ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

function drawNets(canvas, layer, highlight) {
  var style = getComputedStyle(topmostdiv);
  if (settings.renderTracks) {
    var trackColor = style.getPropertyValue(highlight ? '--track-color-highlight' : '--track-color');
    drawTracks(canvas, layer, trackColor, highlight);
  }
  if (settings.renderZones) {
    var zoneColor = style.getPropertyValue(highlight ? '--zone-color-highlight' : '--zone-color');
    drawZones(canvas, layer, zoneColor, highlight);
  }
  if (highlight && settings.renderPads) {
    var padColor = style.getPropertyValue('--pad-color-highlight');
    var ctx = canvas.getContext("2d");
    for (var mod of pcbdata.modules) {
      // draw pads
      for (var pad of mod.pads) {
        if (highlightedNet != pad.net) continue;
        if (pad.layers.includes(layer)) {
          drawPad(ctx, pad, padColor, false, true);
        }
      }
    }
  }
}

function drawHighlightsOnLayer(canvasdict, clear = true) {
  if (clear) {
    clearCanvas(canvasdict.highlight);
  }
  if (highlightedModules.length > 0) {
    drawModules(canvasdict.highlight, canvasdict.layer,
      canvasdict.transform.s * canvasdict.transform.zoom, true);
  }
  if (highlightedNet !== null) {
    drawNets(canvasdict.highlight, canvasdict.layer, true);
  }
}

function drawHighlights() {
  drawHighlightsOnLayer(allcanvas.front);
  drawHighlightsOnLayer(allcanvas.back);
}

function drawBackground(canvasdict, clear = true) {
  if (clear) {
    clearCanvas(canvasdict.bg);
    clearCanvas(canvasdict.fab);
    clearCanvas(canvasdict.silk);
  }

  drawNets(canvasdict.bg, canvasdict.layer, false);
  drawModules(canvasdict.bg, canvasdict.layer,
    canvasdict.transform.s * canvasdict.transform.zoom, false);

  drawEdgeCuts(canvasdict.bg, canvasdict.transform.s);

  var style = getComputedStyle(topmostdiv);
  var edgeColor = style.getPropertyValue('--silkscreen-edge-color');
  var polygonColor = style.getPropertyValue('--silkscreen-polygon-color');
  var textColor = style.getPropertyValue('--silkscreen-text-color');
  if (settings.renderSilkscreen) {
    drawBgLayer(
      "silkscreen", canvasdict.silk, canvasdict.layer,
      canvasdict.transform.s * canvasdict.transform.zoom,
      edgeColor, polygonColor, textColor);
  }
  edgeColor = style.getPropertyValue('--fabrication-edge-color');
  polygonColor = style.getPropertyValue('--fabrication-polygon-color');
  textColor = style.getPropertyValue('--fabrication-text-color');
  if (settings.renderFabrication) {
    drawBgLayer(
      "fabrication", canvasdict.fab, canvasdict.layer,
      canvasdict.transform.s * canvasdict.transform.zoom,
      edgeColor, polygonColor, textColor);
  }
}

function prepareCanvas(canvas, flip, transform) {
  var ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  var fontsize = 1.55;
  ctx.scale(transform.zoom, transform.zoom);
  ctx.translate(transform.panx, transform.pany);
  if (flip) {
    ctx.scale(-1, 1);
  }
  ctx.translate(transform.x, transform.y);
  ctx.rotate(deg2rad(settings.boardRotation));
  ctx.scale(transform.s, transform.s);
}

function prepareLayer(canvasdict) {
  var flip = (canvasdict.layer == "B");
  for (var c of ["bg", "fab", "silk", "highlight"]) {
    prepareCanvas(canvasdict[c], flip, canvasdict.transform);
  }
}

function rotateVector(v, angle) {
  angle = deg2rad(angle);
  return [
    v[0] * Math.cos(angle) - v[1] * Math.sin(angle),
    v[0] * Math.sin(angle) + v[1] * Math.cos(angle)
  ];
}

function applyRotation(bbox) {
  var corners = [
    [bbox.minx, bbox.miny],
    [bbox.minx, bbox.maxy],
    [bbox.maxx, bbox.miny],
    [bbox.maxx, bbox.maxy],
  ];
  corners = corners.map((v) => rotateVector(v, settings.boardRotation));
  return {
    minx: corners.reduce((a, v) => Math.min(a, v[0]), Infinity),
    miny: corners.reduce((a, v) => Math.min(a, v[1]), Infinity),
    maxx: corners.reduce((a, v) => Math.max(a, v[0]), -Infinity),
    maxy: corners.reduce((a, v) => Math.max(a, v[1]), -Infinity),
  }
}

function recalcLayerScale(layerdict, width, height) {
  var bbox = applyRotation(pcbdata.edges_bbox);
  var scalefactor = 0.98 * Math.min(
    width / (bbox.maxx - bbox.minx),
    height / (bbox.maxy - bbox.miny)
  );
  if (scalefactor < 0.1) {
    scalefactor = 1;
  }
  layerdict.transform.s = scalefactor;
  var flip = (layerdict.layer == "B");
  if (flip) {
    layerdict.transform.x = -((bbox.maxx + bbox.minx) * scalefactor + width) * 0.5;
  } else {
    layerdict.transform.x = -((bbox.maxx + bbox.minx) * scalefactor - width) * 0.5;
  }
  layerdict.transform.y = -((bbox.maxy + bbox.miny) * scalefactor - height) * 0.5;
  for (var c of ["bg", "fab", "silk", "highlight"]) {
    canvas = layerdict[c];
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = (width / devicePixelRatio) + "px";
    canvas.style.height = (height / devicePixelRatio) + "px";
  }
}

function redrawCanvas(layerdict) {
  if (layerdict.layer === "S" || layerdict.layer === "D") {
    // schematic or board
    drawCanvasImg(layerdict);
    drawSchematicHighlights();
    drawBoardHighlights();
  } else {
    // layout (original)
    prepareLayer(layerdict);
    drawBackground(layerdict);
    drawHighlightsOnLayer(layerdict);
  }
}

function resizeCanvas(layerdict) {
  var canvasdivid = {
    "F": "frontcanvas",
    "B": "backcanvas",
    "S": "schematic",     // not used
    "D": "mobile-canvas"  // not used
  } [layerdict.layer];
  var width = document.getElementById(canvasdivid).clientWidth * devicePixelRatio;
  var height = document.getElementById(canvasdivid).clientHeight * devicePixelRatio;
  recalcLayerScale(layerdict, width, height);
  redrawCanvas(layerdict);
}

function resizeAll() {
  resizeCanvas(allcanvas.front);
  resizeCanvas(allcanvas.back);
}

function pointWithinDistanceToSegment(x, y, x1, y1, x2, y2, d) {
  var A = x - x1;
  var B = y - y1;
  var C = x2 - x1;
  var D = y2 - y1;

  var dot = A * C + B * D;
  var len_sq = C * C + D * D;
  var dx, dy;
  if (len_sq == 0) {
    // start and end of the segment coincide
    dx = x - x1;
    dy = y - y1;
  } else {
    var param = dot / len_sq;
    var xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    dx = x - xx;
    dy = y - yy;
  }
  return dx * dx + dy * dy <= d * d;
}

function pointWithinPad(x, y, pad) {
  var v = [x - pad.pos[0], y - pad.pos[1]];
  v = rotateVector(v, -pad.angle);
  if (pad.offset) {
    v[0] -= pad.offset[0];
    v[1] -= pad.offset[1];
  }
  return emptyContext2d.isPointInPath(getCachedPadPath(pad), ...v);
}

function netHitScan(layer, x, y) {
  // Check track segments
  if (settings.renderTracks && pcbdata.tracks) {
    for(var track of pcbdata.tracks[layer]) {
      if (pointWithinDistanceToSegment(x, y, ...track.start, ...track.end, track.width / 2)) {
        return track.net;
      }
    }
  }
  // Check pads
  if (settings.renderPads) {
    for (var mod of pcbdata.modules) {
      for(var pad of mod.pads) {
        if (pad.layers.includes(layer) && pointWithinPad(x, y, pad)) {
          return pad.net;
        }
      }
    }
  }
  return null;
}

function pointWithinModuleBbox(x, y, bbox) {
  var v = [x - bbox.pos[0], y - bbox.pos[1]];
  v = rotateVector(v, bbox.angle);
  return bbox.relpos[0] <= v[0] && v[0] <= bbox.relpos[0] + bbox.size[0] &&
         bbox.relpos[1] <= v[1] && v[1] <= bbox.relpos[1] + bbox.size[1];
}

function bboxHitScan(layer, x, y) {
  var result = [];
  for (var i = 0; i < pcbdata.modules.length; i++) {
    var module = pcbdata.modules[i];
    if (module.layer == layer) {
      if (pointWithinModuleBbox(x, y, module.bbox)) {
        result.push(i);
      }
    }
  }
  return result;
}

function handlePointerDown(e, layerdict) {
  if (e.button != 0) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  layerdict.pointerStates[e.pointerId] = {
    distanceTravelled: 0,
    lastX: e.offsetX,
    lastY: e.offsetY,
    downTime: Date.now(),
  };
}

// Gets mouse pos in canvas coords for schematic and board canvas
function getMousePos(layerdict, evt) {
  var canvas = layerdict.bg;
  var transform = layerdict.transform;
  var zoomFactor = 1 / transform.zoom;

  var rect = canvas.getBoundingClientRect();  // abs. size of element
  var scaleX = canvas.width  / rect.width  * zoomFactor;  // relationship bitmap vs. element for X
  var scaleY = canvas.height / rect.height * zoomFactor;  // relationship bitmap vs. element for Y

  var x = (evt.clientX - rect.left) * scaleX - transform.panx;
  var y = (evt.clientY - rect.top)  * scaleY - transform.pany;

  // console.log(`canvas coords: (${x}, ${y})`);

  return {
    x: x,
    y: y
  };
}

function isClickInBoxes(coords, boxes) {
  for (var i in boxes) {
    var box = boxes[i];
    if (box[0] <= coords.x && coords.x <= box[2] && box[1] <= coords.y && coords.y <= box[3]) {
      return true;
    }
  }
  return false;
}

function handleMouseClick(e, layerdict) {
  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  if (layerdict.layer === "S" || layerdict.layer === "D") {
    // Use schematic click handler
    var coords = getMousePos(layerdict, e);
    console.log(`(${coords.x.toFixed(2)},${coords.y.toFixed(2)})`)
    for (var refId in schematicComponents) {
      if (isClickInBoxes(coords, schematicComponents[refId].boxes)) {
        moduleIndexToHandler[refId]();
      }
    }
    
  } else {
    // Use original code
    var x = e.offsetX;
    var y = e.offsetY;
    var t = layerdict.transform;
    if (layerdict.layer == "B") {
      x = (devicePixelRatio * x / t.zoom - t.panx + t.x) / -t.s;
    } else {
      x = (devicePixelRatio * x / t.zoom - t.panx - t.x) / t.s;
    }
    y = (devicePixelRatio * y / t.zoom - t.y - t.pany) / t.s;
    console.log(`(${x.toFixed(2)},${y.toFixed(2)})`)
    var v = rotateVector([x, y], -settings.boardRotation);
    if ("nets" in pcbdata) {
      var net = netHitScan(layerdict.layer, ...v);
      if (net !== highlightedNet) {
        netClicked(net);
      }
    }
    if (highlightedNet === null) {
      var modules = bboxHitScan(layerdict.layer, ...v);
      if (modules.length > 0) {
        modulesClicked(modules);
      }
    }
  }
}

function handlePointerLeave(e, layerdict) {
  e.preventDefault();
  e.stopPropagation();

  if (!settings.redrawOnDrag) {
    redrawCanvas(layerdict);
  }

  delete layerdict.pointerStates[e.pointerId];
}

function resetTransform(layerdict) {
  layerdict.transform.panx = 0;
  layerdict.transform.pany = 0;
  layerdict.transform.zoom = (layerdict.layer === "S" ? 2 : 1);
  redrawCanvas(layerdict);
}

function handlePointerUp(e, layerdict) {
  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  e.preventDefault();
  e.stopPropagation();

  if (e.button == 2) {
    // Reset pan and zoom on right click.
    resetTransform(layerdict);
    layerdict.anotherPointerTapped = false;
    return;
  }

  // We haven't necessarily had a pointermove event since the interaction started, so make sure we update this now
  var ptr = layerdict.pointerStates[e.pointerId];
  ptr.distanceTravelled += Math.abs(e.offsetX - ptr.lastX) + Math.abs(e.offsetY - ptr.lastY);

  if (e.button == 0 && ptr.distanceTravelled < 10 && Date.now() - ptr.downTime <= 500) {
    if (Object.keys(layerdict.pointerStates).length == 1) {
      if (layerdict.anotherPointerTapped) {
        // This is the second pointer coming off of a two-finger tap
        resetTransform(layerdict);
      } else {
        // This is just a regular tap
        handleMouseClick(e, layerdict);
      }
      layerdict.anotherPointerTapped = false;
    } else {
      // This is the first finger coming off of what could become a two-finger tap
      layerdict.anotherPointerTapped = true;
    }
  } else {
    if (!settings.redrawOnDrag) {
      redrawCanvas(layerdict);
    }
    layerdict.anotherPointerTapped = false;
  }

  delete layerdict.pointerStates[e.pointerId];
}

function handlePointerMove(e, layerdict) {
  if (!layerdict.pointerStates.hasOwnProperty(e.pointerId)) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  var thisPtr = layerdict.pointerStates[e.pointerId];

  var dx = e.offsetX - thisPtr.lastX;
  var dy = e.offsetY - thisPtr.lastY;

  // If this number is low on pointer up, we count the action as a click
  thisPtr.distanceTravelled += Math.abs(dx) + Math.abs(dy);

  if (Object.keys(layerdict.pointerStates).length == 1) {
    // This is a simple drag
    layerdict.transform.panx += devicePixelRatio * dx / layerdict.transform.zoom;
    layerdict.transform.pany += devicePixelRatio * dy / layerdict.transform.zoom;
  } else if (Object.keys(layerdict.pointerStates).length == 2) {
    var otherPtr = Object.values(layerdict.pointerStates).filter((ptr) => ptr != thisPtr)[0];

    var oldDist = Math.sqrt(Math.pow(thisPtr.lastX - otherPtr.lastX, 2) + Math.pow(thisPtr.lastY - otherPtr.lastY, 2));
    var newDist = Math.sqrt(Math.pow(e.offsetX - otherPtr.lastX, 2)     + Math.pow(e.offsetY - otherPtr.lastY, 2));

    var scaleFactor = newDist/oldDist;

    if (scaleFactor != NaN) {
      layerdict.transform.zoom *= scaleFactor;

      var zoomd = (1 - scaleFactor) / layerdict.transform.zoom;
      layerdict.transform.panx += devicePixelRatio * otherPtr.lastX * zoomd;
      layerdict.transform.pany += devicePixelRatio * otherPtr.lastY * zoomd;
    }
  }

  thisPtr.lastX = e.offsetX;
  thisPtr.lastY = e.offsetY;

  if (settings.redrawOnDrag) {
    redrawCanvas(layerdict);
  }
}

function handleMouseWheel(e, layerdict) {
  e.preventDefault();
  e.stopPropagation();
  var t = layerdict.transform;
  var wheeldelta = e.deltaY;
  if (e.deltaMode == 1) {
    // FF only, scroll by lines
    wheeldelta *= 30;
  } else if (e.deltaMode == 2) {
    wheeldelta *= 300;
  }
  var m = Math.pow(1.1, -wheeldelta / 40);
  // Limit amount of zoom per tick.
  if (m > 2) {
    m = 2;
  } else if (m < 0.5) {
    m = 0.5;
  }
  t.zoom *= m;
  var zoomd = (1 - m) / t.zoom;
  // Zoom pans incorrectly for new canvases, TODO fix
  // console.log(`e.offset: (${e.offsetX},${e.offsetY})`);
  var x, y;
  x = e.offsetX;
  y = e.offsetY;
  t.panx += devicePixelRatio * x * zoomd;
  t.pany += devicePixelRatio * y * zoomd;
  redrawCanvas(layerdict);
}

function addMouseHandlers(div, layerdict) {
  div.addEventListener("pointerdown", function(e) {
    handlePointerDown(e, layerdict);
  });
  div.addEventListener("pointermove", function(e) {
    handlePointerMove(e, layerdict);
  });
  div.addEventListener("pointerup", function(e) {
    handlePointerUp(e, layerdict);
  });
  var pointerleave = function(e) {
    handlePointerLeave(e, layerdict);
  }
  div.addEventListener("pointercancel", pointerleave);
  div.addEventListener("pointerleave", pointerleave);
  div.addEventListener("pointerout", pointerleave);

  div.onwheel = function(e) {
    handleMouseWheel(e, layerdict);
  }
  for (var element of [div, layerdict.bg, layerdict.fab, layerdict.silk, layerdict.highlight]) {
    if (element) {
      element.addEventListener("contextmenu", function(e) {
        e.preventDefault();
      }, false);
    }
  }
}

function setRedrawOnDrag(value) {
  settings.redrawOnDrag = value;
  writeStorage("redrawOnDrag", value);
}

function setBoardRotation(value) {
  settings.boardRotation = value * 5;
  writeStorage("boardRotation", settings.boardRotation);
  document.getElementById("rotationDegree").textContent = settings.boardRotation;
  resizeAll();
}

function initRender() {
  allcanvas = {
    front: {
      transform: {
        x: 0,
        y: 0,
        s: 1,
        panx: 0,
        pany: 0,
        zoom: 1,
      },
      pointerStates: {},
      anotherPointerTapped: false,
      bg: document.getElementById("F_bg"),
      fab: document.getElementById("F_fab"),
      silk: document.getElementById("F_slk"),
      highlight: document.getElementById("F_hl"),
      layer: "F",
    },
    back: {
      transform: {
        x: 0,
        y: 0,
        s: 1,
        panx: 0,
        pany: 0,
        zoom: 1,
      },
      pointerStates: {},
      anotherPointerTapped: false,
      bg: document.getElementById("B_bg"),
      fab: document.getElementById("B_fab"),
      silk: document.getElementById("B_slk"),
      highlight: document.getElementById("B_hl"),
      layer: "B",
    }
  };

  // Holds svg of schematic and its highlights
  schematicCanvas = {
    transform: {
      x: 0,
      y: 0,
      s: 1,
      panx: 0,
      pany: 0,
      zoom: 2, // Start zoomed in for better aesthetics
    },
    pointerStates: {},
    anotherPointerTapped: false,
    layer: "S",
    bg: document.getElementById("schematic-bg"),
    highlight: document.getElementById("schematic-highlight"),
    img: new Image()
  }

  // Holds jpg of board and its highlights
  boardCanvas = {
    transform: {
      x: 0, 
      y: 0,
      s: 1,
      panx: 0,
      pany: 0,
      zoom: 2
    },
    pointerStates: {},
    anotherPointerTapped: false,
    layer: "D",
    bg: document.getElementById("board-bg"),
    highlight: document.getElementById("board-hl"),
    img: new Image()
  }

  addMouseHandlers(document.getElementById("frontcanvas"), allcanvas.front);
  addMouseHandlers(document.getElementById("backcanvas"), allcanvas.back);

  initSchematicCanvas();
  initBoardCanvas();
}

function initCanvas(wrapper, layerdict) {
  addMouseHandlers(wrapper, layerdict);

  var bg = layerdict.bg;
  var hl = layerdict.highlight;

  var ratio = window.devicePixelRatio || 1;

  // Increase the canvas dimensions by the pixel ratio (display size controlled by CSS)
  bg.width  *= ratio;
  bg.height *= ratio;
  hl.width  *= ratio;
  hl.height *= ratio;

  layerdict.img.onload = () => {
    drawCanvasImg(layerdict);
  };
}

function initSchematicCanvas() {
  addMouseHandlers(document.getElementById("schematic"), schematicCanvas);

  var bg = schematicCanvas.bg;
  var hl = schematicCanvas.highlight;

  var ratio = window.devicePixelRatio || 1;

  // Increase the canvas dimensions by the pixel ratio (display size controlled by CSS)
  bg.width  *= ratio;
  bg.height *= ratio;
  hl.width  *= ratio;
  hl.height *= ratio;

  schematicCanvas.img.onload = function() {
    drawCanvasImg(schematicCanvas);
  };
  schematicCanvas.img.src = "///BOMFILEDIR////sch-01.svg";
}

function drawSchematicHighlights() {
  var canvas = schematicCanvas.highlight;
  prepareCanvas(canvas, false, schematicCanvas.transform);
  clearCanvas(canvas);
  var ctx = canvas.getContext("2d");
  if (highlightedModules.length > 0) {
    for (var i in highlightedModules) {
      var boxes = schematicComponents[highlightedModules[i]].boxes;
      for (var j in boxes) {
        var box = boxes[j];
        ctx.beginPath();
        ctx.rect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        ctx.fillStyle = HIGHLIGHT_FILL;
        ctx.strokeStyle = HIGHLIGHT_STROKE;
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

function initBoardCanvas() {
  addMouseHandlers(document.getElementById("mobile-canvas"), boardCanvas);

  var bg = boardCanvas.bg;
  var hl = boardCanvas.highlight;

  var ratio = window.devicePixelRatio || 1;

  // Increase the canvas dimensions by the pixel ratio (display size controlled by CSS)
  // TODO maybe cancel this part
  bg.width  *= ratio;
  bg.height *= ratio;
  hl.width  *= ratio;
  hl.height *= ratio;

  boardCanvas.img.onload = function() {
    drawCanvasImg(boardCanvas);
  };
  boardCanvas.img.src = "///BOMFILEDIR////arduinouno.jpg";
}

function drawBoardHighlights() {
  var canvas = boardCanvas.highlight;
  prepareCanvas(canvas, false, boardCanvas.transform);
  clearCanvas(canvas);
  var ctx = canvas.getContext("2d");
  if (highlightedModules.length > 0) {
    for (var i in highlightedModules) {
      var box = schematicComponents[highlightedModules[i]].boardBox;
      switch (boardHighlightMode) {
        case 1:
          // Just highlight the bounding box
          drawBoardHighlight(box, ctx, "box");
          break;
        case 2:
          drawBoardHighlight(box, ctx, "box");
          drawBoardHighlight(box, ctx, "circle");
          break;
        case 3:
          drawBoardHighlight(box, ctx, "box");
          drawBoardHighlight(box, ctx, "crosshair");
          break;
        case 4:
          console.log("NOT YET IMPLEMENTED");
          drawBoardHighlight(box, ctx, "box");
      }
    }
  }
}

function drawBoardHighlight(box, ctx, type) {
  switch(type) {
    case "box":
      ctx.beginPath();
      ctx.rect(box[0], box[1], box[2]-box[0], box[3]-box[1]);
      ctx.fillStyle = HIGHLIGHT_FILL;
      ctx.strokeStyle = HIGHLIGHT_STROKE;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      break;
    case "circle":
      var center = {x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2};
      ctx.beginPath();
      ctx.arc(center.x, center.y, HL_CIRCLE_RADIUS, 0, 2 * Math.PI);
      ctx.lineWidth = 2;
      ctx.strokeStyle = HIGHLIGHT_STROKE;
      ctx.stroke();
      break;
    case "crosshair":
      // Divided by two because the canvas is currently twice as wide as the board img
      // TODO figure out how that should be displayed
      var width = boardCanvas.highlight.width / 2;
      var height = boardCanvas.highlight.height / 2;
      var boxW = box[2] - box[0];
      var boxH = box[3] - box[1];

      ctx.fillStyle = HIGHLIGHT_FILL;

      ctx.fillRect(box[0], 0, boxW, box[1]);
      ctx.fillRect(0, box[1], box[0], boxH);
      ctx.fillRect(box[0], box[3], boxW, height - box[3]);
      ctx.fillRect(box[2], box[1], width - box[2], boxH);

      break;
  }
}

function layoutToBoardCoords(x, y, scale = LB_SCALE) {
  var xb = (x - LAYOUT_CORNER.x) * scale + BOARD_CORNER.x;
  var yb = (y - LAYOUT_CORNER.y) * scale + BOARD_CORNER.y;
  return {x: xb, y: yb};
}

function drawCanvasImg(layerdict) {
  var canvas = layerdict.bg;
  prepareCanvas(canvas, false, layerdict.transform);
  clearCanvas(canvas);
  canvas.getContext("2d").drawImage(layerdict.img, 0, 0);
}
