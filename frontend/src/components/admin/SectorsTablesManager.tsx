import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  Grid2x2Plus,
  Layers,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Power,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  getAdminErrorMessage,
  getSectorColor,
  minorToEditablePrice,
} from '@/components/admin/adminUtils';
import { adminApi } from '@/lib/api';
import { formatMinorCurrency, parseMajorPriceToMinor } from '@/lib/format';
import type {
  AdminEventDetail,
  AdminSectorWithTables,
  AdminTable,
} from '@/types/api';

interface SectorsTablesManagerProps {
  event: AdminEventDetail;
  onRefreshEvent: () => Promise<void>;
  onOpenMapEditor: () => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type ModalMode =
  | { kind: 'sector-create' }
  | { kind: 'sector-edit'; sector: AdminSectorWithTables }
  | { kind: 'table-create'; sector: AdminSectorWithTables }
  | { kind: 'table-batch'; sector: AdminSectorWithTables }
  | { kind: 'table-edit'; sector: AdminSectorWithTables; table: AdminTable };

export function SectorsTablesManager({
  event,
  onRefreshEvent,
  onOpenMapEditor,
  onNotify,
}: SectorsTablesManagerProps) {
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'sector' | 'table';
    id: string;
    sectorId: string;
  } | null>(null);

  const summary = useMemo(() => {
    let totalTables = 0;
    let enabledTables = 0;
    let positionedTables = 0;
    for (const s of event.sectors) {
      for (const t of s.tables) {
        totalTables += 1;
        if (t.isEnabled) enabledTables += 1;
        if (t.x !== null && t.y !== null) positionedTables += 1;
      }
    }
    return { totalTables, enabledTables, positionedTables };
  }, [event.sectors]);

  async function handleToggleTableEnabled(
    sector: AdminSectorWithTables,
    table: AdminTable,
  ) {
    setBusyKey(`toggle-${table.id}`);
    try {
      await adminApi.updateTable(event.id, sector.id, table.id, {
        isEnabled: !table.isEnabled,
      });
      onNotify(
        'success',
        `Mesa ${table.label} ${!table.isEnabled ? 'habilitada' : 'desabilitada'}.`,
      );
      await onRefreshEvent();
    } catch (err) {
      onNotify('error', getAdminErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteSector(sector: AdminSectorWithTables) {
    setBusyKey(`del-sector-${sector.id}`);
    try {
      await adminApi.deleteSector(event.id, sector.id);
      setConfirmDelete(null);
      onNotify('success', `Setor "${sector.name}" removido.`);
      await onRefreshEvent();
    } catch (err) {
      onNotify('error', getAdminErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteTable(
    sector: AdminSectorWithTables,
    table: AdminTable,
  ) {
    setBusyKey(`del-table-${table.id}`);
    try {
      await adminApi.deleteTable(event.id, sector.id, table.id);
      setConfirmDelete(null);
      onNotify('success', `Mesa ${table.label} removida.`);
      await onRefreshEvent();
    } catch (err) {
      onNotify('error', getAdminErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header Summary Bar */}
      <div className="flex flex-col gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
            Setores e Mesas
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {event.sectors.length}{' '}
            {event.sectors.length === 1 ? 'setor' : 'setores'} ·{' '}
            {summary.totalTables}{' '}
            {summary.totalTables === 1 ? 'mesa' : 'mesas'} ({summary.enabledTables}{' '}
            habilitadas · {summary.positionedTables} posicionadas no mapa)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summary.totalTables > 0 && (
            <button
              type="button"
              onClick={onOpenMapEditor}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              <MapPin className="h-3.5 w-3.5 text-[var(--accent)]" />
              Posicionar no Mapa
            </button>
          )}
          <button
            type="button"
            onClick={() => setModal({ kind: 'sector-create' })}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo Setor
          </button>
        </div>
      </div>

      {/* Empty state */}
      {event.sectors.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-12 text-center">
          <Layers className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
          <p className="font-display mt-3 text-base font-bold text-[var(--text-primary)]">
            Nenhum setor cadastrado para este evento
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-muted)]">
            Comece criando setores (ex.: Pista, Camarote VIP, Mezanino) com preço base e depois cadastre mesas individualmente ou em lote.
          </p>
          <button
            type="button"
            onClick={() => setModal({ kind: 'sector-create' })}
            className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar primeiro setor
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {event.sectors.map((sector, sectorIdx) => {
            const color = getSectorColor(sectorIdx);
            const isDeletingSector =
              confirmDelete?.type === 'sector' && confirmDelete.id === sector.id;
            const sectorBusy = busyKey === `del-sector-${sector.id}`;

            return (
              <section
                key={sector.id}
                className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                {/* Sector Header */}
                <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color.dot}`} />
                      <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
                        {sector.name}
                      </h3>
                      <span className="font-mono-num rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-primary)]">
                        Base: {formatMinorCurrency(sector.basePriceMinor, event.currency)}
                      </span>
                      <span className="rounded-full bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                        {sector.tables.length}{' '}
                        {sector.tables.length === 1 ? 'mesa' : 'mesas'}
                      </span>
                    </div>
                    {sector.description && (
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {sector.description}
                      </p>
                    )}
                  </div>

                  {/* Sector Actions */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setModal({ kind: 'table-create', sector })}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--cta-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Mesa
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ kind: 'table-batch', sector })}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition-opacity hover:opacity-90"
                    >
                      <Grid2x2Plus className="h-3.5 w-3.5" />
                      Lote
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ kind: 'sector-edit', sector })}
                      title="Editar setor"
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    {isDeletingSector ? (
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-1 text-[11px]">
                        <button
                          type="button"
                          disabled={sectorBusy}
                          onClick={() => void handleDeleteSector(sector)}
                          className="cursor-pointer font-bold text-[var(--danger)] hover:underline"
                        >
                          {sectorBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            'Excluir setor'
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="cursor-pointer text-[var(--text-secondary)]"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDelete({
                            type: 'sector',
                            id: sector.id,
                            sectorId: sector.id,
                          })
                        }
                        title="Remover setor"
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--danger)]/40 hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Tables Grid */}
                <div className="p-4 sm:p-5">
                  {sector.tables.length === 0 ? (
                    <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 px-4 py-5 text-center sm:flex-row sm:text-left">
                      <p className="text-xs text-[var(--text-muted)]">
                        Nenhuma mesa neste setor ainda. Adicione uma mesa ou gere várias em lote.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setModal({ kind: 'table-create', sector })}
                          className="cursor-pointer rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        >
                          + 1 Mesa
                        </button>
                        <button
                          type="button"
                          onClick={() => setModal({ kind: 'table-batch', sector })}
                          className="cursor-pointer rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                        >
                          + Criar em lote
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {sector.tables.map((table) => {
                        const isConfirmingTableDelete =
                          confirmDelete?.type === 'table' &&
                          confirmDelete.id === table.id;
                        const isTableBusy =
                          busyKey === `toggle-${table.id}` ||
                          busyKey === `del-table-${table.id}`;
                        const isPositioned = table.x !== null && table.y !== null;

                        return (
                          <div
                            key={table.id}
                            className={`flex flex-col justify-between rounded-2xl border p-3.5 transition-colors ${
                              table.isEnabled
                                ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 hover:border-[var(--border-strong)]'
                                : 'border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/25 opacity-65'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-display text-sm font-bold text-[var(--text-primary)]">
                                    Mesa {table.label}
                                  </span>
                                  {!table.isEnabled && (
                                    <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                                      Desabilitada
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                                  <span className="inline-flex items-center gap-1">
                                    <Users className="h-3 w-3 text-[var(--text-muted)]" />
                                    {table.capacity} lug.
                                  </span>
                                  <span className="font-mono-num font-semibold text-[var(--text-primary)]">
                                    {formatMinorCurrency(
                                      table.priceMinor,
                                      event.currency,
                                    )}
                                  </span>
                                </div>
                              </div>

                              <span
                                title={
                                  isPositioned
                                    ? `Posição no mapa: X ${table.x}%, Y ${table.y}%`
                                    : 'Sem posição na planta'
                                }
                                className={`rounded-full px-2 py-0.5 font-mono-num text-[10px] font-medium ${
                                  isPositioned
                                    ? 'bg-emerald-500/12 text-emerald-700'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                                }`}
                              >
                                {isPositioned
                                  ? `${table.x!.toFixed(0)}%, ${table.y!.toFixed(0)}%`
                                  : 'Sem mapa'}
                              </span>
                            </div>

                            <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2.5">
                              <button
                                type="button"
                                disabled={isTableBusy}
                                onClick={() =>
                                  void handleToggleTableEnabled(sector, table)
                                }
                                className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  table.isEnabled
                                    ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                }`}
                              >
                                <Power className="h-3 w-3" />
                                {table.isEnabled ? 'Ativa' : 'Inativa'}
                              </button>

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isTableBusy}
                                  onClick={() =>
                                    setModal({ kind: 'table-edit', sector, table })
                                  }
                                  title="Editar mesa"
                                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>

                                {isConfirmingTableDelete ? (
                                  <div className="inline-flex items-center gap-1 rounded-full border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-2 py-0.5 text-[10px]">
                                    <button
                                      type="button"
                                      disabled={isTableBusy}
                                      onClick={() =>
                                        void handleDeleteTable(sector, table)
                                      }
                                      className="cursor-pointer font-bold text-[var(--danger)]"
                                    >
                                      Sim
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDelete(null)}
                                      className="cursor-pointer text-[var(--text-secondary)]"
                                    >
                                      Não
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isTableBusy}
                                    onClick={() =>
                                      setConfirmDelete({
                                        type: 'table',
                                        id: table.id,
                                        sectorId: sector.id,
                                      })
                                    }
                                    title="Remover mesa"
                                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {modal?.kind === 'sector-create' || modal?.kind === 'sector-edit' ? (
        <SectorFormModal
          eventId={event.id}
          currency={event.currency}
          sector={modal.kind === 'sector-edit' ? modal.sector : null}
          onClose={() => setModal(null)}
          onSaved={async (msg) => {
            setModal(null);
            onNotify('success', msg);
            await onRefreshEvent();
          }}
        />
      ) : null}

      {modal?.kind === 'table-create' || modal?.kind === 'table-edit' ? (
        <TableFormModal
          eventId={event.id}
          currency={event.currency}
          sectors={event.sectors}
          sector={modal.sector}
          table={modal.kind === 'table-edit' ? modal.table : null}
          onClose={() => setModal(null)}
          onSaved={async (msg) => {
            setModal(null);
            onNotify('success', msg);
            await onRefreshEvent();
          }}
        />
      ) : null}

      {modal?.kind === 'table-batch' ? (
        <BatchTablesModal
          eventId={event.id}
          currency={event.currency}
          sector={modal.sector}
          onClose={() => setModal(null)}
          onSaved={async (msg) => {
            setModal(null);
            onNotify('success', msg);
            await onRefreshEvent();
          }}
        />
      ) : null}
    </div>
  );
}

/* ============================================================================
 * Sector Create / Edit Modal
 * ==========================================================================*/
function SectorFormModal({
  eventId,
  currency,
  sector,
  onClose,
  onSaved,
}: {
  eventId: string;
  currency: string;
  sector: AdminSectorWithTables | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState(sector?.name ?? '');
  const [description, setDescription] = useState(sector?.description ?? '');
  const [priceText, setPriceText] = useState(
    sector ? minorToEditablePrice(sector.basePriceMinor) : '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const basePriceMinor = parseMajorPriceToMinor(priceText);
    if (!trimmedName) {
      setError('Informe o nome do setor.');
      return;
    }
    if (!basePriceMinor || basePriceMinor <= 0) {
      setError('Informe um preço base positivo (ex.: 120,00).');
      return;
    }

    setSubmitting(true);
    try {
      if (sector) {
        await adminApi.updateSector(eventId, sector.id, {
          name: trimmedName,
          description: description.trim() || null,
          basePriceMinor,
        });
        await onSaved(`Setor "${trimmedName}" atualizado.`);
      } else {
        await adminApi.createSector(eventId, {
          name: trimmedName,
          description: description.trim() || null,
          basePriceMinor,
        });
        await onSaved(`Setor "${trimmedName}" criado.`);
      }
    } catch (err) {
      setError(getAdminErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4 backdrop-blur-sm"
    >
      <div className="animate-pop-in w-full max-w-md overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
            {sector ? 'Editar setor' : 'Novo setor'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Nome do setor *
            </span>
            <input
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Camarote VIP, Pista, Mezanino"
              className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Preço base ({currency}) *
            </span>
            <input
              type="text"
              required
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="Ex.: 250,00"
              className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
            />
            {sector && (
              <p className="text-[11px] text-[var(--text-muted)]">
                Alterar o preço base não modifica o preço das mesas já existentes.
              </p>
            )}
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Descrição
            </span>
            <textarea
              rows={2}
              maxLength={4000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional: visão privilegiada, frente do palco..."
              className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="cursor-pointer rounded-full border border-[var(--border-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-5 py-2 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)] disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {sector ? 'Salvar setor' : 'Criar setor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================================
 * Single Table Create / Edit Modal
 * ==========================================================================*/
function TableFormModal({
  eventId,
  currency,
  sectors,
  sector,
  table,
  onClose,
  onSaved,
}: {
  eventId: string;
  currency: string;
  sectors: AdminSectorWithTables[];
  sector: AdminSectorWithTables;
  table: AdminTable | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(table?.label ?? '');
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 4));
  const [priceText, setPriceText] = useState(
    table ? minorToEditablePrice(table.priceMinor) : '',
  );
  const [targetSectorId, setTargetSectorId] = useState(sector.id);
  const [isEnabled, setIsEnabled] = useState(table?.isEnabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedLabel = label.trim();
    const capNum = Number.parseInt(capacity, 10);
    if (!trimmedLabel) {
      setError('Informe o número/identificador da mesa.');
      return;
    }
    if (!Number.isInteger(capNum) || capNum < 1) {
      setError('Informe uma capacidade válida (mínimo 1 lugar).');
      return;
    }

    let priceMinor: number | undefined;
    if (priceText.trim()) {
      const parsed = parseMajorPriceToMinor(priceText);
      if (!parsed || parsed <= 0) {
        setError('Informe um preço válido ou deixe em branco para herdar o preço base.');
        return;
      }
      priceMinor = parsed;
    } else if (table) {
      setError('Informe o preço da mesa.');
      return;
    }

    setSubmitting(true);
    try {
      if (table) {
        await adminApi.updateTable(eventId, sector.id, table.id, {
          label: trimmedLabel,
          capacity: capNum,
          priceMinor,
          isEnabled,
          ...(targetSectorId !== sector.id ? { sectorId: targetSectorId } : {}),
        });
        await onSaved(`Mesa ${trimmedLabel} atualizada.`);
      } else {
        await adminApi.createTable(eventId, sector.id, {
          label: trimmedLabel,
          capacity: capNum,
          ...(priceMinor !== undefined ? { priceMinor } : {}),
          isEnabled,
        });
        await onSaved(`Mesa ${trimmedLabel} adicionada ao setor ${sector.name}.`);
      }
    } catch (err) {
      setError(getAdminErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4 backdrop-blur-sm"
    >
      <div className="animate-pop-in w-full max-w-md overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
              {table ? `Editar Mesa ${table.label}` : `Nova mesa em ${sector.name}`}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Preço base do setor:{' '}
              {formatMinorCurrency(sector.basePriceMinor, currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Número / Rótulo *
              </span>
              <input
                type="text"
                required
                maxLength={60}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex.: P1, VIP-05"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Capacidade (lugares) *
              </span>
              <input
                type="number"
                required
                min={1}
                max={100}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Preço específico ({currency}){table ? ' *' : ' (opcional)'}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder={
                table
                  ? minorToEditablePrice(table.priceMinor)
                  : `Deixe vazio para usar ${minorToEditablePrice(sector.basePriceMinor)}`
              }
              className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
            />
          </label>

          {table && sectors.length > 1 && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Setor
              </span>
              <select
                value={targetSectorId}
                onChange={(e) => setTargetSectorId(e.target.value)}
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              >
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                Mesa habilitada para venda
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Mesas desabilitadas não podem ser reservadas pelos clientes.
              </p>
            </div>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="cursor-pointer rounded-full border border-[var(--border-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-5 py-2 text-xs font-semibold text-[var(--cta-text)] hover:bg-[var(--cta-hover)] disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {table ? 'Salvar mesa' : 'Adicionar mesa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================================
 * Batch Create Tables Modal
 * ==========================================================================*/
function BatchTablesModal({
  eventId,
  currency,
  sector,
  onClose,
  onSaved,
}: {
  eventId: string;
  currency: string;
  sector: AdminSectorWithTables;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const defaultPrefix = sector.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();

  const [prefix, setPrefix] = useState(defaultPrefix || 'M');
  const [startNumber, setStartNumber] = useState(
    String(sector.tables.length + 1),
  );
  const [count, setCount] = useState('10');
  const [capacity, setCapacity] = useState('4');
  const [priceText, setPriceText] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewLabels = useMemo(() => {
    const start = Number.parseInt(startNumber, 10);
    const total = Number.parseInt(count, 10);
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(total) || total < 1) {
      return [];
    }
    const clamped = Math.min(total, 250);
    if (clamped <= 6) {
      return Array.from({ length: clamped }, (_, i) => `${prefix}${start + i}`);
    }
    return [
      `${prefix}${start}`,
      `${prefix}${start + 1}`,
      `${prefix}${start + 2}`,
      '...',
      `${prefix}${start + clamped - 1}`,
    ];
  }, [prefix, startNumber, count]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (prefix && !/^[A-Za-z0-9_-]*$/.test(prefix)) {
      setError('O prefixo aceita apenas letras, números, hífen (-) e underline (_).');
      return;
    }
    const startNum = Number.parseInt(startNumber, 10);
    const countNum = Number.parseInt(count, 10);
    const capNum = Number.parseInt(capacity, 10);

    if (!Number.isInteger(startNum) || startNum < 1 || startNum > 999999) {
      setError('Número inicial deve estar entre 1 e 999999.');
      return;
    }
    if (!Number.isInteger(countNum) || countNum < 1 || countNum > 250) {
      setError('Quantidade por lote deve estar entre 1 e 250 mesas.');
      return;
    }
    if (!Number.isInteger(capNum) || capNum < 1) {
      setError('Informe uma capacidade válida.');
      return;
    }

    let priceMinor: number | undefined;
    if (priceText.trim()) {
      const parsed = parseMajorPriceToMinor(priceText);
      if (!parsed || parsed <= 0) {
        setError('Informe um preço válido ou deixe em branco para herdar o preço base.');
        return;
      }
      priceMinor = parsed;
    }

    setSubmitting(true);
    try {
      const res = await adminApi.createTablesBatch(eventId, sector.id, {
        ...(prefix ? { prefix } : {}),
        startNumber: startNum,
        count: countNum,
        capacity: capNum,
        ...(priceMinor !== undefined ? { priceMinor } : {}),
        isEnabled,
      });
      await onSaved(
        `${res.tables.length} mesas criadas em lote no setor "${sector.name}".`,
      );
    } catch (err) {
      setError(getAdminErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4 backdrop-blur-sm"
    >
      <div className="animate-pop-in w-full max-w-md overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-elevated)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
              Criar mesas em lote
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Setor {sector.name} · Base{' '}
              {formatMinorCurrency(sector.basePriceMinor, currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Prefixo
              </span>
              <input
                type="text"
                maxLength={45}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="Ex.: VIP"
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Nº Inicial *
              </span>
              <input
                type="number"
                required
                min={1}
                max={999999}
                value={startNumber}
                onChange={(e) => setStartNumber(e.target.value)}
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Qtd (1–250) *
              </span>
              <input
                type="number"
                required
                min={1}
                max={250}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Capacidade *
              </span>
              <input
                type="number"
                required
                min={1}
                max={100}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Preço ({currency})
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder={minorToEditablePrice(sector.basePriceMinor)}
                className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
              />
            </label>
          </div>

          {/* Preview */}
          {previewLabels.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 p-3">
              <p className="text-[11px] font-semibold text-[var(--text-secondary)]">
                Prévia da numeração
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {previewLabels.map((lbl, idx) => (
                  <span
                    key={`${lbl}-${idx}`}
                    className="font-mono-num rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-primary)]"
                  >
                    {lbl}
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 px-4 py-2.5">
            <span className="text-xs font-medium text-[var(--text-primary)]">
              Criar mesas já habilitadas
            </span>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="cursor-pointer rounded-full border border-[var(--border-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Criar {count || 0} mesas
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
