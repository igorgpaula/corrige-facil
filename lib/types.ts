export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export type Letter = (typeof LETTERS)[number];
export type Answers = Array<Letter | null>;

export type AnswerReading = {
  answer: Letter | null;
  confidence: number;
  source: 'scan' | 'manual';
  status?: 'read' | 'blank' | 'multiple' | 'uncertain';
  suggestedAnswer?: Letter | null;
};

export type SheetPoint = { x: number; y: number };
export type SheetAnchors = [SheetPoint, SheetPoint, SheetPoint, SheetPoint];
export type SheetMode = 'legacy' | 'standard';
export type AnswerSheetTemplate = {
  id: string;
  name: string;
  version: number;
  mode: SheetMode;
  questionCount: number;
  geometry: { columns: number; rows: number; radiusRatio: number };
  baseline: Record<Letter, number>;
  createdAt: string;
};
export type ScanOptions = {
  mode: SheetMode;
  anchors?: SheetAnchors;
  template?: AnswerSheetTemplate | null;
  calibrate?: boolean;
};

export type QuestionDefinition = {
  id: string;
  order: number;
  prompt: string;
  options: Partial<Record<Letter, string>>;
  ocrConfidence: number | null;
};

export type SessionStatus = 'draft' | 'active' | 'archived';

export type ExamSession = {
  id: string;
  title: string;
  className: string;
  subject: string;
  questionCount: number;
  pointsPerQuestion: number;
  answerKey: Answers;
  status: SessionStatus;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
  answerSheetTemplateId?: string | null;
};

export type Correction = {
  id: string;
  studentLabel: string | null;
  answers: Answers;
  readings: AnswerReading[];
  correctCount: number;
  score: number;
  maximumScore: number;
  createdAt: string;
};

export type SessionBundle = {
  session: ExamSession;
  questions: QuestionDefinition[];
  corrections: Correction[];
};

export type SessionDraft = {
  title: string;
  className: string;
  subject: string;
  questionCount: number;
  pointsPerQuestion: number;
  answerKey: Answers;
  questions: QuestionDefinition[];
};

export type ScanResult = {
  readings: AnswerReading[];
  preview: string;
  mode: 'markers' | 'free';
  imageSize: { width: number; height: number };
  alignment: 'verified' | 'needs-adjustment' | 'failed';
  anchors: SheetAnchors | null;
  overlay: Array<{ question: number; centers: SheetPoint[]; radius: number }>;
  diagnostics: {
    engine: string;
    geometry: number;
    matched: number;
    residual: number;
    message: string;
    // Transient numeric evidence, never included in saved corrections.
    questions?: Array<{
      adaptive: number[][];
      contrast: Array<{
        paper: number;
        coverage: number;
        strictCoverage: number;
        weakestQuadrant: number;
        darkness: number;
        valid: boolean;
      }>;
      adaptiveConfidence: number;
      contrastConfidence: number;
    }>;
  };
  calibration?: { radiusRatio: number; baseline: Record<Letter, number> };
};
