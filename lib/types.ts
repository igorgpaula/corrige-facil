export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export type Letter = (typeof LETTERS)[number];
export type Answers = Array<Letter | null>;

export type AnswerReading = {
  answer: Letter | null;
  confidence: number;
  source: 'scan' | 'manual';
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
};
