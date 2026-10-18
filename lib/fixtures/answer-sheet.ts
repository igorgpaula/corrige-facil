import {
  getQuestionCoordinates,
  getStandardSheetLayout,
  type StandardSheetVersion,
} from '../sheet-geometry';
import { LETTERS, type Letter } from '../types';
const glyphs = [
  ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
];

export function makeAnswerSheet(
  answers: Array<Letter | Letter[] | null>,
  {
    markers = false,
    shadow = false,
    tilt = 0,
    pencil = false,
    blue = false,
    sheetVersion = 4 as StandardSheetVersion,
  } = {},
) {
  const width = 600;
  const layout = getStandardSheetLayout(answers.length, sheetVersion);
  const cardWidth = layout.widthMm;
  const cardHeight = layout.heightMm;
  const topMarker = heightFraction(layout.markerInsetY);
  function heightFraction(mm: number) {
    return mm / cardHeight;
  }
  const height = markers ? Math.round((width * cardHeight) / cardWidth) : 800;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const centerLight =
        (1 - Math.abs(x / width - 0.5) * 2) *
        (1 - Math.abs(y / height - 0.5) * 2);
      const paper = shadow ? 118 + centerLight * 88 : 248;
      const offset = (y * width + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = paper;
      pixels[offset + 3] = 255;
    }
  }
  const ink = (x: number, y: number, value = 18, colored = false) => {
    const mappedX = Math.round(x + tilt * (y - height / 2));
    const mappedY = Math.round(y - tilt * (x - width / 2));
    if (mappedX < 0 || mappedX >= width || mappedY < 0 || mappedY >= height)
      return;
    const offset = (mappedY * width + mappedX) * 4;
    pixels[offset] = pixels[offset + 1] = value;
    pixels[offset + 2] = colored ? Math.min(220, value + 90) : value;
  };
  const rectangle = (cx: number, cy: number, w: number, h: number) => {
    for (let y = Math.floor(cy - h / 2); y < cy + h / 2; y += 1)
      for (let x = Math.floor(cx - w / 2); x < cx + w / 2; x += 1) ink(x, y);
  };
  if (markers) {
    for (const x of [30, 570])
      for (const y of [height * topMarker, height * (1 - topMarker)])
        rectangle(x, y, (width * 6) / cardWidth, (width * 6) / cardWidth);
    for (let dy = -7; dy <= 7; dy++)
      for (let dx = -7; dx <= 7; dx++)
        if (dx * dx + dy * dy < 49) {
          ink(84 + dx, height * topMarker + dy);
          if (sheetVersion === 3) ink(138 + dx, height * topMarker + dy);
          if (sheetVersion === 4) ink(192 + dx, height * topMarker + dy);
        }
  } else {
    // Dense heading and the dash before A must never become a row or column.
    rectangle(180, 62, 295, 14);
  }
  for (let row = 0; row < answers.length; row += 1) {
    const answer = answers[row];
    const selected = Array.isArray(answer) ? answer : [answer];
    const standard = getQuestionCoordinates(row, answers.length, sheetVersion);
    const y = markers
      ? height * (topMarker + standard.y * (1 - topMarker * 2))
      : 115 + row * 70;
    if (!markers) rectangle(72, y, 9, 3);
    for (let column = 0; column < 5; column += 1) {
      const x = markers
        ? 30 + standard.bubbleXs[column] * 540
        : 120 + column * 48;
      const radius = markers
        ? (width * layout.bubbleDiameterMm) / 2 / cardWidth
        : 16;
      const filled = selected.includes(LETTERS[column]);
      for (let dy = -Math.ceil(radius); dy <= radius; dy += 1) {
        for (let dx = -Math.ceil(radius); dx <= radius; dx += 1) {
          const distance = Math.hypot(dx, dy);
          if (distance <= radius && (filled || distance >= radius - 1.5))
            ink(x + dx, y + dy, filled && pencil ? 115 : 18, filled && blue);
        }
      }
      if (!filled && !markers) {
        const scale = markers ? 1 : 2;
        for (let gy = 0; gy < 7; gy += 1)
          for (let gx = 0; gx < 5; gx += 1) {
            if (glyphs[column][gy][gx] === '0') continue;
            for (let sy = 0; sy < scale; sy += 1)
              for (let sx = 0; sx < scale; sx += 1)
                ink(x + (gx - 2) * scale + sx, y + (gy - 3) * scale + sy);
          }
      }
    }
  }
  return { pixels, width, height };
}
