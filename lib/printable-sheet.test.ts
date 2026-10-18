import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { PrintableSheet } from '../components/printable-sheet';
import type { ExamSession } from './types';
import { analyzeSheet } from './omr-engine';
import { testOpenCv } from './opencv-test-runtime';

function session(count: number): ExamSession {
  return {
    id: 'print-test',
    title: 'Avaliação de teste',
    className: '7º A',
    subject: '',
    questionCount: count,
    pointsPerQuestion: 0.8,
    answerKey: Array(count).fill('A'),
    status: 'draft',
    lockedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}
const css = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);
it.each([1, 2, 10, 25, 26, 50])(
  'gera um único quadro de %s questões, com quatro marcadores e círculos vazios',
  (count) => {
    const html = renderToStaticMarkup(
      createElement(PrintableSheet, { session: session(count) }),
    );
    expect(html.match(/class="print-sheet"/g)).toHaveLength(1);
    expect(html.match(/class="print-marker /g)).toHaveLength(4);
    expect(html).toContain('print-orientation-dot');
    expect(html.match(/class="print-question"/g)).toHaveLength(count);
    expect(html.match(/class="print-option"/g)).toHaveLength(count * 5);
    expect(html).not.toContain('selected');
  },
);
it('mantém a folha fora do contêiner oculto na impressão, sem forçar uma segunda página', () => {
  const app = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const homeIndex = app.indexOf('export default function Home()');
  const workspace = app.slice(
    app.indexOf('function SessionWorkspace('),
    homeIndex,
  );
  expect(workspace).not.toContain('<PrintableSheet');
  expect(app.slice(homeIndex)).toMatch(
    /<PrintableSheet session=\{bundle.session\}/,
  );
  const print = css.slice(css.lastIndexOf('@media print'));
  expect(print).toContain('.app-shell > .print-sheet');
  expect(print).toMatch(/min-height:\s*0 !important/);
  expect(print).not.toContain('height: 297mm');
  expect(print).toContain('margin: 12mm');
});
it.skipIf(!process.env.PRINT_QA_FIXTURES)(
  'gera prévias locais com as mesmas regras de impressão',
  () => {
    mkdirSync(new URL('../work/print-qa/', import.meta.url), {
      recursive: true,
    });
    const printCss = css
      .slice(css.lastIndexOf('@media print'))
      .replace('@media print', '@media screen');
    for (const count of [1, 2, 10, 25, 26, 50]) {
      const markup = renderToStaticMarkup(
        createElement(PrintableSheet, { session: session(count) }),
      );
      const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Prévia de impressão — ${count} questões</title><style>*{box-sizing:border-box}body{margin:0}.print-sheet{display:none}${printCss}html{width:210mm!important;padding:12mm!important}</style><main class="app-shell"><section class="session-page">Esta interface não deve aparecer na impressão.</section>${markup}</main></html>`;
      writeFileSync(
        new URL(`../work/print-qa/${count}.html`, import.meta.url),
        html,
      );
    }
  },
);

it.skipIf(!process.env.PRINT_MODEL_PNG)(
  'reconhece o PDF de exemplo renderizado e suas dez marcações sintéticas',
  async () => {
    const require = createRequire(import.meta.url);
    const localRequire = createRequire(
      require.resolve('pdfjs-dist/package.json'),
    );
    const { createCanvas, loadImage } = localRequire('@napi-rs/canvas');
    const image = await loadImage(process.env.PRINT_MODEL_PNG);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { cv } = await testOpenCv();
    const blank = analyzeSheet(
      cv,
      context.getImageData(0, 0, image.width, image.height).data,
      image.width,
      image.height,
      10,
      { mode: 'standard' },
    );
    expect(blank.alignment).toBe('verified');
    expect(blank.readings.every((r) => r.status === 'blank')).toBe(true);
    const expected = ['A', 'D', 'C', 'A', 'A', 'A', 'C', 'C', 'D', 'A'];
    blank.overlay.forEach((row, index) => {
      const p = row.centers['ABCDE'.indexOf(expected[index])];
      context.beginPath();
      context.arc(
        p.x * image.width,
        p.y * image.height,
        row.radius * image.width * 0.8,
        0,
        Math.PI * 2,
      );
      context.fill();
    });
    const filled = analyzeSheet(
      cv,
      context.getImageData(0, 0, image.width, image.height).data,
      image.width,
      image.height,
      10,
      { mode: 'standard' },
    );
    expect(filled.readings.map((r) => r.answer)).toEqual(expected);
  },
  60000,
);
