// Widget de dessin de pièce sur grille (papier quadrillé) : l'utilisateur
// touche les coins de la pièce dans l'ordre pour en définir la FORME
// (topologie) uniquement — le dessin lui-même n'est jamais utilisé comme
// mesure. Les longueurs réelles sont demandées séparément à l'étape suivante
// (voir triangulation-flow.js), ce qui évite d'avoir à ressaisir deux fois la
// même diagonale partagée entre deux triangles.

const GRID = 22; // taille d'une case de la grille, en pixels CSS

function snap(x, y) {
  return { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID };
}

export function mountRoomDrawer(canvas, { onChange } = {}) {
  const ctx = canvas.getContext("2d");
  let points = [];
  let closed = false;
  let cssW = 0, cssH = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function drawGrid() {
    ctx.strokeStyle = "#e4e8ec";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cssW; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, cssH); ctx.stroke();
    }
    for (let y = 0; y <= cssH; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(cssW, y + 0.5); ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);
    drawGrid();
    if (points.length) {
      ctx.strokeStyle = "#0f6e6a";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (closed) ctx.closePath();
      if (closed) { ctx.fillStyle = "rgba(15,110,106,0.08)"; ctx.fill(); }
      ctx.stroke();

      points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 && closed ? "#0f6e6a" : "#101826";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "700 13px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x, p.y + 1);
      });
    }
  }

  function emit() {
    onChange?.({ count: points.length, closed });
  }

  function addPoint(clientX, clientY) {
    if (closed) return;
    const rect = canvas.getBoundingClientRect();
    const p = snap(clientX - rect.left, clientY - rect.top);
    p.x = Math.max(GRID / 2, Math.min(cssW - GRID / 2, p.x));
    p.y = Math.max(GRID / 2, Math.min(cssH - GRID / 2, p.y));
    points.push(p);
    draw();
    emit();
  }

  function undo() {
    if (closed) return;
    points.pop();
    draw();
    emit();
  }

  function reset() {
    points = [];
    closed = false;
    draw();
    emit();
  }

  function close() {
    if (points.length < 3) return;
    closed = true;
    draw();
    emit();
  }

  // Place un polygone régulier à N coins, prêt à mesurer directement (on peut
  // aussi corriger sa forme avant de fermer, mais la position exacte
  // n'affecte jamais le résultat : seules les longueurs saisies ensuite
  // comptent).
  function loadTemplate(n) {
    const cx = cssW / 2, cy = cssH / 2;
    const r = Math.min(cssW, cssH) / 2 - GRID * 1.5;
    points = Array.from({ length: n }, (_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return snap(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    });
    closed = false;
    draw();
    emit();
  }

  function onPointerDown(e) {
    e.preventDefault();
    addPoint(e.clientX, e.clientY);
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", resize);
  resize();

  // Chaque nouveau dessin (bouton "Recommencer", retour à l'étape dessin...)
  // crée une nouvelle instance sur un nouveau <canvas> : sans destroy(), le
  // listener "resize" posé sur `window` ci-dessus restait accroché
  // indéfiniment à l'ancien canvas détaché du DOM — fuite mémoire cumulative
  // sur une mission où plusieurs pièces sont mesurées à la suite (même
  // défaut que celui corrigé dans photo-widget.js). Les appelants doivent
  // appeler destroy() avant d'abandonner une instance.
  function destroy() {
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointerdown", onPointerDown);
  }

  return {
    undo,
    reset,
    close,
    loadTemplate,
    getState: () => ({ count: points.length, closed, points: points.slice() }),
    redraw: draw,
    destroy,
  };
}
