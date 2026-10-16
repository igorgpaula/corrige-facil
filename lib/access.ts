export const ACCESS_COLLECTION = 'authorizedUsers';

export function normalizeAccessEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? '';
}

export function unauthorizedAccountMessage(
  email: string | null | undefined,
) {
  const normalizedEmail = normalizeAccessEmail(email);
  return normalizedEmail
    ? `A conta ${normalizedEmail} não está autorizada a acessar esta plataforma.`
    : 'Esta conta não está autorizada a acessar a plataforma.';
}
