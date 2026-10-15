'use client';

import {
  type ChangeEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Camera,
  Check,
  ChevronLeft,
  ClipboardCheck,
  Copy,
  FileDown,
  FileText,
  GraduationCap,
  ImagePlus,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { calculateAnalytics } from '@/lib/analytics';
import { auth, firebaseConfigured } from '@/lib/firebase';
import {
  answersFromReadings,
  getQuestionCoordinates,
  readAnswerSheet,
} from '@/lib/omr';
import { readBlankExam } from '@/lib/ocr';
import {
  createSession,
  deleteCorrection,
  deleteSession,
  duplicateSession,
  ensureUser,
  listSessions,
  loadSession,
  saveCorrection,
  setSessionStatus,
  updateSessionDraft,
} from '@/lib/repository';
import {
  LETTERS,
  type AnswerReading,
  type Answers,
  type ExamSession,
  type QuestionDefinition,
  type SessionBundle,
  type SessionDraft,
} from '@/lib/types';

const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 50;
const LOCAL_USER = {
  uid: 'local-demo',
  displayName: 'Modo local',
  email: null,
  photoURL: null,
};

type AppUser = Pick<User, 'uid' | 'displayName' | 'email' | 'photoURL'>;
type View = 'sessions' | 'create' | 'session';

function formatScore(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function resizeAnswers(answers: Answers, size: number): Answers {
  return Array.from({ length: size }, (_, index) => answers[index] ?? null);
}

function emptyQuestions(size: number): QuestionDefinition[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `q_${index + 1}`,
    order: index + 1,
    prompt: '',
    options: {},
    ocrConfidence: null,
  }));
}

function AnswerGrid({
  answers,
  onChange,
  compact = false,
  answerKey,
  readings,
}: {
  answers: Answers;
  onChange: (next: Answers, question: number) => void;
  compact?: boolean;
  answerKey?: Answers;
  readings?: AnswerReading[];
}) {
  const groupId = useId();
  return (
    <div className={compact ? 'answer-grid compact' : 'answer-grid'}>
      {answers.map((answer, question) => {
        const isIncorrect = Boolean(
          answer && answerKey?.[question] && answer !== answerKey[question],
        );
        const reading = readings?.[question];
        const confidenceClass = !reading?.answer
          ? 'missing'
          : reading.source === 'manual'
            ? 'manual'
            : reading.confidence >= 80
              ? 'high'
              : reading.confidence >= 60
                ? 'medium'
                : 'low';
        return (
          <div
            className={isIncorrect ? 'answer-row incorrect' : 'answer-row'}
            key={question}
          >
            <span className="question-number">
              {String(question + 1).padStart(2, '0')}
            </span>
            <div
              className="options"
              role="radiogroup"
              aria-label={`Questão ${question + 1}`}
            >
              {LETTERS.map((letter) => {
                const optionId = `${groupId}-${question}-${letter}`;
                return (
                  <label
                    className={
                      answer === letter ? 'bubble selected' : 'bubble'
                    }
                    htmlFor={optionId}
                    key={letter}
                  >
                    <input
                      checked={answer === letter}
                      className="answer-radio"
                      id={optionId}
                      name={`${groupId}-question-${question}`}
                      onChange={() => {
                        const next = [...answers];
                        next[question] = letter;
                        onChange(next, question);
                      }}
                      type="radio"
                      value={letter}
                    />
                    {letter}
                  </label>
                );
              })}
            </div>
            {reading && (
              <span className={`confidence-badge ${confidenceClass}`}>
                {reading.source === 'manual'
                  ? 'Confirmada manualmente'
                  : reading.answer
                    ? `${reading.confidence}% confiança`
                    : 'Não identificada'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PrintableSheet({ session }: { session: ExamSession }) {
  const columns = session.questionCount > 25 ? 2 : 1;
  const rows = Math.ceil(session.questionCount / columns);
  const cardHeight = Math.min(250, Math.max(90, 58 + rows * 7.4));
  const position = (value: number, axis: 'x' | 'y') =>
    `${((axis === 'x' ? 0.05 : 0.04) + value * (axis === 'x' ? 0.9 : 0.92)) * 100}%`;
  return (
    <section className="print-sheet" aria-hidden="true">
      <div
        className={columns === 1 ? 'print-card' : 'print-card wide'}
        style={{ height: `${cardHeight}mm` }}
      >
        <div className="print-marker marker-tl" />
        <div className="print-marker marker-tr" />
        <div className="print-marker marker-bl" />
        <div className="print-marker marker-br" />
        <div className="print-heading">
          <span>FOLHA DE RESPOSTAS</span>
          <h1>{session.title}</h1>
          <div className="student-fields">
            <p>Aluno(a): __________________________________</p>
            <p>Turma: {session.className || '______________'}</p>
          </div>
          <p className="print-config">
            {session.questionCount} questões ·{' '}
            {formatScore(session.pointsPerQuestion)} ponto(s) cada
          </p>
        </div>
        <div className="print-questions">
          {Array.from({ length: session.questionCount }, (_, question) => {
            const { y, bubbleXs, numberX } = getQuestionCoordinates(
              question,
              session.questionCount,
            );
            return (
              <div className="print-question" key={question}>
                <strong
                  className="print-question-number"
                  style={{
                    left: position(numberX, 'x'),
                    top: position(y, 'y'),
                  }}
                >
                  {String(question + 1).padStart(2, '0')}
                </strong>
                {LETTERS.map((letter, option) => (
                  <span
                    className="print-option"
                    style={{
                      left: position(bubbleXs[option], 'x'),
                      top: position(y, 'y'),
                    }}
                    key={letter}
                  >
                    <i>{letter}</i>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
        <p className="print-tip">
          Preencha completamente um círculo e fotografe somente este quadro.
        </p>
      </div>
    </section>
  );
}

function LoginScreen({ onLogin, error }: { onLogin: () => void; error: string }) {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark large">
          <GraduationCap />
        </div>
        <p className="section-kicker">CORREÇÃO E INSIGHTS DA TURMA</p>
        <h1>Corrige Fácil</h1>
        <p>
          Crie sessões, corrija pelo celular e descubra quais questões foram os
          principais gargalos da turma.
        </p>
        <Button className="google-login" onClick={onLogin}>
          <LogIn /> Entrar com Google
        </Button>
        {error && <p className="error-message">{error}</p>}
        <small>
          <LockKeyhole /> As fotos permanecem no seu aparelho.
        </small>
      </section>
    </main>
  );
}

function SessionsView({
  sessions,
  loading,
  onCreate,
  onOpen,
}: {
  sessions: ExamSession[];
  loading: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="content-page">
      <div className="page-title-row">
        <div>
          <p className="section-kicker">PAINEL DO PROFESSOR</p>
          <h2>Minhas sessões</h2>
          <p>
            Uma sessão reúne a prova, as correções e os resultados de uma turma.
          </p>
        </div>
        <Button className="primary-action fit" onClick={onCreate}>
          <Plus /> Nova sessão
        </Button>
      </div>
      {loading ? (
        <div className="empty-state">
          <ScanLine className="spin" />
          <p>Carregando sessões…</p>
        </div>
      ) : sessions.length ? (
        <div className="session-grid">
          {sessions.map((session) => (
            <button
              className="session-card"
              key={session.id}
              onClick={() => onOpen(session.id)}
            >
              <div className="session-card-top">
                <span className={`status-pill ${session.status}`}>
                  {session.status === 'draft'
                    ? 'Rascunho'
                    : session.status === 'active'
                      ? 'Em andamento'
                      : 'Arquivada'}
                </span>
                <ClipboardCheck />
              </div>
              <h3>{session.title}</h3>
              <p>
                {session.className || 'Turma não informada'}
                {session.subject ? ` · ${session.subject}` : ''}
              </p>
              <div className="session-meta">
                <span>{session.questionCount} questões</span>
                <span>
                  Nota{' '}
                  {formatScore(
                    session.questionCount * session.pointsPerQuestion,
                  )}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <LayoutDashboard />
          <h3>Crie sua primeira sessão</h3>
          <p>Configure manualmente ou importe uma prova em branco.</p>
          <Button onClick={onCreate}>
            <Plus /> Nova sessão
          </Button>
        </div>
      )}
    </section>
  );
}

function CreateSessionView({
  initialBundle,
  onCancel,
  onSaved,
  userId,
}: {
  initialBundle?: SessionBundle | null;
  onCancel: () => void;
  onSaved: (bundle: SessionBundle) => void;
  userId: string;
}) {
  const [title, setTitle] = useState(initialBundle?.session.title ?? '');
  const [className, setClassName] = useState(
    initialBundle?.session.className ?? '',
  );
  const [subject, setSubject] = useState(
    initialBundle?.session.subject ?? '',
  );
  const [questionCount, setQuestionCount] = useState(
    initialBundle?.session.questionCount ?? 10,
  );
  const [points, setPoints] = useState(
    initialBundle?.session.pointsPerQuestion ?? 1,
  );
  const [answerKey, setAnswerKey] = useState<Answers>(
    initialBundle?.session.answerKey ?? Array(10).fill(null),
  );
  const [questions, setQuestions] = useState(() =>
    initialBundle?.questions ?? emptyQuestions(10),
  );
  const [saving, setSaving] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [error, setError] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateCount = (value: number) => {
    const next = Math.min(
      MAX_QUESTIONS,
      Math.max(MIN_QUESTIONS, Math.round(value || 1)),
    );
    setQuestionCount(next);
    setAnswerKey((current) => resizeAnswers(current, next));
    setQuestions((current) =>
      Array.from({ length: next }, (_, index) =>
        current[index] ?? {
          id: `q_${index + 1}`,
          order: index + 1,
          prompt: '',
          options: {},
          ocrConfidence: null,
        },
      ).map((item, index) => ({
        ...item,
        id: `q_${index + 1}`,
        order: index + 1,
      })),
    );
  };

  const handleBlankExam = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOcrRunning(true);
    setError('');
    try {
      const extracted = await readBlankExam(
        file,
        controller.signal,
        (progress) => {
          setOcrProgress(progress.progress * 100);
          setOcrStatus(progress.message);
        },
      );
      setQuestions(extracted);
      setQuestionCount(extracted.length);
      setAnswerKey(Array(extracted.length).fill(null));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError')
        setOcrStatus('Leitura cancelada.');
      else
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível ler a prova.',
        );
    } finally {
      setOcrRunning(false);
      abortRef.current = null;
    }
  };

  const updateQuestion = (
    index: number,
    patch: Partial<QuestionDefinition>,
  ) => {
    setQuestions((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const removeQuestion = (index: number) => {
    if (questions.length === 1) return;
    const next = questions
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({
        ...item,
        id: `q_${itemIndex + 1}`,
        order: itemIndex + 1,
      }));
    setQuestions(next);
    setQuestionCount(next.length);
    setAnswerKey((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const addQuestion = () => {
    if (questions.length < MAX_QUESTIONS) updateCount(questions.length + 1);
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    setQuestions((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, itemIndex) => ({
        ...item,
        id: `q_${itemIndex + 1}`,
        order: itemIndex + 1,
      }));
    });
    setAnswerKey((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const importLocalKey = () => {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem('corrige-facil-gabarito') ?? '[]',
      ) as Answers;
      if (parsed.length && parsed.every(Boolean)) {
        updateCount(parsed.length);
        setAnswerKey(parsed);
      }
    } catch {
      setError('O gabarito antigo deste aparelho não pôde ser importado.');
    }
  };

  const submit = async () => {
    if (!title.trim() || !className.trim()) {
      setError('Informe o nome da sessão e a turma.');
      return;
    }
    if (!answerKey.every(Boolean)) {
      setError('Preencha todas as respostas do gabarito oficial.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const draft: SessionDraft = {
        title: title.trim(),
        className: className.trim(),
        subject: subject.trim(),
        questionCount,
        pointsPerQuestion: points,
        answerKey,
        questions,
      };
      onSaved(
        initialBundle
          ? await updateSessionDraft(userId, initialBundle.session.id, draft)
          : await createSession(userId, draft),
      );
    } catch (cause) {
      setError(
          cause instanceof Error ? cause.message : 'Não foi possível salvar a sessão.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="content-page create-page">
      <button className="back-link" onClick={onCancel}>
        <ChevronLeft /> {initialBundle ? 'Voltar à sessão' : 'Minhas sessões'}
      </button>
      <div className="page-title-row">
        <div>
          <p className="section-kicker">
            {initialBundle ? 'EDITAR RASCUNHO' : 'NOVA SESSÃO'}
          </p>
          <h2>{initialBundle ? 'Revise a configuração' : 'Configure a prova'}</h2>
          <p>Você pode preencher manualmente ou importar a prova em branco.</p>
        </div>
      </div>
      <div className="create-layout">
        <div className="panel form-panel">
          <h3>Identificação</h3>
          <div className="form-grid">
            <label htmlFor="session-title">
              Nome da sessão
              <Input
                id="session-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex.: Avaliação de Matemática"
              />
            </label>
            <label htmlFor="session-class">
              Turma
              <Input
                id="session-class"
                value={className}
                onChange={(event) => setClassName(event.target.value)}
                placeholder="Ex.: 7º A"
              />
            </label>
            <label htmlFor="session-subject">
              Disciplina (opcional)
              <Input
                id="session-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Ex.: Matemática"
              />
            </label>
            <label htmlFor="session-question-count">
              Número de questões
              <Input
                id="session-question-count"
                type="number"
                min={1}
                max={50}
                value={questionCount}
                onChange={(event) => updateCount(Number(event.target.value))}
              />
            </label>
            <label htmlFor="session-points">
              Valor de cada questão
              <Input
                id="session-points"
                type="number"
                min="0.01"
                step="0.1"
                value={points}
                onChange={(event) =>
                  setPoints(Math.max(0.01, Number(event.target.value) || 1))
                }
              />
            </label>
            <div className="total-preview">
              <span>Nota máxima</span>
              <strong>{formatScore(questionCount * points)}</strong>
            </div>
          </div>
        </div>
        <aside className="panel import-panel">
          <FileText />
          <h3>Importar prova em branco</h3>
          <p>
            PDF, JPG ou PNG. O texto é lido neste aparelho e o arquivo original
            é descartado.
          </p>
          <input
            ref={uploadInput}
            hidden
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={handleBlankExam}
          />
          <Button
            className="primary-action"
            disabled={ocrRunning}
            onClick={() => uploadInput.current?.click()}
          >
            <Upload /> {ocrRunning ? 'Lendo prova…' : 'Escolher arquivo'}
          </Button>
          {ocrRunning && (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              <X /> Cancelar
            </Button>
          )}
          {ocrStatus && (
            <div className="progress-block">
              <div>
                <span style={{ width: `${ocrProgress}%` }} />
              </div>
              <p>{ocrStatus}</p>
            </div>
          )}
        </aside>
      </div>

      <div className="panel question-editor">
        <div className="editor-heading">
          <div>
            <h3>Questões</h3>
            <p>Revise o texto extraído. O gabarito é definido separadamente.</p>
          </div>
          <Button variant="outline" onClick={addQuestion}>
            <Plus /> Adicionar questão
          </Button>
        </div>
        {questions.map((question, index) => (
          <details
            className={
              question.ocrConfidence !== null &&
              question.ocrConfidence < 0.75
                ? 'question-card low-ocr'
                : 'question-card'
            }
            key={question.id}
            open={index < 2}
          >
            <summary>
              <strong>Questão {question.order}</strong>
              <span>{question.prompt || 'Sem enunciado'}</span>
              {question.ocrConfidence !== null && (
                <em>{Math.round(question.ocrConfidence * 100)}% OCR</em>
              )}
            </summary>
            <div className="question-fields">
              <label htmlFor={`question-${index}-prompt`}>
                Enunciado
                <textarea
                  id={`question-${index}-prompt`}
                  value={question.prompt}
                  onChange={(event) =>
                    updateQuestion(index, { prompt: event.target.value })
                  }
                />
              </label>
              <div className="option-editor">
                {LETTERS.map((letter) => (
                  <label
                    htmlFor={`question-${index}-option-${letter}`}
                    key={letter}
                  >
                    <span>{letter}</span>
                    <Input
                      id={`question-${index}-option-${letter}`}
                      value={question.options[letter] ?? ''}
                      onChange={(event) =>
                        updateQuestion(index, {
                          options: {
                            ...question.options,
                            [letter]: event.target.value,
                          },
                        })
                      }
                      placeholder={`Alternativa ${letter}`}
                    />
                  </label>
                ))}
              </div>
              <div className="question-actions">
                <Button
                  aria-label={`Mover questão ${index + 1} para cima`}
                  disabled={index === 0}
                  size="icon"
                  variant="outline"
                  onClick={() => moveQuestion(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  aria-label={`Mover questão ${index + 1} para baixo`}
                  disabled={index === questions.length - 1}
                  size="icon"
                  variant="outline"
                  onClick={() => moveQuestion(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => removeQuestion(index)}
                >
                  <Trash2 /> Remover questão
                </Button>
              </div>
            </div>
          </details>
        ))}
      </div>

      <div className="panel key-panel">
        <div className="editor-heading">
          <div>
            <h3>Gabarito oficial</h3>
            <p>Marque uma resposta correta para cada questão.</p>
          </div>
          <Button variant="outline" onClick={importLocalKey}>
            <RotateCcw /> Importar gabarito antigo
          </Button>
        </div>
        <AnswerGrid
          answers={answerKey}
          onChange={(next) => setAnswerKey(next)}
        />
      </div>
      {error && <p className="error-message centered">{error}</p>}
      <div className="sticky-actions">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          className="primary-action fit"
          disabled={saving || ocrRunning}
          onClick={submit}
        >
          <Save />{' '}
          {saving
            ? 'Salvando…'
            : initialBundle
              ? 'Salvar alterações'
              : 'Criar sessão'}
        </Button>
      </div>
    </section>
  );
}

function AnalyticsPanel({ bundle }: { bundle: SessionBundle }) {
  const analytics = useMemo(
    () =>
      calculateAnalytics(
        bundle.session,
        bundle.questions,
        bundle.corrections,
      ),
    [bundle],
  );
  const questionChart = analytics.questionStats.map((item) => ({
    name: `Q${item.order}`,
    acerto: Math.round(item.accuracy * 100),
  }));
  return (
    <div className="analytics-layout">
      <div className="metric-grid">
        <div className="metric-card">
          <span>Provas corrigidas</span>
          <strong>{analytics.total}</strong>
        </div>
        <div className="metric-card">
          <span>Média da turma</span>
          <strong>{formatScore(analytics.average)}</strong>
        </div>
        <div className="metric-card">
          <span>Mediana</span>
          <strong>{formatScore(analytics.median)}</strong>
        </div>
        <div className="metric-card">
          <span>Nota máxima</span>
          <strong>
            {formatScore(
              bundle.session.questionCount * bundle.session.pointsPerQuestion,
            )}
          </strong>
        </div>
      </div>
      {!analytics.total ? (
        <div className="empty-state">
          <BarChart3 />
          <h3>Ainda não há dados</h3>
          <p>Salve a primeira correção para gerar os insights da turma.</p>
        </div>
      ) : (
        <>
          <div className="analytics-grid">
            <article className="panel chart-panel">
              <h3>Acerto por questão</h3>
              <p>Percentual de alunos que acertaram cada item.</p>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={questionChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} unit="%" />
                    <Tooltip formatter={(value) => `${String(value)}%`} />
                    <Bar
                      dataKey="acerto"
                      fill="#087b76"
                      radius={[5, 5, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
            <article className="panel chart-panel">
              <h3>Distribuição das notas</h3>
              <p>Quantidade de provas por faixa percentual.</p>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.distribution}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" interval={1} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      name="Provas"
                      fill="#e7a63e"
                      radius={[5, 5, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </div>
          <div className="insight-grid">
            <article className="panel insight-card bottleneck">
              <h3>Principais gargalos</h3>
              {analytics.bottlenecks.map((item) => (
                <div key={item.order}>
                  <strong>
                    Questão {item.order} · {Math.round(item.accuracy * 100)}%
                  </strong>
                  <p>{item.prompt || 'Enunciado não informado.'}</p>
                  <small>
                    {item.mostCommonWrong
                      ? `Alternativa incorreta mais marcada: ${item.mostCommonWrong}`
                      : 'Sem alternativa incorreta predominante.'}
                  </small>
                </div>
              ))}
            </article>
            <article className="panel insight-card strength">
              <h3>Melhores resultados</h3>
              {analytics.strengths.map((item) => (
                <div key={item.order}>
                  <strong>
                    Questão {item.order} · {Math.round(item.accuracy * 100)}%
                  </strong>
                  <p>{item.prompt || 'Enunciado não informado.'}</p>
                  <small>
                    {item.correct} de {item.total} acertos
                  </small>
                </div>
              ))}
            </article>
          </div>
          <article className="panel question-table">
            <h3>Detalhamento por questão</h3>
            {analytics.questionStats.map((item) => (
              <details key={item.order}>
                <summary>
                  <strong>Q{item.order}</strong>
                  <span>{item.prompt || 'Sem enunciado'}</span>
                  <b>{Math.round(item.accuracy * 100)}% de acerto</b>
                </summary>
                <div className="option-distribution">
                  {[...LETTERS, 'blank' as const].map((letter) => (
                    <span key={letter}>
                      <i>{letter === 'blank' ? 'Em branco' : letter}</i>
                      <strong>{item.optionCounts[letter]}</strong>
                    </span>
                  ))}
                </div>
              </details>
            ))}
          </article>
        </>
      )}
    </div>
  );
}

function CorrectionPanel({
  bundle,
  userId,
  onReload,
}: {
  bundle: SessionBundle;
  userId: string;
  onReload: () => Promise<void>;
}) {
  const count = bundle.session.questionCount;
  const [readings, setReadings] = useState<AnswerReading[]>(
    Array.from({ length: count }, () => ({
      answer: null,
      confidence: 0,
      source: 'scan',
    })),
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState('Pronto para receber a foto.');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studentLabel, setStudentLabel] = useState('');
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const answers = answersFromReadings(readings);
  const correct = answers.filter(
    (answer, index) => answer && answer === bundle.session.answerKey[index],
  ).length;
  const score = correct * bundle.session.pointsPerQuestion;

  const reset = () => {
    setReadings(
      Array.from({ length: count }, () => ({
        answer: null,
        confidence: 0,
        source: 'scan',
      })),
    );
    setPreview(null);
    setStudentLabel('');
    setStatus('Pronto para receber uma nova foto.');
  };

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setScanning(true);
    setStatus('Analisando marcações no seu aparelho…');
    try {
      const result = await readAnswerSheet(file, count);
      setReadings(result.readings);
      setPreview(result.preview);
      setStatus(
        result.mode === 'free'
          ? 'Leitura livre concluída. Revise as respostas e a confiança.'
          : 'Leitura pelos marcadores concluída. Revise antes de salvar.',
      );
    } catch (cause) {
      setStatus(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível analisar a foto.',
      );
    } finally {
      setScanning(false);
    }
  };

  const changeAnswers = (next: Answers, question: number) => {
    setReadings((current) =>
      current.map((reading, index) =>
        index === question
          ? { answer: next[index], confidence: 100, source: 'manual' }
          : reading,
      ),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveCorrection(userId, bundle.session.id, {
        studentLabel: studentLabel.trim() || null,
        answers,
        readings,
        correctCount: correct,
        score,
        maximumScore: count * bundle.session.pointsPerQuestion,
      });
      reset();
      setStatus('Correção salva. Pronto para o próximo aluno.');
      await onReload();
    } catch (cause) {
      setStatus(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a correção.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="correction-layout">
      <article className="panel camera-panel">
        {!preview ? (
          <div className="camera-empty">
            <div className="camera-icon">
              <Camera />
            </div>
            <h3>Fotografe somente as respostas</h3>
            <p>
              Enquadre as linhas e as alternativas. A imagem será descartada
              depois da revisão.
            </p>
            <input
              ref={cameraInput}
              hidden
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
            />
            <input
              ref={galleryInput}
              hidden
              type="file"
              accept="image/*"
              onChange={handlePhoto}
            />
            <div className="source-actions">
              <Button
                className="primary-action"
                disabled={scanning}
                onClick={() => cameraInput.current?.click()}
              >
                <Camera /> {scanning ? 'Analisando…' : 'Tirar foto'}
              </Button>
              <Button
                className="gallery-action"
                variant="outline"
                disabled={scanning}
                onClick={() => galleryInput.current?.click()}
              >
                <ImagePlus /> Escolher da galeria
              </Button>
            </div>
          </div>
        ) : (
          <div className="photo-result">
            {/* oxlint-disable-next-line next/no-img-element -- object URL local, discarded after review */}
            <img src={preview} alt="Foto analisada" />
            <div className="photo-badge">
              <Check /> Foto analisada
            </div>
          </div>
        )}
        <p className="status-line" aria-live="polite">
          {status}
        </p>
      </article>
      <aside className="panel result-panel">
        <div className="result-top">
          <div>
            <span className="panel-index">02</span>
            <div>
              <h3>Resultado</h3>
              <p>
                {answers.filter(Boolean).length}/{count} respostas identificadas
              </p>
            </div>
          </div>
          <Button
            aria-label="Limpar correção"
            size="icon"
            variant="ghost"
            onClick={reset}
          >
            <RotateCcw />
          </Button>
        </div>
        <div
          className="grade-ring"
          style={
            {
              '--score': `${count ? (correct / count) * 100 : 0}%`,
            } as CSSProperties
          }
        >
          <div>
            <strong>{formatScore(score)}</strong>
            <span>
              de {formatScore(count * bundle.session.pointsPerQuestion)}
            </span>
          </div>
        </div>
        <div className="student-field">
          <label htmlFor="student-label">
            Aluno ou código (opcional)
            <Input
              id="student-label"
              value={studentLabel}
              onChange={(event) => setStudentLabel(event.target.value)}
              placeholder="Ex.: Ana ou 2026-014"
            />
          </label>
        </div>
        <h4>Revisão das respostas</h4>
        <AnswerGrid
          compact
          answers={answers}
          readings={readings}
          answerKey={bundle.session.answerKey}
          onChange={changeAnswers}
        />
        <Button
          className="primary-action save-correction"
          disabled={saving || !answers.some(Boolean)}
          onClick={save}
        >
          <Save /> {saving ? 'Salvando…' : 'Salvar correção'}
        </Button>
      </aside>
    </div>
  );
}

function SessionWorkspace({
  initialBundle,
  userId,
  onBack,
  onChanged,
  onEdit,
}: {
  initialBundle: SessionBundle;
  userId: string;
  onBack: () => void;
  onChanged: () => void;
  onEdit: (bundle: SessionBundle) => void;
}) {
  const [bundle, setBundle] = useState(initialBundle);
  const [tab, setTab] = useState<'correct' | 'analytics' | 'settings'>(
    'correct',
  );
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const next = await loadSession(userId, bundle.session.id);
    if (next) setBundle(next);
  }, [bundle.session.id, userId]);

  const removeCorrection = async (id: string) => {
    if (
      !window.confirm(
        'Excluir esta correção? As estatísticas serão recalculadas.',
      )
    )
      return;
    await deleteCorrection(userId, bundle.session.id, id);
    await reload();
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      await duplicateSession(userId, bundle);
      onChanged();
      onBack();
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    const nextStatus =
      bundle.session.status === 'archived' ? 'active' : 'archived';
    await setSessionStatus(userId, bundle.session.id, nextStatus);
    await reload();
    onChanged();
  };

  const remove = async () => {
    if (
      !window.confirm(
        'Excluir a sessão e todas as correções? Esta ação não pode ser desfeita.',
      )
    )
      return;
    await deleteSession(userId, bundle.session.id);
    onChanged();
    onBack();
  };

  return (
    <section className="content-page session-page">
      <button className="back-link" onClick={onBack}>
        <ChevronLeft /> Minhas sessões
      </button>
      <div className="session-header">
        <div>
          <span className={`status-pill ${bundle.session.status}`}>
            {bundle.session.status === 'draft'
              ? 'Rascunho'
              : bundle.session.status === 'active'
                ? 'Em andamento'
                : 'Arquivada'}
          </span>
          <h2>{bundle.session.title}</h2>
          <p>
            {bundle.session.className}
            {bundle.session.subject ? ` · ${bundle.session.subject}` : ''} ·{' '}
            {bundle.session.questionCount} questões
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <FileDown /> Imprimir folha
        </Button>
      </div>
      <nav className="tabs">
        <button
          className={tab === 'correct' ? 'active' : ''}
          onClick={() => setTab('correct')}
        >
          <ScanLine /> Corrigir
        </button>
        <button
          className={tab === 'analytics' ? 'active' : ''}
          onClick={() => setTab('analytics')}
        >
          <BarChart3 /> Estatísticas
        </button>
        <button
          className={tab === 'settings' ? 'active' : ''}
          onClick={() => setTab('settings')}
        >
          <ClipboardCheck /> Sessão
        </button>
      </nav>
      {tab === 'correct' && (
        <CorrectionPanel
          bundle={bundle}
          userId={userId}
          onReload={reload}
        />
      )}
      {tab === 'analytics' && <AnalyticsPanel bundle={bundle} />}
      {tab === 'settings' && (
        <div className="settings-layout">
          <article className="panel session-summary">
            <h3>Configuração da prova</h3>
            <dl>
              <div><dt>Questões</dt><dd>{bundle.session.questionCount}</dd></div>
              <div><dt>Valor por questão</dt><dd>{formatScore(bundle.session.pointsPerQuestion)}</dd></div>
              <div><dt>Nota máxima</dt><dd>{formatScore(bundle.session.questionCount * bundle.session.pointsPerQuestion)}</dd></div>
              <div><dt>Correções</dt><dd>{bundle.corrections.length}</dd></div>
            </dl>
            {bundle.session.lockedAt && (
              <p className="locked-note">
                <LockKeyhole /> Estrutura travada desde a primeira correção.
              </p>
            )}
            <div className="settings-actions">
              {!bundle.session.lockedAt && (
                <Button variant="outline" onClick={() => onEdit(bundle)}>
                  <FileText /> Editar configuração
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={duplicate}>
                <Copy /> Duplicar sessão
              </Button>
              <Button variant="outline" onClick={archive}>
                <Archive />
                {bundle.session.status === 'archived' ? 'Reativar' : 'Arquivar'}
              </Button>
              <Button variant="destructive" onClick={remove}>
                <Trash2 /> Excluir sessão
              </Button>
            </div>
          </article>
          <article className="panel history-panel">
            <h3>Correções salvas</h3>
            {bundle.corrections.length ? (
              bundle.corrections.map((correction) => (
                <div className="history-row" key={correction.id}>
                  <div>
                    <strong>
                      {correction.studentLabel || 'Aluno não identificado'}
                    </strong>
                    <span>
                      {new Date(correction.createdAt).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <b>
                    {formatScore(correction.score)} /{' '}
                    {formatScore(correction.maximumScore)}
                  </b>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Excluir correção"
                    onClick={() => removeCorrection(correction.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            ) : (
              <p>Nenhuma correção salva.</p>
            )}
          </article>
        </div>
      )}
      <PrintableSheet session={bundle.session} />
    </section>
  );
}

export default function Home() {
  const [user, setUser] = useState<AppUser | null>(
    firebaseConfigured ? null : LOCAL_USER,
  );
  const [authLoading, setAuthLoading] = useState(firebaseConfigured);
  const [authError, setAuthError] = useState('');
  const [view, setView] = useState<View>('sessions');
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [editingBundle, setEditingBundle] = useState<SessionBundle | null>(null);

  useEffect(() => {
    if (!firebaseConfigured || !auth) return;
    getRedirectResult(auth).catch(() => undefined);
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      if (nextUser)
        await ensureUser(nextUser.uid, {
          displayName: nextUser.displayName,
          email: nextUser.email,
        });
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!user) return;
    setSessionsLoading(true);
    try {
      setSessions(await listSessions(user.uid));
    } finally {
      setSessionsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSessions(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshSessions]);

  const login = async () => {
    if (!auth) return;
    setAuthError('');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/cancelled-popup-request'
      )
        await signInWithRedirect(auth, provider);
      else
        setAuthError('Não foi possível entrar com Google. Tente novamente.');
    }
  };

  const openSession = async (id: string) => {
    if (!user) return;
    setSessionsLoading(true);
    try {
      const loaded = await loadSession(user.uid, id);
      if (loaded) {
        setBundle(loaded);
        setView('session');
      }
    } finally {
      setSessionsLoading(false);
    }
  };

  if (authLoading)
    return (
      <main className="login-shell">
        <div className="empty-state">
          <ScanLine className="spin" />
          <p>Preparando o Corrige Fácil…</p>
        </div>
      </main>
    );
  if (!user) return <LoginScreen onLogin={login} error={authError} />;

  return (
    <main className="app-shell">
      <header className="topbar app-topbar">
        <button
          className="brand-button"
          onClick={() => {
            setView('sessions');
            setBundle(null);
            setEditingBundle(null);
          }}
        >
          <span className="brand-mark"><GraduationCap /></span>
          <span><small>CORREÇÃO INTELIGENTE</small><strong>Corrige Fácil</strong></span>
        </button>
        <nav>
          <button onClick={() => { setView('sessions'); setBundle(null); }}><LayoutDashboard /> Minhas sessões</button>
          <button onClick={() => { setEditingBundle(null); setView('create'); }}><Plus /> Nova sessão</button>
        </nav>
        <div className="user-menu">
          <span><UserRound /> {user.displayName || user.email || 'Professor'}</span>
          {firebaseConfigured ? (
            <Button size="sm" variant="ghost" onClick={() => auth && signOut(auth)}><LogOut /> Sair</Button>
          ) : (
            <span className="local-pill">Modo local</span>
          )}
        </div>
      </header>
      {!firebaseConfigured && (
        <div className="setup-banner">
          <LockKeyhole /> Firebase ainda não configurado: seus dados estão sendo
          mantidos somente neste aparelho para validação.
        </div>
      )}
      {view === 'sessions' && (
        <SessionsView
          sessions={sessions}
          loading={sessionsLoading}
          onCreate={() => {
            setEditingBundle(null);
            setView('create');
          }}
          onOpen={openSession}
        />
      )}
      {view === 'create' && (
        <CreateSessionView
          initialBundle={editingBundle}
          userId={user.uid}
          onCancel={() => {
            setView(editingBundle ? 'session' : 'sessions');
            setEditingBundle(null);
          }}
          onSaved={(saved) => {
            setBundle(saved);
            setEditingBundle(null);
            setView('session');
            void refreshSessions();
          }}
        />
      )}
      {view === 'session' && bundle && (
        <SessionWorkspace
          initialBundle={bundle}
          userId={user.uid}
          onBack={() => {
            setView('sessions');
            setBundle(null);
            void refreshSessions();
          }}
          onChanged={refreshSessions}
          onEdit={(draft) => {
            setEditingBundle(draft);
            setView('create');
          }}
        />
      )}
      <footer>
        <LockKeyhole /> Fotos e PDFs são processados localmente. Somente textos
        revisados e resultados são salvos.
      </footer>
    </main>
  );
}
