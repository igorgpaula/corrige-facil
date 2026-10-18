'use client';
import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { exportSessionStatistics } from '@/lib/statistics-export';
import type { SessionBundle } from '@/lib/types';

export function StatisticsExportButton({ bundle }: { bundle: SessionBundle }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const generate = async (format: 'pdf' | 'xlsx') => {
    setBusy(format);
    setError('');
    setMessage('');
    try {
      await exportSessionStatistics(bundle, format);
      setMessage('Arquivo gerado. Confira os downloads do navegador.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível gerar o arquivo. Tente novamente.',
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="analytics-actions">
        <Button
          variant="outline"
          disabled={!bundle.corrections.length}
          onClick={() => {
            setError('');
            setMessage('');
            setOpen(true);
          }}
        >
          <FileDown />
          Extrair estatísticas
        </Button>
        {!bundle.corrections.length && (
          <small>Salve uma correção para habilitar a exportação.</small>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent className="session-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Extrair estatísticas</DialogTitle>
            <DialogDescription>
              Os arquivos incluem estatísticas da turma e resultados
              individuais, com nomes ou códigos quando informados. Compartilhe
              somente com pessoas autorizadas.
            </DialogDescription>
          </DialogHeader>
          <div className="export-actions">
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => void generate('pdf')}
            >
              <FileText />
              {busy === 'pdf' ? 'Gerando PDF…' : 'Baixar PDF'}
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => void generate('xlsx')}
            >
              <FileSpreadsheet />
              {busy === 'xlsx' ? 'Gerando Excel…' : 'Baixar Excel'}
            </Button>
          </div>
          <p role="status">
            {busy ? 'Gerando o arquivo neste aparelho…' : message}
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <small>
            Arquivos gerados localmente. Nenhum arquivo é enviado ao Firebase.
          </small>
        </DialogContent>
      </Dialog>
    </>
  );
}
