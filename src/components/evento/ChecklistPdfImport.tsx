import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileUp, FileText, FileSpreadsheet, Trash2, Eye, Upload, CheckCircle2, X, Loader2 } from "lucide-react";
import { CHECKLIST_CATEGORIES, type ChecklistCategory } from "@/hooks/useEventChecklist";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface Props {
  eventId: string;
  empresaId: string;
  onImportItems: (items: { descricao: string; categoria: string }[]) => Promise<void>;
}

interface ParsedLine {
  text: string;
  selected: boolean;
}

export function ChecklistPdfImport({ eventId, empresaId, onImportItems }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [importCategory, setImportCategory] = useState<ChecklistCategory>("observacoes_gerais");

  // Query attached PDFs (material_list type)
  const { data: attachedFiles = [] } = useQuery({
    queryKey: ["checklist-pdfs", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_files")
        .select("*")
        .eq("event_id", eventId)
        .eq("file_type", "material_list");
      if (error) throw error;
      return data;
    },
  });

  const extractTextFromPdf = useCallback(async (file: File): Promise<string[]> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const lines: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(" ");
      const pageLines = pageText
        .split(/[\n\r]+/)
        .flatMap((l: string) => l.split(/[;•\-–—]\s+/))
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 2);
      lines.push(...pageLines);
    }

    return [...new Set(lines)];
  }, []);

  const extractTextFromExcel = useCallback(async (file: File): Promise<string[]> => {
    const XLSX = await import("xlsx");
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const lines: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      for (const row of rows) {
        const text = row
          .map((cell: any) => String(cell ?? "").trim())
          .filter((c: string) => c.length > 0)
          .join(" — ");
        if (text.length > 2) lines.push(text);
      }
    }

    return [...new Set(lines)];
  }, []);

  const extractTextFromWord = useCallback(async (file: File): Promise<string[]> => {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const lines = result.value
      .split(/[\n\r]+/)
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 2);
    return [...new Set(lines)];
  }, []);

  const isExcel = (file: File) =>
    file.name.endsWith(".xlsx") || file.name.endsWith(".xls") ||
    file.type.includes("spreadsheet") || file.type.includes("excel");

  const isWord = (file: File) =>
    file.name.endsWith(".docx") || file.name.endsWith(".doc") ||
    file.type.includes("wordprocessing") || file.type === "application/msword";

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdf = file.type === "application/pdf";
    const isXls = isExcel(file);
    const isDoc = isWord(file);

    if (!isPdf && !isXls && !isDoc) {
      toast({ title: "Selecione um arquivo PDF, Excel ou Word", variant: "destructive" });
      return;
    }

    setExtracting(true);
    try {
      const lines = isPdf
        ? await extractTextFromPdf(file)
        : isXls
          ? await extractTextFromExcel(file)
          : await extractTextFromWord(file);

      if (lines.length === 0) {
        toast({ title: "Nenhum conteúdo encontrado no arquivo", variant: "destructive" });
        setExtracting(false);
        return;
      }

      setParsedLines(lines.map((text) => ({ text, selected: true })));
      setShowPreview(true);

      // Upload to storage
      setUploading(true);
      const path = `${eventId}/material_${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("event-files").upload(path, file);
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("event_files").insert({
        event_id: eventId,
        empresa_id: empresaId,
        file_type: "material_list" as any,
        file_path: path,
        file_name: file.name,
      } as any);
      if (insErr) throw insErr;

      queryClient.invalidateQueries({ queryKey: ["checklist-pdfs", eventId] });
      const fileLabel = isPdf ? "PDF" : isXls ? "Excel" : "Word";
      toast({ title: `${fileLabel} anexado ao evento` });
    } catch (err: any) {
      toast({ title: "Erro ao processar arquivo", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmImport = async () => {
    const selectedItems = parsedLines
      .filter((l) => l.selected)
      .map((l) => ({ descricao: l.text, categoria: importCategory }));

    if (selectedItems.length === 0) {
      toast({ title: "Selecione ao menos um item", variant: "destructive" });
      return;
    }

    setImporting(true);
    try {
      await onImportItems(selectedItems);
      toast({ title: `${selectedItems.length} itens importados ao checklist` });
      setShowPreview(false);
      setParsedLines([]);
    } catch {
      toast({ title: "Erro ao importar itens", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteFile = async (fileId: string, filePath: string) => {
    try {
      await supabase.storage.from("event-files").remove([filePath]);
      await supabase.from("event_files").delete().eq("id", fileId);
      queryClient.invalidateQueries({ queryKey: ["checklist-pdfs", eventId] });
      toast({ title: "PDF removido" });
    } catch (err: any) {
      toast({ title: "Erro ao remover PDF", description: err.message, variant: "destructive" });
    }
  };

  const handleViewFile = async (filePath: string) => {
    try {
      const { data, error } = await supabase.storage.from("event-files").createSignedUrl(filePath, 3600);
      if (error || !data?.signedUrl) throw error;
      window.open(data.signedUrl, "_blank");
    } catch {
      toast({ title: "Erro ao abrir PDF", variant: "destructive" });
    }
  };

  const toggleAll = (selected: boolean) => {
    setParsedLines((prev) => prev.map((l) => ({ ...l, selected })));
  };

  const toggleLine = (index: number) => {
    setParsedLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, selected: !l.selected } : l))
    );
  };

  const updateLineText = (index: number, text: string) => {
    setParsedLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, text } : l))
    );
  };

  const removeLine = (index: number) => {
    setParsedLines((prev) => prev.filter((_, i) => i !== index));
  };

  const selectedCount = parsedLines.filter((l) => l.selected).length;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Importar Lista de Material (PDF / Excel / Word)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || extracting}
            >
              {extracting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              {extracting ? "Extraindo..." : "Enviar Arquivo"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.docx,.doc"
              className="hidden"
              onChange={handleFileSelect}
            />
            <span className="text-xs text-muted-foreground">
              PDF, Excel ou Word — será anexado e o conteúdo extraído para importação
            </span>
          </div>

          {/* Attached files */}
          {attachedFiles.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">PDFs anexados:</p>
              {attachedFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 p-2 rounded-md border bg-muted/30 text-sm"
                >
                  {f.file_name?.endsWith(".xlsx") || f.file_name?.endsWith(".xls") ? (
                    <FileSpreadsheet className="h-4 w-4 text-accent-foreground shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                  )}
                  <span className="flex-1 truncate">{f.file_name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleViewFile(f.file_path)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDeleteFile(f.id, f.file_path)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Prévia de Importação
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-3 pb-2">
            <Select value={importCategory} onValueChange={(v) => setImportCategory(v as ChecklistCategory)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                {CHECKLIST_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="secondary">{selectedCount}/{parsedLines.length} selecionados</Badge>
            <div className="flex gap-1 ml-auto">
              <Button variant="ghost" size="sm" onClick={() => toggleAll(true)}>
                Todos
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleAll(false)}>
                Nenhum
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0 border rounded-md p-2">
            <div className="space-y-1.5">
              {parsedLines.map((line, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={line.selected}
                    onCheckedChange={() => toggleLine(i)}
                  />
                  <Input
                    value={line.text}
                    onChange={(e) => updateLineText(i, e.target.value)}
                    className="h-8 text-sm flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={() => removeLine(i)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPreview(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmImport} disabled={importing || selectedCount === 0}>
              {importing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Importar {selectedCount} itens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
