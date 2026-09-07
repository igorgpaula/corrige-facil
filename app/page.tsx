'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  FileDown,
  GraduationCap,
  ImagePlus,
  LockKeyhole,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
type Letter = (typeof LETTERS)[number];
type Answers = Array<Letter | null>;
type ScanResult = { answers: Answers; confidence: number[]; preview: string };

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: object;
        annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
        execute: (input: unknown) => unknown;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const INITIAL_KEY: Answers = Array(10).fill(null);
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 50;

function resizeAnswers(answers: Answers, size: number): Answers {
  return Array.from({ length: size }, (_, index) => answers[index] ?? null);
}

function getQuestionCoordinates(index: number, count: number) {
  const columns = count > 25 ? 2 : 1;
  const rows = Math.ceil(count / columns);
  const column = Math.floor(index / rows);
  const row = index % rows;
  const y = rows === 1 ? 0.5 : 0.24 + (row / (rows - 1)) * 0.66;
  const bubbleXs = columns === 1
    ? [0.38, 0.5, 0.62, 0.74, 0.86]
    : column === 0
      ? [0.11, 0.19, 0.27, 0.35, 0.43]
      : [0.58, 0.66, 0.74, 0.82, 0.9];
  return { y, bubbleXs, numberX: columns === 1 ? 0.19 : column === 0 ? 0.045 : 0.515 };
}

function formatScore(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function imageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a imagem.'));
    };
    image.src = url;
  });
}

function findRegistrationPoint(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  area: { x0: number; x1: number; y0: number; y1: number },
) {
  const step = Math.max(2, Math.round(Math.min(width, height) / 350));
  let totalX = 0;
  let totalY = 0;
  let weight = 0;

  for (let y = Math.floor(area.y0 * height); y < area.y1 * height; y += step) {
    for (let x = Math.floor(area.x0 * width); x < area.x1 * width; x += step) {
      const offset = (y * width + x) * 4;
      const gray = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
      const darkness = Math.max(0, 100 - gray);
      if (darkness > 28) {
        const strong = darkness * darkness;
        totalX += x * strong;
        totalY += y * strong;
        weight += strong;
      }
    }
  }

  if (!weight) return null;
  return { x: totalX / weight, y: totalY / weight };
}

async function readSheet(file: File, questionCount: number): Promise<ScanResult> {
  const image = await imageFromFile(file);
  const maxWidth = 1000;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Seu navegador não conseguiu analisar a foto.');
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;

  const regions = [
    { x0: 0, x1: 0.14, y0: 0, y1: 0.075 },
    { x0: 0.86, x1: 1, y0: 0, y1: 0.075 },
    { x0: 0, x1: 0.14, y0: 0.925, y1: 1 },
    { x0: 0.86, x1: 1, y0: 0.925, y1: 1 },
  ];
  const found = regions.map((region) => findRegistrationPoint(data, width, height, region));
  const fallback = [
    { x: width * 0.05, y: height * 0.04 },
    { x: width * 0.95, y: height * 0.04 },
    { x: width * 0.05, y: height * 0.96 },
    { x: width * 0.95, y: height * 0.96 },
  ];
  const [tl, tr, bl, br] = found.map((point, index) => point ?? fallback[index]);

  const mapPoint = (u: number, v: number) => ({
    x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + (1 - u) * v * bl.x + u * v * br.x,
    y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + (1 - u) * v * bl.y + u * v * br.y,
  });
  const sheetWidth = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const radius = Math.max(5, sheetWidth * 0.011);
  const answers: Answers = [];
  const confidence: number[] = [];

  for (let question = 0; question < questionCount; question += 1) {
    const { y: v, bubbleXs } = getQuestionCoordinates(question, questionCount);
    const scores = LETTERS.map((_, option) => {
      const point = mapPoint(bubbleXs[option], v);
      let darkness = 0;
      let samples = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const x = Math.round(point.x + dx);
          const y = Math.round(point.y + dy);
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const offset = (y * width + x) * 4;
          const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
          darkness += (255 - gray) / 255;
          samples += 1;
        }
      }
      return samples ? darkness / samples : 0;
    });
    const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const gap = ranked[0].score - ranked[1].score;
    answers.push(gap > 0.035 && ranked[0].score > 0.12 ? LETTERS[ranked[0].index] : null);
    confidence.push(Math.max(0, Math.min(1, gap / 0.18)));
  }

  return { answers, confidence, preview: canvas.toDataURL('image/jpeg', 0.82) };
}

function AnswerGrid({ answers, onChange, compact = false }: { answers: Answers; onChange: (next: Answers) => void; compact?: boolean }) {
  return (
    <div className={compact ? 'answer-grid compact' : 'answer-grid'}>
      {answers.map((answer, question) => (
        <div className="answer-row" key={question}>
          <span className="question-number">{String(question + 1).padStart(2, '0')}</span>
          <div className="options" role="radiogroup" aria-label={`Questão ${question + 1}`}>
            {LETTERS.map((letter) => (
              <button
                aria-checked={answer === letter}
                className={answer === letter ? 'bubble selected' : 'bubble'}
                key={letter}
                onClick={() => {
                  const next = [...answers];
                  next[question] = letter;
                  onChange(next);
                }}
                role="radio"
                type="button"
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PrintableSheet({ questionCount, pointsPerQuestion }: { questionCount: number; pointsPerQuestion: number }) {
  const total = questionCount * pointsPerQuestion;
  const columns = questionCount > 25 ? 2 : 1;
  const rows = Math.ceil(questionCount / columns);
  const cardHeight = Math.min(250, Math.max(90, 58 + rows * 7.4));
  const printPosition = (value: number, axis: 'x' | 'y') => `${((axis === 'x' ? 0.05 : 0.04) + value * (axis === 'x' ? 0.9 : 0.92)) * 100}%`;
  return (
    <section className="print-sheet" aria-hidden="true">
      <div className={columns === 1 ? 'print-card' : 'print-card wide'} style={{ height: `${cardHeight}mm` }}>
        <div className="print-marker marker-tl" /><div className="print-marker marker-tr" />
        <div className="print-marker marker-bl" /><div className="print-marker marker-br" />
        <div className="print-heading">
          <span>RESPOSTAS</span><h1>Corrige Fácil</h1>
          <div className="student-fields">
            <p>Aluno(a): __________________________________</p>
            <p>Turma: ______________</p>
          </div>
          <p className="print-config">{questionCount} questões · {formatScore(pointsPerQuestion)} ponto(s) cada · Total: {formatScore(total)}</p>
        </div>
        <div className="print-questions">
          {Array.from({ length: questionCount }, (_, question) => {
            const { y, bubbleXs, numberX } = getQuestionCoordinates(question, questionCount);
            return (
              <div className="print-question" key={question}>
                <strong className="print-question-number" style={{ left: printPosition(numberX, 'x'), top: printPosition(y, 'y') }}>{String(question + 1).padStart(2, '0')}</strong>
                {LETTERS.map((letter, option) => <span className="print-option" style={{ left: printPosition(bubbleXs[option], 'x'), top: printPosition(y, 'y') }} key={letter}><i>{letter}</i></span>)}
              </div>
            );
          })}
        </div>
        <p className="print-tip">Preencha completamente um círculo. Ao fotografar, enquadre somente este quadro e mantenha os quatro quadrados visíveis.</p>
      </div>
    </section>
  );
}

export default function Home() {
  const [answerKey, setAnswerKey] = useState<Answers>(INITIAL_KEY);
  const [studentAnswers, setStudentAnswers] = useState<Answers>(Array(10).fill(null));
  const [confidence, setConfidence] = useState<number[]>(Array(10).fill(1));
  const [questionCount, setQuestionCount] = useState(10);
  const [pointsPerQuestion, setPointsPerQuestion] = useState(1);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState('Pronto para receber a foto.');
  const [scanning, setScanning] = useState(false);
  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const studentInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let savedCount = 10;
    try {
      const settings = JSON.parse(window.localStorage.getItem('corrige-facil-config') ?? '{}') as { questionCount?: number; pointsPerQuestion?: number };
      savedCount = Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, Math.round(settings.questionCount ?? 10)));
      setQuestionCount(savedCount);
      setPointsPerQuestion(Math.max(0.01, settings.pointsPerQuestion ?? 1));
    } catch { /* usa a configuração padrão */ }
    try {
      const parsed = JSON.parse(window.localStorage.getItem('corrige-facil-gabarito') ?? '[]') as Answers;
      setAnswerKey(resizeAnswers(parsed, savedCount));
    } catch { setAnswerKey(Array(savedCount).fill(null)); }
    setStudentAnswers(Array(savedCount).fill(null));
    setConfidence(Array(savedCount).fill(1));
    setHasLoaded(true);
  }, []);
  useEffect(() => {
    if (!hasLoaded) return;
    window.localStorage.setItem('corrige-facil-gabarito', JSON.stringify(answerKey));
    window.localStorage.setItem('corrige-facil-config', JSON.stringify({ questionCount, pointsPerQuestion }));
  }, [answerKey, hasLoaded, pointsPerQuestion, questionCount]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const allowed = new Set(LETTERS);
    const register = context.registerTool({
      name: 'set_answer_key',
      title: 'Definir gabarito',
      description: `Define as ${questionCount} respostas do gabarito oficial e mostra a etapa de conferência.`,
      inputSchema: {
        type: 'object',
        properties: {
          answers: { type: 'array', minItems: questionCount, maxItems: questionCount, items: { type: 'string', enum: LETTERS } },
        },
        required: ['answers'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const candidate = (input as { answers?: unknown })?.answers;
        if (!Array.isArray(candidate) || candidate.length !== questionCount || !candidate.every((item) => allowed.has(item as Letter))) {
          throw new Error(`Informe exatamente ${questionCount} alternativas entre A e E.`);
        }
        const next = candidate as Letter[];
        setAnswerKey(next);
        setActiveStep(1);
        return { saved: true, answers: next };
      },
    }, { signal: lifecycle.signal });
    Promise.resolve(register).catch(() => undefined);
    return () => lifecycle.abort();
  }, [questionCount]);

  const correct = studentAnswers.filter((answer, index) => answer && answer === answerKey[index]).length;
  const answered = studentAnswers.filter(Boolean).length;
  const grade = correct * pointsPerQuestion;
  const totalPoints = questionCount * pointsPerQuestion;
  const scorePercent = questionCount ? (correct / questionCount) * 100 : 0;
  const keyComplete = answerKey.every(Boolean);

  const updateQuestionCount = (value: number) => {
    const nextCount = Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, Math.round(value || MIN_QUESTIONS)));
    setQuestionCount(nextCount);
    setAnswerKey((current) => resizeAnswers(current, nextCount));
    setStudentAnswers((current) => resizeAnswers(current, nextCount));
    setConfidence((current) => Array.from({ length: nextCount }, (_, index) => current[index] ?? 1));
    setPreview(null);
    setStatus('Configuração atualizada. Confira o gabarito.');
  };

  const scan = async (file: File, target: 'key' | 'student') => {
    setScanning(true);
    setStatus('Analisando marcações no seu aparelho…');
    try {
      const result = await readSheet(file, questionCount);
      if (target === 'key') {
        setAnswerKey(result.answers);
        setStatus('Gabarito lido. Confira as respostas antes de corrigir.');
        setActiveStep(1);
      } else {
        setStudentAnswers(result.answers);
        setConfidence(result.confidence);
        setPreview(result.preview);
        setStatus('Correção concluída. Revise os itens destacados.');
        setActiveStep(2);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível analisar a foto.');
    } finally { setScanning(false); }
  };

  const resetStudent = () => {
    setStudentAnswers(Array(questionCount).fill(null)); setConfidence(Array(questionCount).fill(1)); setPreview(null);
    setStatus('Pronto para receber uma nova foto.');
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><GraduationCap aria-hidden="true" /></div>
        <div><p className="eyebrow">CORREÇÃO NO PRÓPRIO APARELHO</p><h1>Corrige Fácil</h1></div>
        <div className="privacy-pill"><LockKeyhole aria-hidden="true" /> Sem envio de fotos</div>
      </header>

      <section className="intro-row">
        <div><p className="section-kicker">GABARITO ÓPTICO · {questionCount} QUESTÕES</p><h2>Da foto à nota, em segundos.</h2><p>Configure a prova, marque o gabarito e fotografe a folha do aluno.</p></div>
        <Button className="print-button" variant="outline" onClick={() => window.print()}><FileDown /> Imprimir quadro de respostas</Button>
      </section>

      <section className="exam-settings" aria-label="Configuração da prova">
        <div className="setting-copy"><span>CONFIGURAÇÃO</span><strong>Como será calculada a nota?</strong></div>
        <label className="setting-field" htmlFor="question-count">
          <span>Número de questões</span>
          <Input id="question-count" min={MIN_QUESTIONS} max={MAX_QUESTIONS} inputMode="numeric" type="number" value={questionCount} onChange={(event) => updateQuestionCount(Number(event.target.value))} />
        </label>
        <label className="setting-field" htmlFor="points-per-question">
          <span>Valor de cada questão</span>
          <div className="points-input"><Input id="points-per-question" min="0.01" step="0.1" inputMode="decimal" type="number" value={pointsPerQuestion} onChange={(event) => setPointsPerQuestion(Math.max(0.01, Number(event.target.value) || 0.01))} /><small>ponto(s)</small></div>
        </label>
        <div className="total-card"><span>Nota máxima</span><strong>{formatScore(totalPoints)}</strong></div>
      </section>

      <nav className="stepper" aria-label="Etapas da correção">
        <button className={activeStep === 1 ? 'step active' : 'step done'} onClick={() => setActiveStep(1)} type="button">
          <span>{activeStep === 2 ? <Check /> : '1'}</span><div><strong>Gabarito</strong><small>Defina as respostas</small></div>
        </button>
        <ChevronRight aria-hidden="true" />
        <button className={activeStep === 2 ? 'step active' : 'step'} disabled={!keyComplete} onClick={() => setActiveStep(2)} type="button">
          <span>2</span><div><strong>Corrigir</strong><small>Fotografe e revise</small></div>
        </button>
      </nav>

      {activeStep === 1 ? (
        <section className="workspace key-workspace">
          <article className="panel answer-panel">
            <div className="panel-heading">
              <div><span className="panel-index">01</span><div><h3>Gabarito oficial</h3><p>Toque em uma alternativa por questão.</p></div></div>
              <span className="save-state"><Check /> salvo neste aparelho</span>
            </div>
            <AnswerGrid answers={answerKey} onChange={setAnswerKey} />
          </article>
          <aside className="panel action-panel">
            <div className="scan-illustration" aria-hidden="true">
              <div className="sheet-mini">{[0, 1, 2, 3, 4].map((row) => <span key={row}><i /><i /><i className={row === 1 ? 'filled' : ''} /><i /><i /></span>)}</div><Sparkles />
            </div>
            <h3>Já tem um gabarito preenchido?</h3>
            <p>Fotografe somente o quadro de respostas. Você poderá revisar cada marcação reconhecida.</p>
            <input ref={keyInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => event.target.files?.[0] && scan(event.target.files[0], 'key')} />
            <Button className="primary-action" disabled={scanning} onClick={() => keyInput.current?.click()}><ImagePlus /> {scanning ? 'Lendo foto…' : 'Ler foto do gabarito'}</Button>
            <div className="divider"><span>depois</span></div>
            <Button className="continue-action" disabled={!keyComplete} onClick={() => setActiveStep(2)}>Corrigir uma prova <ChevronRight /></Button>
            <p className="microcopy"><CircleHelp /> {keyComplete ? 'Enquadre os quatro quadrados pretos; o restante da página pode ficar fora da foto.' : `Complete as ${questionCount} respostas para liberar a correção.`}</p>
          </aside>
        </section>
      ) : (
        <section className="workspace correction-workspace">
          <article className="panel camera-panel">
            {!preview ? (
              <div className="camera-empty">
                <div className="camera-icon"><Camera /></div><h3>Fotografe somente as respostas</h3>
                <p>Enquadre o quadro no canto da prova, com os quatro quadrados pretos visíveis. Evite sombras e inclinação.</p>
                <input ref={studentInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => event.target.files?.[0] && scan(event.target.files[0], 'student')} />
                <Button className="primary-action" disabled={scanning} onClick={() => studentInput.current?.click()}><Camera /> {scanning ? 'Analisando…' : 'Abrir câmera ou galeria'}</Button>
              </div>
            ) : (
              <div className="photo-result"><img src={preview} alt="Foto da folha de respostas analisada" /><div className="photo-badge"><Check /> Foto analisada</div></div>
            )}
            <p className="status-line" aria-live="polite">{status}</p>
          </article>
          <aside className="panel result-panel">
            <div className="result-top"><div><span className="panel-index">02</span><div><h3>Resultado</h3><p>{answered}/{questionCount} respostas identificadas</p></div></div><Button aria-label="Limpar correção" size="icon" variant="ghost" onClick={resetStudent}><RotateCcw /></Button></div>
            <div className="grade-ring" style={{ '--score': `${scorePercent}%` } as React.CSSProperties}><div><strong>{formatScore(grade)}</strong><span>de {formatScore(totalPoints)}</span></div></div>
            <div className="score-summary"><span><b>{correct}</b> acertos</span><span><b>{questionCount - correct}</b> erros ou vazias</span></div>
            <h4>Revisão das respostas</h4><AnswerGrid compact answers={studentAnswers} onChange={setStudentAnswers} />
            {confidence.some((value, index) => value < 0.35 && studentAnswers[index]) && <p className="review-warning">Algumas marcações têm baixa confiança. Confira a foto e ajuste tocando na alternativa correta.</p>}
          </aside>
        </section>
      )}

      <footer><LockKeyhole /> As fotos são processadas somente neste aparelho. Nenhuma conta ou assinatura é necessária.</footer>
      <PrintableSheet questionCount={questionCount} pointsPerQuestion={pointsPerQuestion} />
    </main>
  );
}
