import { describe, expect, it } from 'vitest';

import {
  ACCESS_COLLECTION,
  normalizeAccessEmail,
  unauthorizedAccountMessage,
} from './access';

describe('controle de acesso', () => {
  it('normaliza o e-mail usado como ID no Firestore', () => {
    expect(normalizeAccessEmail('  IgorGPaula@GMAIL.COM ')).toBe(
      'igorgpaula@gmail.com',
    );
    expect(normalizeAccessEmail(null)).toBe('');
  });

  it('mantém o nome fixo da coleção de autorizados', () => {
    expect(ACCESS_COLLECTION).toBe('authorizedUsers');
  });

  it('explica qual conta foi recusada', () => {
    expect(unauthorizedAccountMessage('OUTRA@EXAMPLE.COM')).toContain(
      'outra@example.com',
    );
  });
});
