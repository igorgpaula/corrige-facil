import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { ACCESS_COLLECTION, normalizeAccessEmail } from './access';
import { db, firebaseConfigured } from './firebase';
import { assertFinalReadings } from './sheet-geometry';
import type {
  Correction,
  ExamSession,
  QuestionDefinition,
  SessionBundle,
  SessionDraft,
  AnswerSheetTemplate,
} from './types';

const LOCAL_KEY = 'corrige-facil-sessions-v2';

type LocalDatabase = Record<string, SessionBundle[]>;

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readLocal(): LocalDatabase {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(LOCAL_KEY) ?? '{}',
    ) as LocalDatabase;
  } catch {
    return {};
  }
}

function writeLocal(value: LocalDatabase) {
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
}

function normalizeDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : now();
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function sessionFromDoc(
  id: string,
  data: Record<string, unknown>,
): ExamSession {
  return {
    id,
    title: textValue(data.title, 'Sessão sem título'),
    className: textValue(data.className),
    subject: textValue(data.subject),
    questionCount: Number(data.questionCount ?? 0),
    pointsPerQuestion: Number(data.pointsPerQuestion ?? 1),
    answerKey: (data.answerKey ?? []) as ExamSession['answerKey'],
    status: (data.status ?? 'draft') as ExamSession['status'],
    lockedAt: data.lockedAt ? normalizeDate(data.lockedAt) : null,
    createdAt: normalizeDate(data.createdAt),
    updatedAt: normalizeDate(data.updatedAt),
    answerSheetTemplateId:
      typeof data.answerSheetTemplateId === 'string'
        ? data.answerSheetTemplateId
        : null,
  };
}

export async function ensureUser(
  uid: string,
  profile: { displayName: string | null; email: string | null },
) {
  if (!firebaseConfigured || !db) return;
  await setDoc(
    doc(db, 'users', uid),
    { ...profile, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function hasPlatformAccess(email: string | null) {
  if (!firebaseConfigured || !db) return true;
  const normalizedEmail = normalizeAccessEmail(email);
  if (!normalizedEmail) return false;
  const access = await getDoc(doc(db, ACCESS_COLLECTION, normalizedEmail));
  return access.exists() && access.data().enabled === true;
}

export async function listSessions(uid: string): Promise<ExamSession[]> {
  if (!firebaseConfigured || !db) {
    return (readLocal()[uid] ?? [])
      .map((bundle) => bundle.session)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const snapshot = await getDocs(
    query(
      collection(db, 'users', uid, 'sessions'),
      orderBy('updatedAt', 'desc'),
    ),
  );
  return snapshot.docs.map((item) => sessionFromDoc(item.id, item.data()));
}

export async function createSession(
  uid: string,
  draft: SessionDraft,
): Promise<SessionBundle> {
  const timestamp = now();
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    const session: ExamSession = {
      id: makeId('session'),
      ...draft,
      status: 'draft',
      lockedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const bundle = {
      session,
      questions: draft.questions,
      corrections: [],
    };
    database[uid] = [bundle, ...(database[uid] ?? [])];
    writeLocal(database);
    return bundle;
  }

  const sessionRef = doc(collection(db, 'users', uid, 'sessions'));
  const batch = writeBatch(db);
  batch.set(sessionRef, {
    title: draft.title,
    className: draft.className,
    subject: draft.subject,
    questionCount: draft.questionCount,
    pointsPerQuestion: draft.pointsPerQuestion,
    answerKey: draft.answerKey,
    status: 'draft',
    lockedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  for (const question of draft.questions) {
    batch.set(doc(sessionRef, 'questions', question.id), question);
  }
  await batch.commit();
  return {
    session: {
      id: sessionRef.id,
      ...draft,
      status: 'draft',
      lockedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    questions: draft.questions,
    corrections: [],
  };
}

export async function updateSessionDraft(
  uid: string,
  sessionId: string,
  draft: SessionDraft,
): Promise<SessionBundle> {
  const timestamp = now();
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    const bundle = (database[uid] ?? []).find(
      (item) => item.session.id === sessionId,
    );
    if (!bundle) throw new Error('Sessão não encontrada.');
    if (bundle.session.lockedAt || bundle.corrections.length)
      throw new Error(
        'Esta sessão já está travada para alterações estruturais.',
      );
    bundle.session = {
      ...bundle.session,
      ...draft,
      status: 'draft',
      updatedAt: timestamp,
      answerSheetTemplateId:
        bundle.session.questionCount === draft.questionCount
          ? (bundle.session.answerSheetTemplateId ?? null)
          : null,
    };
    bundle.questions = draft.questions;
    writeLocal(database);
    return bundle;
  }

  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  const [sessionSnapshot, existingQuestions] = await Promise.all([
    getDoc(sessionRef),
    getDocs(collection(sessionRef, 'questions')),
  ]);
  if (!sessionSnapshot.exists()) throw new Error('Sessão não encontrada.');
  if (sessionSnapshot.data().lockedAt)
    throw new Error('Esta sessão já está travada para alterações estruturais.');
  const batch = writeBatch(db);
  batch.update(sessionRef, {
    title: draft.title,
    className: draft.className,
    subject: draft.subject,
    questionCount: draft.questionCount,
    pointsPerQuestion: draft.pointsPerQuestion,
    answerKey: draft.answerKey,
    status: 'draft',
    updatedAt: serverTimestamp(),
    answerSheetTemplateId:
      sessionSnapshot.data().questionCount === draft.questionCount
        ? (sessionSnapshot.data().answerSheetTemplateId ?? null)
        : null,
  });
  existingQuestions.forEach((item) => batch.delete(item.ref));
  for (const question of draft.questions)
    batch.set(doc(sessionRef, 'questions', question.id), question);
  await batch.commit();
  return {
    session: {
      id: sessionId,
      ...draft,
      status: 'draft',
      lockedAt: null,
      createdAt: normalizeDate(sessionSnapshot.data().createdAt),
      updatedAt: timestamp,
      answerSheetTemplateId:
        sessionSnapshot.data().questionCount === draft.questionCount
          ? (sessionSnapshot.data().answerSheetTemplateId ?? null)
          : null,
    },
    questions: draft.questions,
    corrections: [],
  };
}

export async function loadSession(
  uid: string,
  sessionId: string,
): Promise<SessionBundle | null> {
  if (!firebaseConfigured || !db) {
    return (
      (readLocal()[uid] ?? []).find(
        (bundle) => bundle.session.id === sessionId,
      ) ?? null
    );
  }
  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  const [sessionSnapshot, questionSnapshot, correctionSnapshot] =
    await Promise.all([
      getDoc(sessionRef),
      getDocs(query(collection(sessionRef, 'questions'), orderBy('order'))),
      getDocs(
        query(
          collection(sessionRef, 'corrections'),
          orderBy('createdAt', 'desc'),
        ),
      ),
    ]);
  if (!sessionSnapshot.exists()) return null;
  return {
    session: sessionFromDoc(sessionSnapshot.id, sessionSnapshot.data()),
    questions: questionSnapshot.docs.map(
      (item) => item.data() as QuestionDefinition,
    ),
    corrections: correctionSnapshot.docs.map((item) => ({
      id: item.id,
      ...(item.data() as Omit<Correction, 'id' | 'createdAt'>),
      createdAt: normalizeDate(item.data().createdAt),
    })),
  };
}

export async function saveCorrection(
  uid: string,
  sessionId: string,
  correction: Omit<Correction, 'id' | 'createdAt'>,
) {
  correction = {
    studentLabel: correction.studentLabel,
    answers: [...correction.answers],
    correctCount: correction.correctCount,
    score: correction.score,
    maximumScore: correction.maximumScore,
    readings: correction.readings.map((reading) => ({
      answer: reading.answer,
      confidence: reading.confidence,
      source: reading.source,
      status: reading.status ?? (reading.answer ? 'read' : 'blank'),
    })),
  };
  assertFinalReadings(correction.readings, correction.answers.length);
  if (
    correction.answers.some(
      (answer, index) => answer !== correction.readings[index].answer,
    )
  )
    throw new Error('As respostas e a revisão precisam coincidir.');
  const timestamp = now();
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    const bundle = (database[uid] ?? []).find(
      (item) => item.session.id === sessionId,
    );
    if (!bundle) throw new Error('Sessão não encontrada.');
    assertFinalReadings(correction.readings, bundle.session.questionCount);
    const saved: Correction = {
      ...correction,
      id: makeId('correction'),
      createdAt: timestamp,
    };
    bundle.corrections.unshift(saved);
    bundle.session.status = 'active';
    bundle.session.lockedAt ??= timestamp;
    bundle.session.updatedAt = timestamp;
    writeLocal(database);
    return saved;
  }
  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  const sessionSnapshot = await getDoc(sessionRef);
  if (!sessionSnapshot.exists()) throw new Error('Sessão não encontrada.');
  assertFinalReadings(
    correction.readings,
    sessionSnapshot.data().questionCount,
  );
  const correctionRef = doc(collection(sessionRef, 'corrections'));
  const batch = writeBatch(db);
  batch.set(correctionRef, {
    ...correction,
    createdAt: serverTimestamp(),
  });
  for (let offset = 0; offset < correction.readings.length; offset += 10) {
    batch.set(doc(correctionRef, 'readingChecks', String(offset / 10)), {
      answers: correction.answers.slice(offset, offset + 10),
      readings: correction.readings.slice(offset, offset + 10),
    });
  }
  batch.update(sessionRef, {
    status: 'active',
    lockedAt: sessionSnapshot.data()?.lockedAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return { ...correction, id: correctionRef.id, createdAt: timestamp };
}

export async function deleteCorrection(
  uid: string,
  sessionId: string,
  correctionId: string,
) {
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    const bundle = (database[uid] ?? []).find(
      (item) => item.session.id === sessionId,
    );
    if (bundle)
      bundle.corrections = bundle.corrections.filter(
        (item) => item.id !== correctionId,
      );
    writeLocal(database);
    return;
  }
  const correctionRef = doc(
    db,
    'users',
    uid,
    'sessions',
    sessionId,
    'corrections',
    correctionId,
  );
  const checks = await getDocs(collection(correctionRef, 'readingChecks'));
  const batch = writeBatch(db);
  checks.forEach((item) => batch.delete(item.ref));
  batch.delete(correctionRef);
  await batch.commit();
}

export async function setSessionStatus(
  uid: string,
  sessionId: string,
  status: ExamSession['status'],
) {
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    const bundle = (database[uid] ?? []).find(
      (item) => item.session.id === sessionId,
    );
    if (bundle) {
      bundle.session.status = status;
      bundle.session.updatedAt = now();
    }
    writeLocal(database);
    return;
  }
  await updateDoc(doc(db, 'users', uid, 'sessions', sessionId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSession(uid: string, sessionId: string) {
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    database[uid] = (database[uid] ?? []).filter(
      (item) => item.session.id !== sessionId,
    );
    writeLocal(database);
    return;
  }
  const sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
  const [questions, corrections] = await Promise.all([
    getDocs(collection(sessionRef, 'questions')),
    getDocs(collection(sessionRef, 'corrections')),
  ]);
  const correctionRefs = [];
  for (const item of corrections.docs) {
    const checks = await getDocs(collection(item.ref, 'readingChecks'));
    correctionRefs.push(...checks.docs.map((check) => check.ref), item.ref);
  }
  for (let offset = 0; offset < correctionRefs.length; offset += 400) {
    const cleanup = writeBatch(db);
    correctionRefs
      .slice(offset, offset + 400)
      .forEach((ref) => cleanup.delete(ref));
    await cleanup.commit();
  }
  const batch = writeBatch(db);
  questions.forEach((item) => batch.delete(item.ref));
  batch.delete(sessionRef);
  await batch.commit();
}

export async function duplicateSession(uid: string, source: SessionBundle) {
  const bundle = await createSession(uid, {
    title: `${source.session.title} — cópia`,
    className: source.session.className,
    subject: source.session.subject,
    questionCount: source.session.questionCount,
    pointsPerQuestion: source.session.pointsPerQuestion,
    answerKey: [...source.session.answerKey],
    questions: source.questions.map((question, index) => ({
      ...question,
      id: `q_${index + 1}`,
      order: index + 1,
    })),
  });
  if (source.session.answerSheetTemplateId) {
    await associateAnswerSheetTemplate(
      uid,
      bundle.session.id,
      source.session.answerSheetTemplateId,
    );
    bundle.session.answerSheetTemplateId = source.session.answerSheetTemplateId;
  }
  return bundle;
}

const TEMPLATE_KEY = 'corrige-facil-templates-v1';
function localTemplates(): Record<string, AnswerSheetTemplate[]> {
  try {
    return JSON.parse(window.localStorage.getItem(TEMPLATE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function validateAnswerSheetTemplate(
  template: Omit<AnswerSheetTemplate, 'id' | 'createdAt'>,
) {
  const fields = [
    'name',
    'version',
    'mode',
    'questionCount',
    'geometry',
    'baseline',
  ];
  if (
    Object.keys(template).some((key) => !fields.includes(key)) ||
    !template.name.trim() ||
    template.name.length > 100 ||
    !Number.isInteger(template.version) ||
    template.version < 1 ||
    template.version > 2 ||
    !['legacy', 'standard'].includes(template.mode) ||
    !Number.isInteger(template.questionCount) ||
    template.questionCount < 1 ||
    template.questionCount > 50 ||
    Object.keys(template.geometry).sort().join(',') !==
      'columns,radiusRatio,rows' ||
    template.geometry.columns !== 5 ||
    template.geometry.rows !== template.questionCount ||
    !Number.isFinite(template.geometry.radiusRatio) ||
    template.geometry.radiusRatio < 0.005 ||
    template.geometry.radiusRatio > 0.2 ||
    Object.keys(template.baseline).sort().join(',') !== 'A,B,C,D,E' ||
    Object.values(template.baseline).some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    )
  )
    throw new Error('O modelo contém campos ou medidas inválidas.');
}

export async function listAnswerSheetTemplates(
  uid: string,
): Promise<AnswerSheetTemplate[]> {
  if (!firebaseConfigured || !db) return localTemplates()[uid] ?? [];
  const snapshot = await getDocs(
    collection(db, 'users', uid, 'answerSheetTemplates'),
  );
  return snapshot.docs.map(
    (item) =>
      ({
        id: item.id,
        ...item.data(),
        createdAt: normalizeDate(item.data().createdAt),
      }) as AnswerSheetTemplate,
  );
}

export async function saveAnswerSheetTemplate(
  uid: string,
  template: Omit<AnswerSheetTemplate, 'id' | 'createdAt'>,
) {
  validateAnswerSheetTemplate(template);
  const saved = { ...template, id: makeId('sheet'), createdAt: now() };
  if (!firebaseConfigured || !db) {
    const database = localTemplates();
    database[uid] = [saved, ...(database[uid] ?? [])];
    window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(database));
  } else
    await setDoc(doc(db, 'users', uid, 'answerSheetTemplates', saved.id), {
      ...template,
      createdAt: serverTimestamp(),
    });
  return saved;
}

export async function associateAnswerSheetTemplate(
  uid: string,
  sessionId: string,
  templateId: string | null,
) {
  const bundle = await loadSession(uid, sessionId);
  if (!bundle) throw new Error('Sessão não encontrada.');
  if (
    templateId &&
    !['builtin:legacy', 'builtin:standard-v2'].includes(templateId)
  ) {
    const templates = await listAnswerSheetTemplates(uid);
    if (
      !templates.some(
        (template) =>
          template.id === templateId &&
          template.questionCount === bundle.session.questionCount,
      )
    )
      throw new Error(
        'O modelo deve pertencer a você e ter a mesma quantidade de questões.',
      );
  }
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    const target = database[uid]?.find((item) => item.session.id === sessionId);
    if (target) {
      target.session.answerSheetTemplateId = templateId;
      writeLocal(database);
    }
  } else
    await updateDoc(doc(db, 'users', uid, 'sessions', sessionId), {
      answerSheetTemplateId: templateId,
      updatedAt: serverTimestamp(),
    });
}
