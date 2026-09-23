// Moteur de calcul des surfaces, dont la triangulation pour les pièces sans
// angle droit (méthode SSS : trois longueurs de côtés d'un triangle -> aire
// via la formule de Héron). Utilisé par outils/calculateur-surface.html et
// par l'onglet Mesurage d'une mission.

export function triangleAreaSSS(a, b, c) {
  const sides = [a, b, c].map(Number);
  if (sides.some((s) => !isFinite(s) || s <= 0)) {
    return { valid: false, error: "Les trois longueurs doivent être des nombres positifs." };
  }
  const [x, y, z] = sides;
  const violates = x >= y + z || y >= x + z || z >= x + y;
  if (violates) {
    return { valid: false, error: "Ces trois longueurs ne forment pas un triangle valide (inégalité triangulaire non respectée). Revérifiez les mesures." };
  }
  const s = (x + y + z) / 2;
  const area = Math.sqrt(s * (s - x) * (s - y) * (s - z));
  return { valid: true, area };
}

export function rectangleArea(length, width) {
  const l = Number(length);
  const w = Number(width);
  if (!isFinite(l) || !isFinite(w) || l <= 0 || w <= 0) {
    return { valid: false, error: "Longueur et largeur doivent être des nombres positifs." };
  }
  return { valid: true, area: l * w };
}

export function sumAreas(entries) {
  return entries.reduce((total, e) => total + (e.valid ? e.area : 0), 0);
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------- Triangulation en éventail à partir d'une forme dessinée ----------
// Étant donné le nombre de coins d'une pièce (dans l'ordre où ils ont été
// touchés à l'écran), calcule :
//  - les segments "mur" : chaque paire de coins consécutifs (y compris le
//    dernier coin qui referme sur le premier) ;
//  - les segments "diagonale" : depuis le coin n°1 vers chaque coin non
//    adjacent, chacun mesuré UNE SEULE FOIS même s'il sert à deux triangles ;
//  - les triangles eux-mêmes, chacun défini par 3 segments déjà listés
//    ci-dessus (jamais un segment recalculé en double).
// Les coins sont numérotés à partir de 1 pour l'affichage.
export function deriveFanTriangulation(cornerCount) {
  const n = Number(cornerCount);
  if (!Number.isInteger(n) || n < 3) {
    return { valid: false, error: "Il faut au moins 3 coins pour former une pièce." };
  }
  const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const walls = [];
  for (let i = 1; i <= n; i++) {
    const j = i === n ? 1 : i + 1;
    walls.push([i, j]);
  }
  const diagonals = [];
  for (let k = 3; k <= n - 1; k++) diagonals.push([1, k]);
  const triangles = [];
  for (let k = 2; k <= n - 1; k++) triangles.push([1, k, k + 1]);
  return {
    valid: true,
    walls,
    diagonals,
    triangles,
    segmentKey: key,
  };
}

// `lengths` : Map ou objet { "i-j": longueurEnMètres } pour chaque segment
// renvoyé par deriveFanTriangulation (murs + diagonales). Renvoie le détail
// par triangle et la surface totale, via la même formule de Héron que
// triangleAreaSSS.
export function computeFanTriangulationArea(cornerCount, lengths) {
  const shape = deriveFanTriangulation(cornerCount);
  if (!shape.valid) return shape;
  const get = (a, b) => {
    const v = lengths instanceof Map ? lengths.get(shape.segmentKey(a, b)) : lengths[shape.segmentKey(a, b)];
    return v;
  };
  const results = shape.triangles.map(([a, b, c]) => {
    const sideAB = get(a, b);
    const sideBC = get(b, c);
    const sideCA = get(c, a);
    if (sideAB == null || sideBC == null || sideCA == null) {
      return { corners: [a, b, c], valid: false, error: "Mesures manquantes." };
    }
    const r = triangleAreaSSS(sideAB, sideBC, sideCA);
    return { corners: [a, b, c], ...r };
  });
  return { valid: true, triangles: results, total: sumAreas(results) };
}
