import type { Letter, QuestionDefinition } from './types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 20;
const MAX_QUESTIONS = 50;

export function resolvePdfWorkerUrl(assetUrl: string, pageOrigin: string) {
  const resolved = new URL(assetUrl, pageOrigin);
  if (resolved.protocol === 'file:') {
    return new URL(resolved.pathname, pageOrigin).toString();
  }
  return resolved.toString();
}

type Progress = {
  page: number;
  totalPages: number;
  progress: number;
  message: string;
};

type ExamTextSection = { text: string; confidence: number | null };

const optionPattern = /^(?:\(([A-E])\)|([A-E])[.)\-:])\s*(.*)$/i;

function questionStart(line: string) {
  const labelled =
    /^quest(?:ão|ao)\s+(\d{1,3})(?:\s*[.)\-–:]\s*|\s+|$)(.*)$/i.exec(line);
  const numbered = labelled ? null : /^(\d{1,3})\s*[.)\-–:]\s+(.*)$/.exec(line);
  const match = labelled ?? numbered;
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= MAX_QUESTIONS
    ? { number, prompt: match[2].trim() }
    : null;
}

function isPageMetadata(line: string) {
  return (
    /\bp[áa]gina\s+\d+\s*(?:de|\/)\s*\d+\s*$/i.test(line) ||
    /^quest(?:ões|oes)\s+\d+\s*(?:a|[-–])\s*\d+\s*$/i.test(line) ||
    /^\d+\s+quest(?:ões|oes)\b/i.test(line)
  );
}

function normalizeText(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseExamText(
  rawText: string,
  baseConfidence: number | null = null,
): QuestionDefinition[] {
  return parseExamSections([{ text: rawText, confidence: baseConfidence }]);
}

export function parseExamSections(
  sections: ExamTextSection[],
): QuestionDefinition[] {
  const pages = sections.map((section) => ({
    ...section,
    lines: normalizeText(section.text)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  }));
  // Running titles and footers can occur between the alternatives of a question.
  const edgePages = new Map<string, Set<number>>();
  for (const [pageIndex, page] of pages.entries()) {
    for (const line of [...page.lines.slice(0, 3), ...page.lines.slice(-3)]) {
      if (line.length < 12 || questionStart(line) || optionPattern.test(line))
        continue;
      const key = line.toLocaleLowerCase('pt-BR');
      const occurrences = edgePages.get(key) ?? new Set<number>();
      occurrences.add(pageIndex);
      edgePages.set(key, occurrences);
    }
  }
  const questions: QuestionDefinition[] = [];
  let current: QuestionDefinition | null = null;
  let currentOption: Letter | null = null;

  const commit = () => {
    if (!current) return;
    current.prompt = current.prompt.trim();
    for (const key of Object.keys(current.options) as Letter[])
      current.options[key] = current.options[key]?.trim();
    if (current.prompt || Object.keys(current.options).length)
      questions.push(current);
  };

  for (const page of pages) {
    const text = page.lines
      .filter(
        (line) =>
          !isPageMetadata(line) &&
          (edgePages.get(line.toLocaleLowerCase('pt-BR'))?.size ?? 0) < 2,
      )
      .join('\n')
      .replace(/\s+(?=Quest(?:ão|ao)\s+\d{1,3}\b)/gi, '\n')
      .replace(/(?<!Quest(?:ão|ao))[ \t]+(?=\d{1,3}\s*[.)\-–:]\s+\S)/gi, '\n')
      .replace(/\s+(?=(?:\([A-E]\)|[A-E][.)\-:])(?:\s|$))/gi, '\n');

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const question = questionStart(line);
      if (question) {
        commit();
        current = {
          id: `q_${question.number}`,
          order: question.number,
          prompt: question.prompt,
          options: {},
          ocrConfidence: page.confidence,
        };
        currentOption = null;
        continue;
      }
      if (!current) continue;
      if (page.confidence !== null) {
        current.ocrConfidence = Math.min(
          current.ocrConfidence ?? 1,
          page.confidence,
        );
      }
      const option = optionPattern.exec(line);
      if (option) {
        currentOption = (option[1] ?? option[2]).toUpperCase() as Letter;
        current.options[currentOption] = option[3].trim();
      } else if (currentOption) {
        current.options[currentOption] =
          `${current.options[currentOption] ?? ''} ${line}`.trim();
      } else {
        current.prompt = `${current.prompt} ${line}`.trim();
      }
    }
  }
  commit();

  return questions
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_QUESTIONS)
    .map((question, index) => ({
      ...question,
      id: `q_${index + 1}`,
      order: index + 1,
    }));
}

async function recognizeImage(
  source: File | HTMLCanvasElement,
  signal: AbortSignal,
  onProgress: (value: number, message: string) => void,
) {
  const { createWorker } = await import('tesseract.js');
  if (signal.aborted)
    throw new DOMException('Operação cancelada.', 'AbortError');
  const worker = await createWorker('por', 1, {
    logger(message) {
      if (message.status === 'recognizing text')
        onProgress(message.progress, 'Reconhecendo o texto…');
    },
  });
  try {
    if (signal.aborted)
      throw new DOMException('Operação cancelada.', 'AbortError');
    const result = await worker.recognize(source);
    return {
      text: result.data.text,
      confidence: Math.max(0, Math.min(100, result.data.confidence)) / 100,
    };
  } finally {
    await worker.terminate();
  }
}

async function extractPdf(
  file: File,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
) {
  const pdfjs = await import('pdfjs-dist');
  const workerAssetUrl = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerUrl(
    workerAssetUrl,
    window.location.origin,
  );
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdfDocument = await loadingTask.promise;

  try {
    if (pdfDocument.numPages > MAX_PAGES)
      throw new Error(`O PDF pode ter no máximo ${MAX_PAGES} páginas.`);
    const sections: Array<{ text: string; confidence: number }> = [];

    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber += 1
    ) {
      if (signal.aborted)
        throw new DOMException('Operação cancelada.', 'AbortError');
      onProgress({
        page: pageNumber,
        totalPages: pdfDocument.numPages,
        progress: (pageNumber - 1) / pdfDocument.numPages,
        message: `Lendo página ${pageNumber} de ${pdfDocument.numPages}…`,
      });
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const embedded = content.items
        .map((item) => {
          if (!('str' in item)) return '';
          return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`;
        })
        .join('');
      if (embedded.replace(/\s/g, '').length > 80) {
        sections.push({ text: embedded, confidence: 0.98 });
        page.cleanup();
        continue;
      }
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context)
        throw new Error('Não foi possível preparar a página para OCR.');
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const recognized = await recognizeImage(
        canvas,
        signal,
        (value, message) =>
          onProgress({
            page: pageNumber,
            totalPages: pdfDocument.numPages,
            progress: (pageNumber - 1 + value) / pdfDocument.numPages,
            message,
          }),
      );
      sections.push(recognized);
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
    return sections;
  } finally {
    await loadingTask.destroy();
  }
}

export async function readBlankExam(
  file: File,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
) {
  if (file.size > MAX_FILE_BYTES)
    throw new Error('O arquivo pode ter no máximo 20 MB.');
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const sections = isPdf
    ? await extractPdf(file, signal, onProgress)
    : [
        await recognizeImage(file, signal, (value, message) =>
          onProgress({ page: 1, totalPages: 1, progress: value, message }),
        ),
      ];
  if (signal.aborted)
    throw new DOMException('Operação cancelada.', 'AbortError');
  const normalized = parseExamSections(sections);
  if (!normalized.length)
    throw new Error(
      'Não encontrei questões estruturadas. Tente uma imagem mais nítida ou adicione as questões manualmente.',
    );
  onProgress({
    page: sections.length,
    totalPages: sections.length,
    progress: 1,
    message: `${normalized.length} questões encontradas. Revise o texto.`,
  });
  return normalized;
}
