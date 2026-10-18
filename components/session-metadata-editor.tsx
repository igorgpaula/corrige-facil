'use client';
import { useState, type FormEvent } from 'react';
import { Pencil, Save } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { updateSessionMetadata } from '@/lib/repository';
import type { ExamSession } from '@/lib/types';

export function SessionMetadataEditor({
  session,
  userId,
  onSaved,
}: {
  session: ExamSession;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [className, setClassName] = useState(session.className);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changeOpen = (next: boolean) => {
    if (busy) return;
    if (next) {
      setTitle(session.title);
      setClassName(session.className);
      setError('');
    }
    setOpen(next);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await updateSessionMetadata(userId, session.id, { title, className });
      await onSaved();
      setOpen(false);
    } catch (cause) {
      const code =
        cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
      setError(
        code === 'permission-denied'
          ? 'A edição não foi autorizada. Confira as regras do Firebase e tente novamente.'
          : cause instanceof Error
            ? cause.message
            : 'Não foi possível salvar. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => changeOpen(true)}>
        <Pencil /> Editar título e turma
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="session-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Editar título e turma</DialogTitle>
            <DialogDescription>
              As questões, o gabarito e as correções permanecerão iguais.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="metadata-form">
            <label htmlFor="metadata-title">
              Título
              <Input
                id="metadata-title"
                required
                maxLength={200}
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label htmlFor="metadata-class">
              Turma
              <Input
                id="metadata-class"
                required
                maxLength={200}
                value={className}
                disabled={busy}
                onChange={(e) => setClassName(e.target.value)}
              />
            </label>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => changeOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="primary-action fit"
                disabled={busy || !title.trim() || !className.trim()}
              >
                <Save />
                {busy ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
