import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-corrige';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
function token(uid: string, email: string) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, aud: project, iss: `https://securetoken.google.com/${project}`, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'google.com', identities: {} } })}.`;
}
function value(v: unknown): unknown {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'number')
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  return { mapValue: { fields: fields(v as Record<string, unknown>) } };
}
function fields(v: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(v).map(([k, v]) => [k, value(v)]));
}
function write(path: string, data: Record<string, unknown>) {
  return {
    update: {
      name: `projects/${project}/databases/(default)/documents/${path}`,
      fields: fields(data),
    },
  };
}
async function commit(writes: unknown[], auth = 'owner') {
  const response = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });
  const body = await response.text();
  return { status: response.status, body };
}
const owner = token('teacher-one', 'teacher-one@example.test');
const second = token('teacher-two', 'teacher-two@example.test');
const template = {
  name: 'Blank 10',
  version: 1,
  mode: 'legacy',
  questionCount: 10,
  geometry: { columns: 5, rows: 10, radiusRatio: 0.0875 },
  baseline: { A: 0.2, B: 0.2, C: 0.2, D: 0.2, E: 0.2 },
  createdAt: new Date(),
};
function session(count = 10, locked = false) {
  return {
    title: 'Teste',
    className: 'Turma fictícia',
    subject: '',
    questionCount: count,
    pointsPerQuestion: 1,
    answerKey: Array(count).fill('A'),
    status: locked ? 'active' : 'draft',
    lockedAt: locked ? new Date() : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
function correction(count = 10) {
  return {
    studentLabel: null,
    answers: Array(count).fill('A'),
    readings: Array.from({ length: count }, () => ({
      answer: 'A',
      confidence: 90,
      source: 'scan',
      status: 'read',
    })),
    correctCount: count,
    score: count,
    maximumScore: count,
    createdAt: new Date(),
  };
}
function correctionWrites(path: string, data: ReturnType<typeof correction>) {
  const writes = [write(path, data)];
  for (let offset = 0; offset < data.answers.length; offset += 10)
    writes.push(
      write(`${path}/readingChecks/${offset / 10}`, {
        answers: data.answers.slice(offset, offset + 10),
        readings: data.readings.slice(offset, offset + 10),
      }),
    );
  return writes;
}
describe.skipIf(!host)('regras Firestore — somente no emulador local', () => {
  beforeAll(async () => {
    if (!/^127\.0\.0\.1:\d+$/.test(host!))
      throw new Error('Use exclusivamente um emulador em 127.0.0.1.');
    await fetch(
      `http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const rules = readFileSync(
      new URL('../firestore.rules', import.meta.url),
      'utf8',
    );
    const response = await fetch(
      `http://${host}/emulator/v1/projects/${project}:securityRules`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: { files: [{ name: 'firestore.rules', content: rules }] },
        }),
      },
    );
    expect(await response.text()).not.toContain('error');
    expect(response.ok).toBe(true);
    expect(
      (
        await commit([
          write('authorizedUsers/teacher-one@example.test', { enabled: true }),
          write('authorizedUsers/teacher-two@example.test', { enabled: true }),
          write('users/teacher-one/sessions/locked', session(10, true)),
          write('users/teacher-one/sessions/fifty', session(50, true)),
        ])
      ).status,
    ).toBe(200);
  }, 30000);
  it('permite criar um modelo próprio e recusa campos de foto e dados aninhados extras', async () => {
    expect(
      (
        await commit(
          [write('users/teacher-one/answerSheetTemplates/own', template)],
          owner,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await commit(
          [
            write('users/teacher-one/answerSheetTemplates/image', {
              ...template,
              image: 'data:image/jpeg;base64,test',
            }),
          ],
          owner,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await commit(
          [
            write('users/teacher-one/answerSheetTemplates/nested', {
              ...template,
              geometry: {
                ...template.geometry,
                fileUrl: 'https://example.test/photo.jpg',
              },
            }),
          ],
          owner,
        )
      ).status,
    ).toBe(403);
  });
  it('isola dois usuários mesmo quando ambos têm acesso à plataforma', async () => {
    expect(
      (
        await commit(
          [write('users/teacher-one/answerSheetTemplates/foreign', template)],
          second,
        )
      ).status,
    ).toBe(403);
    const response = await fetch(`${base}/users/teacher-one/sessions/locked`, {
      headers: { Authorization: `Bearer ${second}` },
    });
    expect(response.status).toBe(403);
  });
  it('associa modelo compatível sem permitir mudar gabarito bloqueado', async () => {
    await commit([
      write('users/teacher-one/answerSheetTemplates/compatible', template),
    ]);
    const locked = session(10, true);
    expect(
      (
        await commit(
          [
            write('users/teacher-one/sessions/locked', {
              ...locked,
              answerSheetTemplateId: 'compatible',
            }),
          ],
          owner,
        )
      ).status,
    ).toBe(403);
    // Keep immutable timestamps exactly, just as updateDoc does in the app.
    const patch = (id: string, data: Record<string, unknown>) => ({
      ...write('users/teacher-one/sessions/locked', data),
      updateMask: { fieldPaths: [id] },
    });
    expect(
      (
        await commit(
          [
            patch('answerSheetTemplateId', {
              answerSheetTemplateId: 'compatible',
            }),
          ],
          owner,
        )
      ).status,
    ).toBe(200);
    await commit([
      write('users/teacher-one/answerSheetTemplates/incompatible', {
        ...template,
        questionCount: 12,
        geometry: { ...template.geometry, rows: 12 },
      }),
    ]);
    expect(
      (
        await commit(
          [
            patch('answerSheetTemplateId', {
              answerSheetTemplateId: 'incompatible',
            }),
          ],
          owner,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await commit(
          [patch('answerKey', { answerKey: Array(10).fill('B') })],
          owner,
        )
      ).status,
    ).toBe(403);
  });
  it('permite editar identificação bloqueada, mas não gabarito, pontuação ou dados de outro professor', async () => {
    const path = 'users/teacher-one/sessions/metadata';
    await commit([write(path, session(10, true))]);
    const patch = (data: Record<string, unknown>) => ({
      ...write(path, data),
      updateMask: { fieldPaths: Object.keys(data) },
    });
    expect(
      (
        await commit(
          [
            patch({
              title: 'Novo título',
              className: '8º B',
              updatedAt: new Date(),
            }),
          ],
          owner,
        )
      ).status,
    ).toBe(200);
    for (const data of [
      { answerKey: Array(10).fill('B') },
      { pointsPerQuestion: 2 },
      { questionCount: 9 },
      { title: 'a'.repeat(201) },
      { image: 'data:image/png;base64,test' },
    ])
      expect((await commit([patch(data)], owner)).status).toBe(403);
    expect(
      (await commit([patch({ title: 'Outro professor' })], second)).status,
    ).toBe(403);
  });
  it('salva a primeira correção e trava a sessão na mesma transação atômica', async () => {
    const path = 'users/teacher-one/sessions/first';
    await commit([write(path, session())]);
    const update = {
      ...write(path, {
        status: 'active',
        lockedAt: new Date(),
        updatedAt: new Date(),
      }),
      updateMask: { fieldPaths: ['status', 'lockedAt', 'updatedAt'] },
    };
    const saved = await commit(
      [...correctionWrites(`${path}/corrections/first`, correction()), update],
      owner,
    );
    expect(saved.body).not.toContain('error');
    expect(saved.status).toBe(200);
  });
  it('aceita branco confirmado e anulação manual, mas não dupla automática', async () => {
    const blank = correction();
    blank.answers.fill(null as never);
    blank.correctCount = 0;
    blank.score = 0;
    blank.readings = blank.readings.map((r) => ({
      ...r,
      answer: null as never,
      confidence: 100,
      source: 'manual',
      status: 'blank',
    }));
    blank.readings[0].status = 'multiple';
    expect(
      (
        await commit(
          correctionWrites(
            'users/teacher-one/sessions/locked/corrections/blank',
            blank,
          ),
          owner,
        )
      ).status,
    ).toBe(200);
    blank.readings[0].source = 'scan';
    expect(
      (
        await commit(
          correctionWrites(
            'users/teacher-one/sessions/locked/corrections/scan-multiple',
            blank,
          ),
          owner,
        )
      ).status,
    ).toBe(403);
  });
  it.each([10, 50])(
    'aceita correção final de %s questões e recusa pendência na última',
    async (count) => {
      const id = count === 50 ? 'fifty' : 'locked';
      const path = `users/teacher-one/sessions/${id}/corrections`;
      const good = await commit(
        correctionWrites(`${path}/good`, correction(count)),
        owner,
      );
      expect(good.body).not.toContain('error');
      expect(good.status).toBe(200);
      const bad = correction(count);
      bad.readings[count - 1].status = 'uncertain';
      expect(
        (await commit(correctionWrites(`${path}/pending`, bad), owner)).status,
      ).toBe(403);
      const photo = correction(count);
      (photo.readings[count - 1] as Record<string, unknown>).image = 'base64';
      expect(
        (await commit(correctionWrites(`${path}/photo`, photo), owner)).status,
      ).toBe(403);
    },
  );
});
