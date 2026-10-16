import {
  addDoc,
  collection,
  deleteDoc,
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
import type {
  Correction,
  ExamSession,
  QuestionDefinition,
  SessionBundle,
  SessionDraft,
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
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? '{}') as LocalDatabase;
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

function sessionFromDoc(id: string, data: Record<string, unknown>): ExamSession {
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
  const access = await getDoc(
    doc(db, ACCESS_COLLECTION, normalizedEmail),
  );
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
      throw new Error('Esta sessão já está travada para alterações estruturais.');
    bundle.session = {
      ...bundle.session,
      ...draft,
      status: 'draft',
      updatedAt: timestamp,
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
        query(collection(sessionRef, 'corrections'), orderBy('createdAt', 'desc')),
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
  const timestamp = now();
  if (!firebaseConfigured || !db) {
    const database = readLocal();
    const bundle = (database[uid] ?? []).find(
      (item) => item.session.id === sessionId,
    );
    if (!bundle) throw new Error('Sessão não encontrada.');
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
  const correctionRef = await addDoc(collection(sessionRef, 'corrections'), {
    ...correction,
    createdAt: serverTimestamp(),
  });
  const sessionSnapshot = await getDoc(sessionRef);
  await updateDoc(sessionRef, {
    status: 'active',
    lockedAt: sessionSnapshot.data()?.lockedAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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
  await deleteDoc(
    doc(
      db,
      'users',
      uid,
      'sessions',
      sessionId,
      'corrections',
      correctionId,
    ),
  );
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
  const batch = writeBatch(db);
  questions.forEach((item) => batch.delete(item.ref));
  corrections.forEach((item) => batch.delete(item.ref));
  batch.delete(sessionRef);
  await batch.commit();
}

export async function duplicateSession(uid: string, source: SessionBundle) {
  return createSession(uid, {
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
}
