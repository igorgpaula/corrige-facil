'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { Camera, ImagePlus, RotateCcw, Save, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { AnswerGrid } from './answer-grid';
import { PhotoReview } from './photo-review';
import { answersFromReadings, readAnswerSheet } from '@/lib/omr';
import { needsReview } from '@/lib/sheet-geometry';
import {
  associateAnswerSheetTemplate,
  listAnswerSheetTemplates,
  saveAnswerSheetTemplate,
  saveCorrection,
} from '@/lib/repository';
import type {
  AnswerReading,
  AnswerSheetTemplate,
  Answers,
  ScanResult,
  SessionBundle,
  SheetAnchors,
  SheetMode,
} from '@/lib/types';

export function CorrectionPanel({
  bundle,
  userId,
  onReload,
}: {
  bundle: SessionBundle;
  userId: string;
  onReload: () => Promise<void>;
}) {
  const count = bundle.session.questionCount;
  const [templates, setTemplates] = useState<AnswerSheetTemplate[]>([]);
  const [selectedId, setSelectedId] = useState(
    bundle.session.answerSheetTemplateId ?? 'builtin:legacy',
  );
  const [result, setResult] = useState<ScanResult | null>(null);
  const [readings, setReadings] = useState<AnswerReading[]>([]);
  const [status, setStatus] = useState(
    'Escolha o tipo de quadro e envie uma foto.',
  );
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateReviewed, setTemplateReviewed] = useState(false);
  const [alignmentEditing, setAlignmentEditing] = useState(false);
  const [studentLabel, setStudentLabel] = useState('');
  const [revision, setRevision] = useState(0);
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const blankInput = useRef<HTMLInputElement>(null);
  const template = templates.find((item) => item.id === selectedId) ?? null;
  const mode: SheetMode =
    template?.mode ??
    (selectedId === 'builtin:standard-v2' ? 'standard' : 'legacy');
  const answers = answersFromReadings(readings);
  const pending = readings.filter(needsReview).length;
  const correct = answers.filter(
    (answer, index) => answer && answer === bundle.session.answerKey[index],
  ).length;
  const score = correct * bundle.session.pointsPerQuestion;

  useEffect(() => {
    let active = true;
    listAnswerSheetTemplates(userId)
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch(() => {
        if (active)
          setStatus(
            'Não foi possível carregar os modelos. Você ainda pode usar os dois tipos básicos.',
          );
      });
    return () => {
      active = false;
      generation.current++;
      abortRef.current?.abort();
      fileRef.current = null;
    };
  }, [userId]);

  const reset = () => {
    generation.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    fileRef.current = null;
    setResult(null);
    setReadings([]);
    setScanning(false);
    setRegistering(false);
    setTemplateReviewed(false);
    setStudentLabel('');
    setTemplateName('');
    setStatus('Foto descartada. Pronto para uma nova análise.');
  };

  const analyze = async (
    file: File,
    calibrate: boolean,
    anchors?: SheetAnchors,
  ) => {
    abortRef.current?.abort();
    const request = ++generation.current;
    const controller = new AbortController();
    abortRef.current = controller;
    fileRef.current = file;
    setScanning(true);
    setResult(null);
    setReadings([]);
    setTemplateReviewed(false);
    setRegistering(calibrate);
    setStatus(
      'Analisando localmente… Na primeira vez, o motor de visão precisa ser carregado.',
    );
    try {
      const next = await readAnswerSheet(
        file,
        count,
        { mode, template: calibrate ? null : template, calibrate, anchors },
        controller.signal,
      );
      if (request !== generation.current || controller.signal.aborted) return;
      setResult(next);
      setReadings(next.readings);
      setRevision((value) => value + 1);
      setStatus(next.diagnostics.message);
    } catch (cause) {
      if (request !== generation.current || controller.signal.aborted) return;
      fileRef.current = null;
      setStatus(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível analisar esta foto.',
      );
    } finally {
      if (request === generation.current) {
        setScanning(false);
        abortRef.current = null;
      }
    }
  };

  const handlePhoto = (
    event: ChangeEvent<HTMLInputElement>,
    calibrate = false,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) {
      setStudentLabel('');
      void analyze(file, calibrate);
    }
  };
  const align = (anchors: SheetAnchors) => {
    if (fileRef.current) void analyze(fileRef.current, registering, anchors);
  };
  const chooseTemplate = async (id: string) => {
    setSaving(true);
    try {
      await associateAnswerSheetTemplate(userId, bundle.session.id, id);
      setSelectedId(id);
      await onReload();
    } catch (cause) {
      setStatus(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível associar o modelo.',
      );
    } finally {
      setSaving(false);
    }
  };
  const changeAnswers = (next: Answers, question: number) =>
    setReadings((current) =>
      current.map((reading, index) =>
        index === question
          ? {
              answer: next[index],
              confidence: 100,
              source: 'manual',
              status: 'read',
            }
          : reading,
      ),
    );
  const resolveNull = (question: number, status: 'blank' | 'multiple') =>
    setReadings((current) =>
      current.map((reading, index) =>
        index === question
          ? { answer: null, confidence: 100, source: 'manual', status }
          : reading,
      ),
    );

  const saveTemplate = async () => {
    if (
      !result?.calibration ||
      result.alignment !== 'verified' ||
      !templateReviewed ||
      alignmentEditing
    )
      return;
    setSaving(true);
    try {
      const saved = await saveAnswerSheetTemplate(userId, {
        name: templateName.trim(),
        version: mode === 'standard' ? 2 : 1,
        mode,
        questionCount: count,
        geometry: {
          columns: 5,
          rows: count,
          radiusRatio: result.calibration.radiusRatio,
        },
        baseline: result.calibration.baseline,
      });
      await associateAnswerSheetTemplate(userId, bundle.session.id, saved.id);
      setTemplates((current) => [saved, ...current]);
      setSelectedId(saved.id);
      reset();
      setStatus(
        'Modelo cadastrado e associado. Envie agora a foto preenchida do aluno.',
      );
      await onReload();
    } catch (cause) {
      setStatus(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar o modelo.',
      );
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    if (
      !result ||
      registering ||
      pending ||
      alignmentEditing ||
      result.alignment !== 'verified'
    )
      return;
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
      setStatus('Correção salva. A foto foi descartada.');
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
        <div className="sheet-model-controls">
          <label htmlFor="sheet-model">Modelo do quadro de respostas</label>
          <select
            id="sheet-model"
            value={selectedId}
            disabled={Boolean(result) || scanning || saving}
            onChange={(event) => void chooseTemplate(event.target.value)}
          >
            <option value="builtin:legacy">
              Opção 1: Gabarito de forma livre
            </option>
            {/* Keep the persisted marker-reader family ID; the printed marks identify its layout. */}
            <option value="builtin:standard-v2">
              Opção 2: Gabarito padronizado pelo app
            </option>
            {templates.map((item) => (
              <option
                key={item.id}
                value={item.id}
                disabled={item.questionCount !== count}
              >
                {item.name} · {item.questionCount} questões
              </option>
            ))}
          </select>
          <small>
            O modelo não altera as questões nem o gabarito da sessão. Para
            trocar, descarte a foto atual.
          </small>
          <p className="sheet-model-help">
            {mode === 'standard'
              ? 'Uma coluna, de 1 a 50 questões. Em “Imprimir folha”, salve como PDF e leve o quadro completo ao Canva. Posicione onde quiser, redimensione proporcionalmente e preserve os quatro quadrados e os dois pontos de identificação.'
              : 'Use seu quadro já impresso, com A–E em cada questão, sem exigir o padrão do app. Você pode cadastrar uma foto do quadro em branco; se necessário, ajuste os quatro pontos na análise.'}
          </p>
        </div>
        <input
          ref={cameraInput}
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => handlePhoto(event)}
        />
        <input
          ref={galleryInput}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => handlePhoto(event)}
        />
        <input
          ref={blankInput}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => handlePhoto(event, true)}
        />
        {!result && !scanning && (
          <div className="camera-empty">
            <div className="camera-icon">
              <Camera />
            </div>
            <h3>Fotografe somente as respostas</h3>
            <p>
              {mode === 'standard'
                ? 'Enquadre de perto o quadro completo: quatro quadrados e os dois pontos de identificação no alto. Folhas padronizadas anteriores continuam compatíveis.'
                : 'Inclua A–E de todas as questões. Se houver dúvida, o app pedirá quatro pontos.'}
            </p>
            <div className="source-actions">
              <Button
                disabled={saving}
                className="primary-action"
                onClick={() => cameraInput.current?.click()}
              >
                <Camera /> Tirar foto
              </Button>
              <Button
                disabled={saving}
                variant="outline"
                onClick={() => galleryInput.current?.click()}
              >
                <ImagePlus /> Escolher da galeria
              </Button>
            </div>
            <Button
              disabled={saving}
              variant="outline"
              onClick={() => blankInput.current?.click()}
            >
              Cadastrar modelo de respostas
            </Button>
            <small>
              Use uma foto do quadro em branco. Isso é separado da importação
              das questões da prova.
            </small>
          </div>
        )}
        {scanning && (
          <div className="camera-empty" aria-live="polite">
            <p>Analisando geometria e marcações…</p>
            <Button variant="outline" onClick={reset}>
              <X /> Cancelar análise
            </Button>
          </div>
        )}
        {result && (
          <PhotoReview
            key={revision}
            result={result}
            mode={mode}
            count={count}
            busy={saving || scanning}
            onAlign={align}
            onEditingChange={setAlignmentEditing}
          />
        )}
        <p className="status-line" aria-live="polite">
          {status}
        </p>
        {result && (
          <>
            <p className="local-diagnostics">
              Qualidade do alinhamento: {result.diagnostics.geometry}% ·
              Contornos compatíveis: {result.diagnostics.matched}. Confiança
              estimada, não probabilidade garantida.
            </p>
            <Button variant="outline" disabled={saving} onClick={reset}>
              <X /> Cancelar e descartar foto
            </Button>
          </>
        )}
      </article>
      <aside className="panel result-panel">
        <div className="result-top">
          <h3>{registering ? 'Cadastrar modelo' : 'Conferência'}</h3>
          <Button
            aria-label="Limpar correção"
            size="icon"
            variant="ghost"
            disabled={saving}
            onClick={reset}
          >
            <RotateCcw />
          </Button>
        </div>
        {registering ? (
          <div className="template-registration">
            <p>
              Confira se a sobreposição está no centro dos círculos vazios. Se
              necessário, ajuste os quatro pontos.
            </p>
            <label htmlFor="template-name">
              Nome do modelo
              <Input
                id="template-name"
                maxLength={100}
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Ex.: Quadro de 10 questões da escola"
              />
            </label>
            <label className="template-check">
              <input
                type="checkbox"
                checked={templateReviewed}
                onChange={(event) => setTemplateReviewed(event.target.checked)}
              />{' '}
              Conferi o alinhamento e o quadro está em branco.
            </label>
            <Button
              className="primary-action"
              disabled={
                saving ||
                scanning ||
                result?.alignment !== 'verified' ||
                !result?.calibration ||
                !templateReviewed ||
                alignmentEditing ||
                !templateName.trim()
              }
              onClick={() => void saveTemplate()}
            >
              <Save /> Salvar modelo
            </Button>
            <small>
              Somente geometria e medidas numéricas da impressão serão salvas. A
              foto será descartada.
            </small>
          </div>
        ) : (
          <>
            <p className="provisional-grade">
              {result &&
              !pending &&
              !alignmentEditing &&
              result.alignment === 'verified'
                ? 'Revisão concluída — confira antes de salvar'
                : 'Nota provisória — revisão pendente'}
            </p>
            <div
              className="grade-ring"
              style={
                {
                  '--score': `${count ? (correct / count) * 100 : 0}%`,
                } as CSSProperties
              }
            >
              <div>
                <strong>
                  {score.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                </strong>
                <span>
                  de{' '}
                  {(count * bundle.session.pointsPerQuestion).toLocaleString(
                    'pt-BR',
                  )}
                </span>
              </div>
            </div>
            {result && (
              <>
                <p className="review-count" role="status">
                  {pending
                    ? `${pending} questão(ões) precisam de confirmação.`
                    : 'Todas as respostas estão resolvidas.'}
                </p>
                <label htmlFor="student-label">
                  Aluno ou código (opcional)
                  <Input
                    id="student-label"
                    maxLength={120}
                    value={studentLabel}
                    onChange={(event) => setStudentLabel(event.target.value)}
                  />
                </label>
                {result.alignment === 'verified' ? (
                  <fieldset disabled={saving} className="review-fieldset">
                    <legend>Revisão das respostas</legend>
                    <AnswerGrid
                      compact
                      answers={answers}
                      readings={readings}
                      answerKey={bundle.session.answerKey}
                      onChange={changeAnswers}
                      onResolveNull={resolveNull}
                    />
                  </fieldset>
                ) : (
                  <p>
                    Ajuste o alinhamento na foto antes de confirmar as
                    alternativas.
                  </p>
                )}
              </>
            )}
            <Button
              className="primary-action save-correction"
              disabled={
                saving ||
                scanning ||
                !result ||
                result.alignment !== 'verified' ||
                pending > 0 ||
                alignmentEditing
              }
              onClick={() => void save()}
            >
              <Save />{' '}
              {saving
                ? 'Salvando…'
                : pending
                  ? `Revisar ${pending} pendência(s)`
                  : 'Salvar correção'}
            </Button>
          </>
        )}
      </aside>
    </div>
  );
}
