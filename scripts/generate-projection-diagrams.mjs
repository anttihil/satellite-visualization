import { writeFileSync } from "node:fs";

// Documentation figures, independent of Deck.gl and live satellite data.
const radians = (degrees) => degrees * Math.PI / 180;
const n = (value) => value.toFixed(2);
const colors = { rectilinear: "#b45309", stereographic: "#0369a1" };
const radial = {
  rectilinear: (theta) => Math.tan(theta),
  stereographic: (theta) => 2 * Math.tan(theta / 2),
};
const text = (x, y, label, extra = "") =>
  `<text x="${n(x)}" y="${n(y)}" ${extra}>${label}</text>`;
const line = (x1, y1, x2, y2, extra = "") =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${extra}/>`;
const circle = (x, y, r, extra = "") =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" ${extra}/>`;
const path = (points, extra = "") =>
  `<path d="${points.map(([x, y], i) => `${i ? "L" : "M"}${n(x)},${n(y)}`).join(" ")}" fill="none" ${extra}/>`;

function svg(width, height, title, description, elements) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
<title id="title">${title}</title>
<desc id="description">${description}</desc>
<style>
text { font-family: system-ui, sans-serif; font-size: 14px; fill: #1e293b; }
.heading { font-size: 22px; font-weight: 700; }
.subheading { font-size: 16px; font-weight: 600; }
.note { font-size: 13px; fill: #475569; }
</style>
<rect width="100%" height="100%" fill="#f8fafc"/>
${elements.join("\n")}
</svg>
`;
}

function curves() {
  const elements = [
    text(30, 36, "How angles become screen distances", 'class="heading"'),
    text(30, 63, "Top: same center scale. Bottom: same 120° horizontal coverage.", 'class="note"'),
  ];
  const chart = { x: 85, y: 95, width: 610, height: 280 };
  const screen = (degrees, radius) => [
    chart.x + degrees / 80 * chart.width,
    chart.y + chart.height - radius / 6 * chart.height,
  ];
  for (let r = 0; r <= 6; r++) {
    const [x, y] = screen(0, r);
    elements.push(line(x, y, x + chart.width, y, 'stroke="#cbd5e1"'));
    elements.push(text(x - 15, y + 5, String(r), 'text-anchor="end"'));
  }
  for (let degrees = 0; degrees <= 80; degrees += 10) {
    const [x, y] = screen(degrees, 0);
    elements.push(line(x, chart.y, x, y, 'stroke="#e2e8f0"'));
    elements.push(text(x, y + 23, `${degrees}°`, 'text-anchor="middle"'));
  }
  elements.push(text(85, 86, "Radius / f", 'class="subheading"'));
  elements.push(text(390, 424, "Angle from view center (θ)", 'text-anchor="middle"'));
  for (const [name, mapping] of Object.entries(radial)) {
    const points = Array.from({ length: 161 }, (_, i) => screen(i / 2, mapping(radians(i / 2))));
    elements.push(path(points, `stroke="${colors[name]}" stroke-width="3"`));
  }
  elements.push(line(735, 125, 770, 125, `stroke="${colors.rectilinear}" stroke-width="3"`));
  elements.push(text(780, 130, "Rectilinear"));
  elements.push(text(735, 155, "r / f = tan(θ)", 'class="note"'));
  elements.push(line(735, 200, 770, 200, `stroke="${colors.stereographic}" stroke-width="3"`));
  elements.push(text(780, 205, "Stereographic"));
  elements.push(text(735, 230, "r / f = 2 tan(θ / 2)", 'class="note"'));
  elements.push(text(30, 473, "Equal-angle ruler: directions every 15°", 'class="subheading"'));
  for (const [index, name] of Object.keys(radial).entries()) {
    const y = 525 + index * 100;
    const mapping = radial[name];
    const x = (degrees) => 560 + 350 * mapping(radians(degrees)) / mapping(radians(60));
    elements.push(text(30, y + 5, name === "rectilinear" ? "Rectilinear" : "Stereographic"));
    elements.push(line(x(-60), y, x(60), y, 'stroke="#94a3b8"'));
    for (let degrees = -60; degrees <= 60; degrees += 15) {
      elements.push(circle(x(degrees), y, 5, `fill="${colors[name]}"`));
      elements.push(text(x(degrees), y + 28, `${degrees}°`, 'text-anchor="middle" class="note"'));
    }
  }
  elements.push(text(30, 688, "Each ruler is fitted separately to the same width. Edge expansion is relative to its own center scale.", 'class="note"'));
  return svg(960, 710, "Rectilinear and stereographic radial mappings", "A plot from 0 to 80 degrees shows rectilinear radius growing faster. Two equal-coverage rulers show directions 15 degrees apart, with more uneven spacing for rectilinear.", elements);
}

function project(azimuth, elevation, kind, width, height) {
  const a = radians(azimuth);
  const e = radians(elevation);
  const look = radians(20);
  const u = Math.cos(e) * Math.sin(a);
  const v = Math.sin(e) * Math.cos(look) - Math.cos(e) * Math.cos(a) * Math.sin(look);
  const w = Math.cos(e) * Math.cos(a) * Math.cos(look) + Math.sin(e) * Math.sin(look);
  if (kind === "rectilinear" ? w <= 0.001 : w < Math.cos(radians(150))) return null;
  const f = kind === "rectilinear"
    ? height / (2 * Math.tan(radians(75) / 2))
    : height / (4 * Math.tan(radians(75) / 4));
  const scale = kind === "rectilinear" ? f / w : 2 * f / (1 + w);
  return [width / 2 + scale * u, height / 2 - scale * v];
}

function sky() {
  const elements = [
    text(30, 36, "The same sky on desktop and phone", 'class="heading"'),
    text(30, 63, "Looking north, 20° above the horizon · All panels: 75° vertical FOV", 'class="note"'),
    text(30, 91, "Teal: horizon · Gray: 15° grid · Colored dots: identical sample directions", 'class="note"'),
  ];
  const samples = [
    [-45, 15, "#db2777"], [-30, 30, "#7c3aed"], [-15, 45, "#2563eb"],
    [0, 20, "#dc2626"], [15, 0, "#059669"], [30, 30, "#d97706"], [45, 15, "#db2777"],
  ];
  const panels = [
    { kind: "rectilinear", x: 40, y: 150, width: 400, height: 225, screen: "desktop 16:9" },
    { kind: "stereographic", x: 520, y: 150, width: 400, height: 225, screen: "desktop 16:9" },
    { kind: "rectilinear", x: 145, y: 465, width: 180, height: 320, screen: "phone 9:16" },
    { kind: "stereographic", x: 625, y: 465, width: 180, height: 320, screen: "phone 9:16" },
  ];
  panels.forEach((panel, index) => {
    const { kind, x, y, width, height } = panel;
    const divisor = kind === "rectilinear" ? 2 : 4;
    const hfov = divisor * Math.atan(width / height * Math.tan(radians(75) / divisor)) * 180 / Math.PI;
    const label = `${kind === "rectilinear" ? "Rectilinear" : "Stereographic"} · ${panel.screen} · HFOV ${hfov.toFixed(1)}°`;
    elements.push(text(index % 2 ? 520 : 40, y - 18, label, 'class="subheading"'));
    elements.push(`<defs><clipPath id="panel-${index}"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath></defs>`);
    elements.push(`<g transform="translate(${x} ${y})"><g clip-path="url(#panel-${index})">`);
    elements.push(`<rect width="${width}" height="${height}" fill="#eef6ff"/>`);
    const drawCurve = (directions, stroke, strokeWidth) => {
      let points = [];
      const flush = () => {
        if (points.length > 1) elements.push(path(points, `stroke="${stroke}" stroke-width="${strokeWidth}"`));
        points = [];
      };
      for (const [azimuth, elevation] of directions) {
        const point = project(azimuth, elevation, kind, width, height);
        if (!point) { flush(); continue; }
        const last = points.at(-1);
        if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) > Math.max(width, height)) flush();
        points.push(point);
      }
      flush();
    };
    for (let a = -180; a < 180; a += 15) {
      drawCurve(Array.from({ length: 181 }, (_, i) => [a, i - 90]), "#b5c5d8", 0.8);
    }
    for (let e = -75; e <= 75; e += 15) {
      if (e !== 0) drawCurve(Array.from({ length: 361 }, (_, i) => [i - 180, e]), "#b5c5d8", 0.8);
    }
    drawCurve(Array.from({ length: 361 }, (_, i) => [i - 180, 0]), "#0f766e", 2.5);
    for (const [a, e, color] of samples) {
      const point = project(a, e, kind, width, height);
      if (point) elements.push(circle(...point, 4.5, `fill="${color}" stroke="#fff" stroke-width="1.5"`));
    }
    elements.push(line(width / 2 - 8, height / 2, width / 2 + 8, height / 2, 'stroke="#1e293b"'));
    elements.push(line(width / 2, height / 2 - 8, width / 2, height / 2 + 8, 'stroke="#1e293b"'));
    elements.push(`</g><rect width="${width}" height="${height}" fill="none" stroke="#64748b"/></g>`);
  });
  elements.push(text(30, 831, "Equal vertical coverage is not equal horizontal coverage. Dots are illustrative, not live satellites.", 'class="note"'));
  return svg(960, 855, "Sky grids in landscape and portrait with two projections", "Four panels compare rectilinear and stereographic projections at 75 degrees vertical field of view, looking north at elevation 20 degrees. Stereographic curves the off-center horizon and changes peripheral grid spacing. Portrait panels show less horizontal sky.", elements);
}

writeFileSync(new URL("../docs/projection-curves.svg", import.meta.url), curves());
writeFileSync(new URL("../docs/projection-sky.svg", import.meta.url), sky());
console.log("Generated docs/projection-curves.svg and docs/projection-sky.svg");
