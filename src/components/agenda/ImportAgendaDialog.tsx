import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileJson,
  Loader2,
  RotateCcw,
  Upload,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { statusColors, statusLabels } from "@/components/agenda/statusColors";
import {
  formatBytes,
  parseAgendaImportContent,
  toImportPayloadEvent,
  type AgendaImportParseResult,
  type NormalizedImportEvent,
} from "@/lib/agenda-import";
import {
  fetchAlreadyImportedSourceEventIds,
  importAgendaEvents,
  type ImportAgendaResult,
} from "@/lib/agenda-import-service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado ao fechar após uma importação com sucesso (para refetch da Agenda). */
  onImported?: () => void;
}

type EventStatusInImport = "new" | "already_imported" | "invalid";

/** Adaptador de I/O do navegador (fora da lógica pura de parsing). */
function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo"));
    reader.readAsText(file);
  });
}

function formatDateBr(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
}

function EventDetail({ event }: { event: NormalizedImportEvent }) {
  const dep = event.logisticsDeparture;
  const field = (label: string, value: string | null) => (
    <div>
      <span className="text-muted-foreground">{label}:</span> {value ?? "—"}
    </div>
  );
  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3 text-xs">
      <p className="text-muted-foreground">
        Cada campo abaixo vai para a sua própria coluna em <code>events</code> (editável depois no evento).
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">source_event_id:</span>{" "}
          <span className="font-mono">{event.sourceEventId ?? "—"}</span>
        </div>
        {field("Cidade", event.city)}
        {field("Estado / UF", event.state)}
        {field("Horário de montagem", event.setupTime)}
        {field("Contratante", event.contratanteNome)}
        {field("Cidade do contratante", event.contratanteCidade)}
        {field("Telefone do contratante", event.contratanteTelefone)}
      </div>

      {event.staffNotes && (
        <div>
          <p className="text-muted-foreground">Informações para a equipe (→ events.staff_notes):</p>
          <p className="whitespace-pre-wrap">{event.staffNotes}</p>
        </div>
      )}

      <div>
        <p className="text-muted-foreground">Saída logística:</p>
        <p>
          {dep.kind === "date_and_time"
            ? `→ events.logistics_departure: ${dep.display}`
            : dep.kind === "date_only"
              ? `Sem horário — a data fica registrada em observations ("${dep.observationsLine}")`
              : dep.kind === "time_only"
                ? "Apenas horário, sem data — ignorado."
                : "Sem informação de saída."}
        </p>
        {dep.warning && (
          <p className="mt-0.5 flex items-center gap-1 text-[hsl(var(--warning))]">
            <AlertTriangle className="h-3 w-3 shrink-0" /> {dep.warning}
          </p>
        )}
      </div>

      <div>
        <p className="text-muted-foreground">observations que serão gravadas (só a observação geral):</p>
        <pre className="mt-1 whitespace-pre-wrap rounded bg-background p-2 font-sans text-[11px]">
          {event.observationsProposal || "(vazio)"}
        </pre>
      </div>

      {event.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[hsl(var(--warning))]">
          {event.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {event.errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-destructive">
          {event.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImportAgendaDialog({ open, onOpenChange, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const importedOkRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<AgendaImportParseResult | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [alreadyImported, setAlreadyImported] = useState<Set<string>>(new Set());
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupError, setDedupError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportAgendaResult | null>(null);

  const preview = result && result.ok === true ? result.preview : null;
  const parseError = result && result.ok === false ? result.error : null;

  const reset = useCallback(() => {
    setFile(null);
    setResult(null);
    setExpanded(new Set());
    setAlreadyImported(new Set());
    setDedupError(null);
    setSaveError(null);
    setImportResult(null);
    savingRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFile = useCallback(async (picked: File | null) => {
    reset();
    setFile(picked);
    if (!picked) return;

    if (!picked.name.toLowerCase().endsWith(".json")) {
      setResult({ ok: false, error: "Selecione um arquivo .json exportado pelo Gestão de Eventos Pro." });
      return;
    }

    setParsing(true);
    try {
      const text = await readTextFile(picked);
      setResult(parseAgendaImportContent(text));
    } catch {
      setResult({ ok: false, error: "Não foi possível ler o conteúdo do arquivo." });
    } finally {
      setParsing(false);
    }
  }, [reset]);

  // Prévia de duplicidades: assim que houver um arquivo válido, consulta quais
  // source_event_id já existem para a empresa ativa.
  useEffect(() => {
    if (!preview) return;
    const validIds = preview.events.filter((e) => e.valid && e.sourceEventId).map((e) => e.sourceEventId as string);
    if (validIds.length === 0) {
      setAlreadyImported(new Set());
      return;
    }
    let cancelled = false;
    setDedupLoading(true);
    setDedupError(null);
    fetchAlreadyImportedSourceEventIds(preview.summary.sourceSystem, validIds)
      .then((set) => {
        if (!cancelled) setAlreadyImported(set);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDedupError(err instanceof Error ? err.message : "Falha ao verificar duplicidades.");
      })
      .finally(() => {
        if (!cancelled) setDedupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  const toggleExpanded = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const statusOf = useCallback(
    (event: NormalizedImportEvent): EventStatusInImport => {
      if (!event.valid) return "invalid";
      if (event.sourceEventId && alreadyImported.has(event.sourceEventId)) return "already_imported";
      return "new";
    },
    [alreadyImported],
  );

  const counts = useMemo(() => {
    if (!preview) return { total: 0, novos: 0, jaImportados: 0, invalidos: 0 };
    let novos = 0;
    let jaImportados = 0;
    let invalidos = 0;
    for (const event of preview.events) {
      const s = statusOf(event);
      if (s === "new") novos += 1;
      else if (s === "already_imported") jaImportados += 1;
      else invalidos += 1;
    }
    return { total: preview.events.length, novos, jaImportados, invalidos };
  }, [preview, statusOf]);

  const newPayload = useMemo(() => {
    if (!preview) return [];
    return preview.events.filter((e) => statusOf(e) === "new").map(toImportPayloadEvent);
  }, [preview, statusOf]);

  const canSave =
    !!preview &&
    !dedupLoading &&
    counts.invalidos === 0 &&
    counts.novos > 0 &&
    !saving &&
    !importResult;

  const handleSave = useCallback(async () => {
    if (savingRef.current || !preview || newPayload.length === 0) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await importAgendaEvents(preview.summary.sourceSystem, newPayload);
      importedOkRef.current = true;
      setImportResult(res);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Falha ao importar a agenda.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [preview, newPayload]);

  const closeDialog = useCallback(() => {
    const shouldRefetch = importedOkRef.current;
    importedOkRef.current = false;
    reset();
    onOpenChange(false);
    if (shouldRefetch) onImported?.();
  }, [reset, onOpenChange, onImported]);

  const summaryRows = useMemo(() => {
    if (!preview) return [];
    return [
      ["Arquivo", file?.name ?? "—"],
      ["Origem", preview.summary.source],
      [
        "Período exportado",
        `${formatDateBr(preview.summary.periodStart)} — ${formatDateBr(preview.summary.periodEnd)}`,
      ],
      ["Total no arquivo", String(counts.total)],
      ["Novos", dedupLoading ? "…" : String(counts.novos)],
      ["Já importados", dedupLoading ? "…" : String(counts.jaImportados)],
      ["Inválidos", String(counts.invalidos)],
    ];
  }, [preview, file, counts, dedupLoading]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
        else onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Importar agenda do Gestão de Eventos Pro</DialogTitle>
          <DialogDescription>
            Selecione o arquivo <code>.json</code> exportado. Confira a prévia e clique em{" "}
            <strong>Salvar agenda</strong>. Eventos já importados são ignorados automaticamente.
          </DialogDescription>
        </DialogHeader>

        {importResult ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Agenda importada com sucesso.</AlertTitle>
              <AlertDescription>
                <p>Novos eventos: {importResult.imported}</p>
                <p>Já existentes/ignorados: {importResult.skipped}</p>
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <>
            <div className="shrink-0 space-y-3 px-6 py-4">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileJson className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium text-foreground">{file.name}</span>
                  <span>· {formatBytes(file.size)}</span>
                  {parsing && <span>· validando…</span>}
                  {dedupLoading && <span>· verificando duplicidades…</span>}
                </p>
              )}

              {parseError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Arquivo não pôde ser importado</AlertTitle>
                  <AlertDescription>{parseError}</AlertDescription>
                </Alert>
              )}

              {preview && (
                <div className="rounded-md border">
                  <div className="grid gap-x-6 gap-y-1 p-3 text-sm sm:grid-cols-2">
                    {summaryRows.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="text-right font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dedupError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{dedupError}</AlertDescription>
                </Alert>
              )}
              {saveError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>A importação falhou — nada foi gravado</AlertTitle>
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}
              {preview && counts.invalidos > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>
                    {counts.invalidos} de {counts.total} evento(s) com pendência
                  </AlertTitle>
                  <AlertDescription>
                    Corrija na origem e exporte de novo. A importação só é liberada quando não há eventos
                    inválidos.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {preview && (
              <div className="min-h-0 flex-1 overflow-y-auto border-t px-6 py-2">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Data</TableHead>
                      <TableHead>Evento</TableHead>
                      <TableHead>Artista</TableHead>
                      <TableHead>Cidade / UF</TableHead>
                      <TableHead>Local</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Horário</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.events.map((event) => {
                      const isOpen = expanded.has(event.index);
                      const s = statusOf(event);
                      return (
                        <Fragment key={event.index}>
                          <TableRow
                            className={cn("cursor-pointer", s === "invalid" && "bg-destructive/10 hover:bg-destructive/15")}
                            onClick={() => toggleExpanded(event.index)}
                          >
                            <TableCell className="align-top">
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </TableCell>
                            <TableCell className="whitespace-nowrap align-top">{formatDateBr(event.date)}</TableCell>
                            <TableCell className="align-top font-medium">{event.name ?? "—"}</TableCell>
                            <TableCell className="align-top">
                              {event.artist ?? <span className="text-muted-foreground">A definir</span>}
                            </TableCell>
                            <TableCell className="align-top">
                              {event.cityStateLabel ?? <span className="text-muted-foreground">A definir</span>}
                            </TableCell>
                            <TableCell className="align-top">
                              {event.venue ?? <span className="text-muted-foreground">A definir</span>}
                            </TableCell>
                            <TableCell className="align-top">
                              {event.status ? (
                                <Badge className={cn("text-[10px]", statusColors[event.status])}>
                                  {statusLabels[event.status]}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-destructive">
                                  {event.statusReceived ?? "?"}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap align-top">
                              {event.showTime ? event.showTime.slice(0, 5) : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap align-top">
                              {s === "invalid" ? (
                                <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                                  <AlertTriangle className="h-3.5 w-3.5" /> {event.errors.length} erro(s)
                                </span>
                              ) : s === "already_imported" ? (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <RotateCcw className="h-3.5 w-3.5" /> Já importado
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-[hsl(var(--success))]">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Novo
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className={cn(s === "invalid" && "bg-destructive/5")}>
                              <TableCell colSpan={9}>
                                <EventDetail event={event} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        <DialogFooter className="shrink-0 flex-col items-stretch gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {importResult ? (
            <div className="flex w-full justify-end">
              <Button type="button" onClick={closeDialog}>
                Fechar
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {!preview
                  ? "Nada é gravado até você confirmar."
                  : counts.invalidos > 0
                    ? "Corrija as pendências antes de importar."
                    : counts.novos === 0
                      ? "Todos os eventos deste arquivo já foram importados."
                      : `${counts.novos} evento${counts.novos > 1 ? "s serão adicionados" : " será adicionado"} à agenda.`}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    reset();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="mr-2 h-4 w-4" /> Selecionar outro arquivo
                </Button>
                {preview && counts.invalidos === 0 && counts.novos === 0 ? (
                  <Button type="button" variant="outline" onClick={closeDialog}>
                    Fechar
                  </Button>
                ) : (
                  <Button type="button" disabled={!canSave} onClick={handleSave}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {saving ? "Salvando..." : `Salvar ${counts.novos} evento${counts.novos > 1 ? "s" : ""}`}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
