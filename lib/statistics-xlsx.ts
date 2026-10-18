import ExcelJS, { type Worksheet } from 'exceljs';
import { LETTERS } from './types';
import type { StatisticsSnapshot } from './statistics-export';

const green = '087B76';
function localDate(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (key: string) =>
    Number(parts.find((p) => p.type === key)?.value);
  return new Date(
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    ),
  );
}
function tableHeader(sheet: Worksheet, rowNumber: number) {
  const row = sheet.getRow(rowNumber);
  row.height = 32;
  row.eachCell((cell) => {
    cell.font = {
      name: 'Arial',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFF' },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
  });
}
function tableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  widths: number[],
) {
  const sheet = workbook.addWorksheet(name, {
    views: [
      {
        state: 'frozen',
        ySplit: 1,
        xSplit: name === 'Correções' ? 2 : 0,
        showGridLines: false,
      },
    ],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = headers.map((header, index) => ({
    header,
    width: widths[index] ?? 12,
  }));
  return sheet;
}
function finishTable(sheet: Worksheet) {
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: '173B43' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: typeof cell.value === 'number' ? 'right' : 'left',
        wrapText: true,
      };
    });
  });
  tableHeader(sheet, 1);
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: sheet.rowCount, column: sheet.columnCount },
  };
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:1',
  };
}

export function createStatisticsWorkbook(snapshot: StatisticsSnapshot) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Corrige Fácil';
  workbook.created = new Date(snapshot.generatedAt);
  const { session, analytics } = snapshot;
  const summary = workbook.addWorksheet('Resumo', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 22, tabColor: { argb: green } },
  });
  summary.columns = [
    { width: 29 },
    { width: 68 },
    { width: 18 },
    { width: 28 },
  ];
  summary.getCell('A2').value = 'Estatísticas da sessão';
  for (const row of [
    ['Título', session.title],
    ['Turma', session.className],
    ['Disciplina', session.subject || 'Não informada'],
    ['Gerado em (Brasília)', localDate(snapshot.generatedAt)],
    ['Questões', session.questionCount],
    ['Valor por questão', session.pointsPerQuestion],
    [],
    ['Indicador', 'Valor'],
    ['Provas corrigidas', analytics.total],
    ['Média', analytics.average],
    ['Mediana', analytics.median],
    ['Nota máxima', session.maximumScore],
  ])
    summary.addRow(row);
  // addRow begins after the title (row 2); keep data and formats discoverable by label.
  summary.eachRow((row) =>
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: '173B43' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (typeof cell.value === 'number') cell.numFmt = '#,##0.00';
      if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
    }),
  );
  summary.getCell('A2').font = { name: 'Arial', size: 16, bold: true };
  summary.getRow(2).height = 30;
  for (const [title, items] of [
    ['Principais gargalos', analytics.bottlenecks],
    ['Melhores resultados', analytics.strengths],
  ] as const) {
    summary.addRow([]);
    summary.addRow([title]);
    const head = summary.addRow([
      'Questão',
      'Enunciado',
      'Acerto',
      'Incorreta mais marcada',
    ]);
    tableHeader(summary, head.number);
    for (const item of items) {
      const row = summary.addRow([
        item.order,
        item.prompt || 'Sem enunciado',
        item.accuracy,
        item.mostCommonWrong || '-',
      ]);
      row.height = Math.max(
        24,
        Math.min(409, Math.ceil((item.prompt.length || 12) / 65) * 14),
      );
      row.getCell(3).numFmt = '0.0%';
      row.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    }
  }
  summary.addRow([]);
  summary.addRow([
    'Respostas nulas',
    'Em branco inclui respostas em branco e marcações anuladas.',
  ]);
  summary.eachRow((row) => {
    row.eachCell((cell) => {
      if (!cell.font?.name) cell.font = { name: 'Arial', size: 10 };
    });
    if (
      ['Questões', 'Provas corrigidas'].includes(String(row.getCell(1).value))
    )
      row.getCell(2).numFmt = '#,##0';
    if (row.getCell(1).value === 'Indicador') tableHeader(summary, row.number);
    if (
      ['Título', 'Turma', 'Disciplina', 'Respostas nulas'].includes(
        String(row.getCell(1).value),
      )
    )
      row.height = Math.max(
        24,
        Math.min(409, Math.ceil(String(row.getCell(2).value).length / 65) * 14),
      );
  });
  const questions = tableSheet(
    workbook,
    'Questões',
    [
      'Questão',
      'Enunciado',
      'Gabarito',
      'Provas',
      'Acertos',
      'Acerto (%)',
      ...LETTERS.map((l) => `Marcações ${l}`),
      'Em branco',
      'Incorreta mais marcada',
      ...LETTERS.map((l) => `Texto ${l}`),
    ],
    [11, 70, 11, 11, 11, 13, 12, 12, 12, 12, 12, 13, 25, 45, 45, 45, 45, 45],
  );
  for (const item of snapshot.questions) {
    const row = questions.addRow([
      item.order,
      item.prompt || 'Sem enunciado',
      item.answer,
      item.total,
      item.correct,
      item.accuracy,
      ...LETTERS.map((l) => item.optionCounts[l]),
      item.optionCounts.blank,
      item.mostCommonWrong || '-',
      ...LETTERS.map((l) => item.options[l]),
    ]);
    row.getCell(6).numFmt = '0.0%';
    row.height = Math.max(
      28,
      Math.min(
        409,
        Math.max(
          Math.ceil(item.prompt.length / 70),
          ...LETTERS.map((l) => Math.ceil(item.options[l].length / 45)),
        ) * 14,
      ),
    );
  }
  finishTable(questions);
  const distribution = tableSheet(
    workbook,
    'Distribuição',
    ['Faixa da nota (%)', 'Provas', 'Percentual das provas'],
    [28, 15, 25],
  );
  for (const item of analytics.distribution) {
    const row = distribution.addRow([
      item.label,
      item.count,
      item.count / analytics.total,
    ]);
    row.getCell(3).numFmt = '0.0%';
  }
  finishTable(distribution);
  const corrections = tableSheet(
    workbook,
    'Correções',
    [
      'Correção',
      'Aluno/código',
      'Data (Brasília)',
      'Acertos',
      'Nota',
      'Nota máxima',
      'Aproveitamento',
      ...Array.from({ length: session.questionCount }, (_, i) => `Q${i + 1}`),
    ],
    [12, 35, 23, 12, 12, 15, 19],
  );
  snapshot.corrections.forEach((item, index) => {
    const row = corrections.addRow([
      index + 1,
      item.studentLabel,
      localDate(item.createdAt),
      item.correctCount,
      item.score,
      item.maximumScore,
      item.percentage,
      ...item.answers.map((a) => a ?? '-'),
    ]);
    row.getCell(3).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(5).numFmt = row.getCell(6).numFmt = '#,##0.00';
    row.getCell(7).numFmt = '0.0%';
    row.height = Math.max(
      22,
      Math.min(409, Math.ceil(item.studentLabel.length / 35) * 14),
    );
  });
  finishTable(corrections);
  return workbook;
}
