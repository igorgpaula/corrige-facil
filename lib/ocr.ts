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
  let text = normalizeText(rawText);
  text = text
    .replace(/\s+(Quest(?:ão|ao)\s+\d{1,3}\s*[.\-–:]?)/gi, '\n$1')
    .replace(/\s+(\d{1,3}\s*[.\-–]\s+)/g, '\n$1')
    .replace(/\s+(\(?[A-E]\)?\s*[.)\-:]\s+)/g, '\n$1');

  const questionPattern =
    /^(?:quest(?:ão|ao)\s+)?(\d{1,3})\s*(?:[.)\-–:]\s*)?(.*)$/i;
  const optionPattern = /^\(?([A-E])\)?\s*[.)\-:]\s*(.*)$/i;
  const questions: QuestionDefinition[] = [];
  let current: QuestionDefinition | null = null;
  let currentOption: Letter | null = null;

  const commit = () => {
    if (!current) return;
    current.prompt = current.prompt.trim();
    for (const key of Object.keys(current.options) as Letter[])
      current.options[key] = current.options[key]?.trim();
    if (current.prompt || Object.keys(current.options).length) questions.push(current);
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const option = optionPattern.exec(line);
    if (current && option) {
      currentOption = option[1].toUpperCase() as Letter;
      current.options[currentOption] = option[2].trim();
      continue;
    }
    const question = questionPattern.exec(line);
    if (question) {
      const number = Number(question[1]);
      if (number >= 1 && number <= MAX_QUESTIONS) {
        commit();
        current = {
          id: `q_${number}`,
          order: number,
          prompt: question[2].trim(),
          options: {},
          ocrConfidence: baseConfidence,
        };
        currentOption = null;
        continue;
      }
    }
    if (!current) continue;
    if (currentOption) {
      current.options[currentOption] = `${current.options[currentOption] ?? ''} ${line}`.trim();
    } else {
      current.prompt = `${current.prompt} ${line}`.trim();
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
  if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
  const worker = await createWorker('por', 1, {
    logger(message) {
      if (message.status === 'recognizing text')
        onProgress(message.progress, 'Reconhecendo o texto…');
    },
  });
  try {
    if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
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

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
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
      if (!context) throw new Error('Não foi possível preparar a página para OCR.');
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const recognized = await recognizeImage(canvas, signal, (value, message) =>
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
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const sections = isPdf
    ? await extractPdf(file, signal, onProgress)
    : [
        await recognizeImage(file, signal, (value, message) =>
          onProgress({ page: 1, totalPages: 1, progress: value, message }),
        ),
      ];
  if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
  const questions: QuestionDefinition[] = [];
  for (const section of sections) {
    const parsed = parseExamText(section.text, section.confidence);
    for (const item of parsed) {
      const existing = questions.find((question) => question.order === item.order);
      if (!existing) questions.push(item);
    }
  }
  const normalized = questions
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_QUESTIONS)
    .map((question, index) => ({
      ...question,
      id: `q_${index + 1}`,
      order: index + 1,
    }));
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
