import { jsPDF } from 'jspdf';
import { autoTable, type UserOptions } from 'jspdf-autotable';
import regularAsset from '../assets/fonts/NotoSans-Regular.ttf?url';
import boldAsset from '../assets/fonts/NotoSans-Bold.ttf?url';
import { LETTERS } from './types';
import { exportDate, type StatisticsSnapshot } from './statistics-export';

type PdfFonts = { regular: string; bold: string };
let fontsPromise: Promise<PdfFonts> | undefined;
export function loadPdfFonts() {
  if (!fontsPromise)
    fontsPromise = Promise.all(
      [regularAsset, boldAsset].map(async (asset) => {
        const url = new URL(asset, window.location.origin);
        if (url.protocol === 'file:')
          url.href = new URL(url.pathname, window.location.origin).href;
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(
            'Não foi possível carregar a fonte do PDF. Tente novamente.',
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      }),
    )
      .then(([regular, bold]) => ({ regular, bold }))
      .catch((error) => {
        fontsPromise = undefined;
        throw error;
      });
  return fontsPromise;
}
const number = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const clean = (value: string) =>
  value.replace(/[\u0000-\u001f]/g, ' ').replace(/[\u2010-\u2015]/g, '-');

export function createStatisticsPdf(
  snapshot: StatisticsSnapshot,
  fonts: PdfFonts,
) {
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true });
  doc.addFileToVFS('NotoSans-Regular.ttf', fonts.regular);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  doc.setFont('NotoSans');
  doc.setProperties({
    title: `Estatísticas - ${snapshot.session.title}`,
    author: 'Corrige Fácil',
  });
  const margin = 14,
    contentWidth = 182,
    bottom = 279;
  let y = 18;
  const newPage = () => {
    doc.addPage();
    y = 20;
  };
  const ensure = (height: number) => {
    if (y + height > bottom) newPage();
  };
  const text = (value: string, size = 10, bold = false) => {
    doc.setFont('NotoSans', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(clean(value), contentWidth);
    for (const line of lines) {
      ensure(size * 0.45 + 1);
      doc.text(line, margin, y);
      y += size * 0.45 + 1;
    }
  };
  const title = (value: string) => {
    ensure(18);
    y += 3;
    text(value, 12, true);
    y += 2;
  };
  const table = (
    heading: string,
    head: string[],
    body: (string | number)[][],
    options: Partial<UserOptions> = {},
  ) => {
    const fontSize = options.styles?.fontSize ?? 8;
    const padding =
      typeof options.styles?.cellPadding === 'number'
        ? options.styles.cellPadding
        : 2;
    const estimate = (cells: (string | number)[], bold: boolean) => {
      doc.setFont('NotoSans', bold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      return Math.max(
        ...cells.map((cell, index) => {
          const fixed = options.columnStyles?.[index]?.cellWidth;
          const width =
            typeof fixed === 'number' ? fixed : contentWidth / head.length;
          return (
            doc.splitTextToSize(
              clean(String(cell)),
              Math.max(5, width - padding * 2),
            ).length *
              fontSize *
              0.45 +
            padding * 2
          );
        }),
      );
    };
    // Keep the section title, repeated table header and first data row together.
    ensure(
      Math.min(240, 17 + estimate(head, true) + estimate(body[0] ?? [], false)),
    );
    title(heading);
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { top: 18, bottom: 18, left: margin, right: margin },
      styles: {
        font: 'NotoSans',
        fontSize: 8,
        cellPadding: 2,
        overflow: 'linebreak',
        valign: 'top',
      },
      headStyles: {
        fillColor: [8, 123, 118],
        font: 'NotoSans',
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [245, 249, 249] },
      rowPageBreak: 'avoid',
      ...options,
    });
    y =
      (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 7;
  };
  text('Estatísticas da sessão', 18, true);
  y += 2;
  text(snapshot.session.title, 14, true);
  text(`Turma: ${snapshot.session.className}`);
  if (snapshot.session.subject) text(`Disciplina: ${snapshot.session.subject}`);
  text(`Gerado em: ${exportDate(snapshot.generatedAt)} (Brasília)`, 9);
  y += 4;
  const { analytics } = snapshot;
  table(
    'Resumo',
    ['Provas corrigidas', 'Média', 'Mediana', 'Nota máxima'],
    [
      [
        analytics.total,
        number(analytics.average),
        number(analytics.median),
        number(snapshot.session.maximumScore),
      ],
    ],
  );

  const bars = (
    heading: string,
    rows: { label: string; value: number }[],
    maximum: number,
    percent: boolean,
  ) => {
    title(heading);
    for (const row of rows) {
      if (y + 8 > bottom) {
        newPage();
        title(`${heading} (continuação)`);
      }
      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(8);
      doc.text(clean(row.label), margin, y + 3);
      doc.setFillColor(235, 242, 242);
      doc.rect(margin + 30, y, 130, 4, 'F');
      const width =
        maximum > 0
          ? Math.max(0, Math.min(130, (row.value / maximum) * 130))
          : 0;
      doc.setFillColor(
        percent ? 8 : 201,
        percent ? 123 : 140,
        percent ? 118 : 36,
      );
      if (width) doc.rect(margin + 30, y, width, 4, 'F');
      doc.text(
        percent ? `${Math.round(row.value * 100)}%` : String(row.value),
        margin + 164,
        y + 3,
      );
      y += 7;
    }
    y += 4;
  };
  bars(
    'Acerto por questão',
    analytics.questionStats.map((q) => ({
      label: `Q${q.order}`,
      value: q.accuracy,
    })),
    1,
    true,
  );
  bars(
    'Distribuição das notas',
    analytics.distribution.map((q) => ({ label: q.label, value: q.count })),
    Math.max(1, ...analytics.distribution.map((d) => d.count)),
    false,
  );
  for (const [heading, items] of [
    ['Principais gargalos', analytics.bottlenecks],
    ['Melhores resultados', analytics.strengths],
  ] as const)
    table(
      heading,
      ['Questão', 'Enunciado', 'Acerto', 'Incorreta mais marcada'],
      items.map((q) => [
        q.order,
        clean(q.prompt || 'Sem enunciado'),
        `${Math.round(q.accuracy * 100)}%`,
        q.mostCommonWrong ?? '-',
      ]),
      {
        columnStyles: {
          0: { cellWidth: 17 },
          1: { cellWidth: 105 },
          2: { cellWidth: 20 },
          3: { cellWidth: 40 },
        },
      },
    );
  table(
    'Detalhamento por questão',
    ['Q', 'Enunciado', 'Gab.', 'Acertos', '%', ...LETTERS, 'Branco'],
    snapshot.questions.map((q) => [
      q.order,
      clean(q.prompt || 'Sem enunciado'),
      q.answer ?? '-',
      `${q.correct}/${q.total}`,
      Math.round(q.accuracy * 100),
      ...LETTERS.map((l) => q.optionCounts[l]),
      q.optionCounts.blank,
    ]),
    {
      styles: {
        font: 'NotoSans',
        fontSize: 7,
        cellPadding: 1.4,
        overflow: 'linebreak',
      },
      columnStyles: {
        0: { cellWidth: 9 },
        1: { cellWidth: 64 },
        2: { cellWidth: 11 },
        3: { cellWidth: 17 },
        4: { cellWidth: 12 },
      },
    },
  );
  text('Em branco inclui respostas em branco e marcações anuladas.', 8);
  newPage();
  text('Resultados individuais', 15, true);
  text('Nos resultados abaixo, "-" indica resposta em branco ou anulada.', 8);
  y += 3;
  table(
    'Correções salvas',
    ['Aluno/código', 'Data (Brasília)', 'Acertos', 'Nota', 'Respostas'],
    snapshot.corrections.map((c) => [
      clean(c.studentLabel),
      exportDate(c.createdAt),
      c.correctCount,
      `${number(c.score)} / ${number(c.maximumScore)}`,
      c.answers.map((a, i) => `${i + 1}:${a ?? '-'}`).join('  '),
    ]),
    {
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 30 },
        2: { cellWidth: 17 },
        3: { cellWidth: 22 },
        4: { cellWidth: 78 },
      },
    },
  );
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('NotoSans', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(`Corrige Fácil - ${page} / ${pages}`, 196, 289, {
      align: 'right',
    });
  }
  return doc;
}
