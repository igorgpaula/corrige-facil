import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExcelJS from 'exceljs';
import { expect, it, vi } from 'vitest';
import {
  buildStatisticsSnapshot,
  exportFilename,
  exportSessionStatistics,
} from './statistics-export';
import { calculateAnalytics } from './analytics';
import { createStatisticsWorkbook } from './statistics-xlsx';
import { createStatisticsPdf } from './statistics-pdf';
import { StatisticsExportButton } from '../components/statistics-export-button';
import { SessionMetadataEditor } from '../components/session-metadata-editor';
import { statisticsFixture } from './fixtures/statistics';

const date = new Date('2026-10-18T16:00:00Z');
const fonts = {
  regular: readFileSync(
    new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url),
  ).toString('base64'),
  bold: readFileSync(
    new URL('../assets/fonts/NotoSans-Bold.ttf', import.meta.url),
  ).toString('base64'),
};
it('usa os números do painel, somente correções salvas e nenhum dado de imagem', () => {
  const fixture = statisticsFixture();
  const snapshot = buildStatisticsSnapshot(fixture, date);
  expect(snapshot.analytics).toEqual(
    calculateAnalytics(fixture.session, fixture.questions, fixture.corrections),
  );
  expect(snapshot.corrections[0].studentLabel).toBe('Não informado');
  expect(snapshot.corrections).toHaveLength(fixture.corrections.length);
  expect(snapshot.generatedAt).toBe(date.toISOString());
  expect(JSON.stringify(snapshot)).not.toMatch(
    /base64|data:image|preview|readings/,
  );
  expect(() =>
    buildStatisticsSnapshot({ ...fixture, corrections: [] }),
  ).toThrow(/primeira/);
  fixture.session.title = '../Prova: História/2026';
  expect(exportFilename(buildStatisticsSnapshot(fixture, date), 'pdf')).toBe(
    'estatisticas-Prova-Historia-2026-8-A-2026-10-18.pdf',
  );
});
it.each([1, 10, 50])(
  'exporta %s questões em XLSX, com números, datas e textos literais',
  async (count) => {
    const snapshot = buildStatisticsSnapshot(statisticsFixture(count), date);
    const workbook = createStatisticsWorkbook(snapshot);
    const bytes = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    expect(reopened.worksheets.map((s) => s.name)).toEqual([
      'Resumo',
      'Questões',
      'Distribuição',
      'Correções',
    ]);
    const questions = reopened.getWorksheet('Questões')!;
    expect(questions.getCell('F2').value).toBe(snapshot.questions[0].accuracy);
    expect(questions.getCell('F2').numFmt).toBe('0.0%');
    expect(questions.rowCount).toBe(count + 1);
    const corrections = reopened.getWorksheet('Correções')!;
    expect(corrections.getCell('B3').value).toBe(
      '=HYPERLINK("https://example.test")',
    );
    expect(corrections.getCell('B3').type).toBe(ExcelJS.ValueType.String);
    expect(corrections.getCell('C2').value).toBeInstanceOf(Date);
    expect(corrections.getCell('E2').value).toBe(snapshot.corrections[0].score);
    expect(corrections.columnCount).toBe(7 + count);
    expect(corrections.views[0].state).toBe('frozen');
    expect(corrections.autoFilter).toBeTruthy();
    const sum = reopened
      .getWorksheet('Distribuição')!
      .getColumn(2)
      .values.slice(2)
      .reduce<number>((sum, v) => sum + Number(v), 0);
    expect(sum).toBe(snapshot.analytics.total);
  },
);
it('gera PDF paginado, pesquisável, com enunciados longos e acentos', async () => {
  const snapshot = buildStatisticsSnapshot(
    statisticsFixture(10, 3, true),
    date,
  );
  const doc = createStatisticsPdf(snapshot, fonts);
  expect(doc.getNumberOfPages()).toBeGreaterThan(2);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(doc.output('arraybuffer')),
    useSystemFonts: true,
  });
  const parsed = await task.promise;
  try {
    let text = '';
    for (let i = 1; i <= parsed.numPages; i++) {
      const page = await parsed.getPage(i);
      text +=
        (await page.getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ') + '\n';
    }
    expect(text).toContain('Avaliação de Geografia');
    expect(text).toContain('8º A');
    expect(text).toContain('Não informado');
    expect(text).toContain('Resultados individuais');
    expect(text).toContain('Como a distribuição da população');
  } finally {
    await task.destroy();
  }
}, 60000);
it('mostra os botões de edição e exportação; desabilita exportação sem correções', () => {
  const bundle = statisticsFixture();
  expect(
    renderToStaticMarkup(
      createElement(SessionMetadataEditor, {
        session: bundle.session,
        userId: 'test',
        onSaved: async () => {},
      }),
    ),
  ).toContain('Editar título e turma');
  const html = renderToStaticMarkup(
    createElement(StatisticsExportButton, {
      bundle: { ...bundle, corrections: [] },
    }),
  );
  expect(html).toContain('Extrair estatísticas');
  expect(html).toMatch(/disabled/);
});
it('gera os dois downloads no navegador, permite tentar novamente e libera URLs temporárias', async () => {
  const click = vi.fn(),
    remove = vi.fn();
  const link = { href: '', download: '', click, remove };
  vi.stubGlobal('window', { location: { origin: 'https://test.local' } });
  vi.stubGlobal('document', {
    createElement: () => link,
    body: { appendChild: vi.fn() },
  });
  const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  const create = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:local-test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  try {
    await expect(
      exportSessionStatistics(statisticsFixture(), 'pdf'),
    ).rejects.toThrow(/fonte/);
    fetchMock.mockImplementation(
      async (...args: unknown[]) =>
        new Response(
          new Uint8Array(
            Buffer.from(
              String(args[0]).includes('Bold') ? fonts.bold : fonts.regular,
              'base64',
            ),
          ),
        ),
    );
    await exportSessionStatistics(statisticsFixture(), 'pdf');
    expect(link.download).toMatch(/\.pdf$/);
    await exportSessionStatistics(statisticsFixture(), 'xlsx');
    expect(link.download).toMatch(/\.xlsx$/);
    expect(click).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(revoke).toHaveBeenCalledTimes(2);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}, 60000);
it.skipIf(!process.env.EXPORT_QA)(
  'gera amostras locais de exportação para conferência visual',
  async () => {
    const directory = new URL('../work/statistics-qa/', import.meta.url);
    mkdirSync(directory, { recursive: true });
    const snapshot = buildStatisticsSnapshot(statisticsFixture(10, 3), date);
    writeFileSync(
      new URL('relatorio.pdf', directory),
      new Uint8Array(
        createStatisticsPdf(snapshot, fonts).output('arraybuffer'),
      ),
    );
    writeFileSync(
      new URL('relatorio.xlsx', directory),
      new Uint8Array(
        await createStatisticsWorkbook(snapshot).xlsx.writeBuffer(),
      ),
    );
    const large = buildStatisticsSnapshot(
      statisticsFixture(50, 200, true),
      date,
    );
    writeFileSync(
      new URL('relatorio-extenso.pdf', directory),
      new Uint8Array(createStatisticsPdf(large, fonts).output('arraybuffer')),
    );
  },
  60000,
);
