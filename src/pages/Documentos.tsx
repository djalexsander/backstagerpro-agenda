import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, FileText, Pencil, Trash2, Copy, Download, Eye, FilePlus, FileDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";

const TIPOS_DOCUMENTO = [
  { value: "contrato", label: "Contrato de Show" },
  { value: "rider", label: "Rider Técnico" },
  { value: "termo", label: "Termo de Responsabilidade" },
];

const VARIAVEIS_DISPONIVEIS = [
  { key: "{{evento_nome}}", desc: "Nome do evento" },
  { key: "{{evento_data}}", desc: "Data do evento" },
  { key: "{{evento_cidade}}", desc: "Cidade" },
  { key: "{{evento_local}}", desc: "Local/Venue" },
  { key: "{{artista}}", desc: "Artista principal" },
  { key: "{{horario_show}}", desc: "Horário do show" },
  { key: "{{cache}}", desc: "Valor do cachê" },
  { key: "{{transporte}}", desc: "Custo transporte" },
  { key: "{{alimentacao}}", desc: "Custo alimentação" },
  { key: "{{hospedagem}}", desc: "Custo hospedagem" },
  { key: "{{empresa_nome}}", desc: "Nome da empresa" },
  { key: "{{data_atual}}", desc: "Data de hoje" },
  { key: "{{observacoes}}", desc: "Observações do evento" },
];

const DEFAULT_TEMPLATES: Record<string, string> = {
  contrato: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ARTÍSTICOS

CONTRATANTE: ___________________________________
CONTRATADA: {{empresa_nome}}

CLÁUSULA 1 - DO OBJETO
O presente contrato tem por objeto a prestação de serviços artísticos para o evento "{{evento_nome}}", a ser realizado em {{evento_cidade}}, no local {{evento_local}}, na data {{evento_data}}.

CLÁUSULA 2 - DO ARTISTA
O artista responsável pela apresentação será: {{artista}}
Horário previsto para o show: {{horario_show}}

CLÁUSULA 3 - DO VALOR
Pelo serviço prestado, o CONTRATANTE pagará à CONTRATADA o valor de {{cache}}.

CLÁUSULA 4 - DAS DESPESAS
Transporte: {{transporte}}
Alimentação: {{alimentacao}}
Hospedagem: {{hospedagem}}

CLÁUSULA 5 - DAS OBSERVAÇÕES
{{observacoes}}

CLÁUSULA 6 - DO FORO
As partes elegem o foro da comarca de {{evento_cidade}} para dirimir quaisquer dúvidas.

{{evento_cidade}}, {{data_atual}}

_________________________          _________________________
CONTRATANTE                        CONTRATADA`,

  rider: `RIDER TÉCNICO

Evento: {{evento_nome}}
Data: {{evento_data}}
Local: {{evento_local}} — {{evento_cidade}}
Artista: {{artista}}

REQUISITOS DE SOM:
- [ ] Mesa de som digital (mínimo 32 canais)
- [ ] Sistema PA compatível com o porte do evento
- [ ] Monitores de palco (mínimo 4)
- [ ] Microfones conforme lista abaixo

REQUISITOS DE ILUMINAÇÃO:
- [ ] Mesa de luz DMX
- [ ] Moving heads (mínimo 8)
- [ ] Canhões de LED
- [ ] Máquina de fumaça

REQUISITOS DE PALCO:
- [ ] Palco coberto (mínimo 8x6m)
- [ ] Camarim com ar condicionado
- [ ] Água e alimentação para equipe

OBSERVAÇÕES:
{{observacoes}}

Data: {{data_atual}}`,

  termo: `TERMO DE RESPONSABILIDADE

Eu, abaixo assinado, declaro para os devidos fins que me responsabilizo integralmente pela execução dos serviços técnicos durante o evento "{{evento_nome}}", a ser realizado em {{evento_data}} na cidade de {{evento_cidade}}, no local {{evento_local}}.

Artista: {{artista}}

Comprometo-me a:
1. Cumprir todas as normas de segurança aplicáveis
2. Utilizar equipamentos em perfeito estado de funcionamento
3. Seguir as orientações da produção do evento
4. Comunicar imediatamente qualquer irregularidade

Observações: {{observacoes}}

{{evento_cidade}}, {{data_atual}}

_________________________
Nome:
CPF:
Função:`,
};

function fmtCurrency(n: number | null) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
}

export default function Documentos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId } = useAuth();

  const [tab, setTab] = useState("templates");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<any>(null);
  const [formNome, setFormNome] = useState("");
  const [formTipo, setFormTipo] = useState("contrato");
  const [formConteudo, setFormConteudo] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteDocConfirm, setDeleteDocConfirm] = useState<string | null>(null);

  // Queries
  const { data: templates = [] } = useQuery({
    queryKey: ["document-templates", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("document_templates")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["generated-documents", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("generated_documents")
        .select("*, events(name, date)")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["events-docs", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date, city, venue, artist, show_time, observations")
        .eq("empresa_id", empresaId)
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: empresa } = useQuery({
    queryKey: ["empresa-docs", empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const { data, error } = await supabase.from("empresas").select("nome_empresa").eq("id", empresaId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Mutations
  const saveTemplate = useMutation({
    mutationFn: async () => {
      const payload = {
        empresa_id: empresaId,
        nome: formNome.trim(),
        tipo: formTipo,
        conteudo: formConteudo,
      };
      if (editTemplate) {
        const { error } = await supabase.from("document_templates").update(payload as any).eq("id", editTemplate.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("document_templates").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      setEditorOpen(false);
      resetForm();
      toast({ title: editTemplate ? "Template atualizado!" : "Template criado!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("document_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast({ title: "Template excluído!" });
    },
  });

  const deleteDocument = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("generated_documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["generated-documents"] });
      toast({ title: "Documento excluído!" });
    },
  });

  const resetForm = () => {
    setEditTemplate(null);
    setFormNome("");
    setFormTipo("contrato");
    setFormConteudo("");
  };

  const openNewTemplate = (tipo?: string) => {
    resetForm();
    const t = tipo || "contrato";
    setFormTipo(t);
    setFormConteudo(DEFAULT_TEMPLATES[t] || "");
    setFormNome("");
    setEditorOpen(true);
  };

  const openEditTemplate = (tmpl: any) => {
    setEditTemplate(tmpl);
    setFormNome(tmpl.nome);
    setFormTipo(tmpl.tipo);
    setFormConteudo(tmpl.conteudo);
    setEditorOpen(true);
  };

  const duplicateTemplate = (tmpl: any) => {
    resetForm();
    setFormNome(`${tmpl.nome} (Cópia)`);
    setFormTipo(tmpl.tipo);
    setFormConteudo(tmpl.conteudo);
    setEditorOpen(true);
  };

  const replaceVariables = (content: string, eventId: string): string => {
    const event = events.find((e) => e.id === eventId);
    if (!event) return content;

    // Fetch financials for event
    let result = content;
    const replacements: Record<string, string> = {
      "{{evento_nome}}": event.name || "",
      "{{evento_data}}": event.date ? format(parseISO(event.date), "dd/MM/yyyy", { locale: ptBR }) : "",
      "{{evento_cidade}}": event.city || "",
      "{{evento_local}}": event.venue || "",
      "{{artista}}": event.artist || "",
      "{{horario_show}}": event.show_time || "",
      "{{empresa_nome}}": empresa?.nome_empresa || "",
      "{{data_atual}}": format(new Date(), "dd/MM/yyyy", { locale: ptBR }),
      "{{observacoes}}": event.observations || "",
      "{{cache}}": "",
      "{{transporte}}": "",
      "{{alimentacao}}": "",
      "{{hospedagem}}": "",
    };

    Object.entries(replacements).forEach(([key, value]) => {
      result = result.split(key).join(value);
    });

    return result;
  };

  const generateDocument = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate || !selectedEventId) throw new Error("Selecione template e evento");

      // Fetch financial data for the event
      const { data: fin } = await supabase
        .from("financials")
        .select("cache, transport, food, lodging")
        .eq("event_id", selectedEventId)
        .single();

      let content = replaceVariables(selectedTemplate.conteudo, selectedEventId);
      if (fin) {
        content = content.split("{{cache}}").join(fmtCurrency(fin.cache));
        content = content.split("{{transporte}}").join(fmtCurrency(fin.transport));
        content = content.split("{{alimentacao}}").join(fmtCurrency(fin.food));
        content = content.split("{{hospedagem}}").join(fmtCurrency(fin.lodging));
      }

      const event = events.find((e) => e.id === selectedEventId);
      const docNome = `${selectedTemplate.nome} - ${event?.name || "Evento"} - ${format(new Date(), "dd/MM/yyyy")}`;

      const { error } = await supabase.from("generated_documents").insert({
        empresa_id: empresaId,
        template_id: selectedTemplate.id,
        event_id: selectedEventId,
        nome: docNome,
        tipo: selectedTemplate.tipo,
        conteudo_final: content,
        dados: { event_id: selectedEventId, template_id: selectedTemplate.id },
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["generated-documents"] });
      setGenerateOpen(false);
      setSelectedTemplate(null);
      setSelectedEventId("");
      setTab("documentos");
      toast({ title: "Documento gerado com sucesso!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const exportPDF = (nome: string, conteudo: string) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;
    const lineHeight = 6;
    let y = 20;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const lines = conteudo.split("\n");
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line || " ", maxWidth);
      for (const wl of wrapped) {
        if (y > doc.internal.pageSize.getHeight() - 20) {
          doc.addPage();
          y = 20;
        }
        // Bold for lines that look like headings (ALL CAPS or starting with CLÁUSULA)
        if (/^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ\s\-:]{5,}$/.test(wl.trim()) || /^CLÁUSULA/.test(wl.trim())) {
          doc.setFont("helvetica", "bold");
        } else {
          doc.setFont("helvetica", "normal");
        }
        doc.text(wl, margin, y);
        y += lineHeight;
      }
    }

    doc.save(`${nome}.pdf`);
  };

  const exportDOCX = async (nome: string, conteudo: string) => {
    const lines = conteudo.split("\n");
    const paragraphs = lines.map((line) => {
      const isHeading =
        /^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ\s\-:]{5,}$/.test(line.trim()) ||
        /^CLÁUSULA/.test(line.trim());
      if (isHeading && line.trim().length > 0) {
        return new Paragraph({
          children: [new TextRun({ text: line, bold: true, size: 24 })],
          spacing: { after: 120 },
        });
      }
      return new Paragraph({
        children: [new TextRun({ text: line, size: 22 })],
        spacing: { after: 80 },
      });
    });

    const doc = new Document({
      sections: [{ children: paragraphs }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${nome}.docx`);
  };

  const tipoLabel = (tipo: string) => TIPOS_DOCUMENTO.find((t) => t.value === tipo)?.label || tipo;

  const tipoBadgeClass = (tipo: string) => {
    switch (tipo) {
      case "contrato": return "bg-primary/10 text-primary border-primary/20";
      case "rider": return "bg-accent/10 text-accent border-accent/20";
      case "termo": return "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Documentos & Contratos</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="documentos">Documentos Gerados ({documents.length})</TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openNewTemplate("contrato")}>
              <Plus className="h-4 w-4 mr-1" /> Contrato
            </Button>
            <Button size="sm" variant="outline" onClick={() => openNewTemplate("rider")}>
              <Plus className="h-4 w-4 mr-1" /> Rider Técnico
            </Button>
            <Button size="sm" variant="outline" onClick={() => openNewTemplate("termo")}>
              <Plus className="h-4 w-4 mr-1" /> Termo
            </Button>
          </div>

          {templates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhum template criado ainda.</p>
                <p className="text-sm text-muted-foreground mt-1">Crie seu primeiro template de contrato, rider ou termo.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((tmpl: any) => (
                <Card key={tmpl.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-sm font-semibold truncate">{tmpl.nome || "Sem nome"}</CardTitle>
                        <Badge variant="outline" className={`mt-1 text-xs ${tipoBadgeClass(tmpl.tipo)}`}>
                          {tipoLabel(tmpl.tipo)}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                      {tmpl.conteudo?.substring(0, 120)}...
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Criado em {format(new Date(tmpl.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                        setSelectedTemplate(tmpl);
                        setSelectedEventId("");
                        setGenerateOpen(true);
                      }}>
                        <FilePlus className="h-3 w-3 mr-1" /> Gerar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => duplicateTemplate(tmpl)} title="Duplicar template">
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEditTemplate(tmpl)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteConfirm(tmpl.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documentos" className="space-y-4">
          {documents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Nenhum documento gerado.</p>
                <p className="text-sm text-muted-foreground mt-1">Gere documentos a partir dos templates criados.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {documents.map((doc: any) => (
                <Card key={doc.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{doc.nome}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className={`text-xs ${tipoBadgeClass(doc.tipo)}`}>
                            {tipoLabel(doc.tipo)}
                          </Badge>
                          {doc.events && (
                            <span className="text-xs text-muted-foreground">{(doc as any).events?.name}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      {format(new Date(doc.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                        setPreviewTitle(doc.nome);
                        setPreviewContent(doc.conteudo_final);
                        setPreviewOpen(true);
                      }}>
                        <Eye className="h-3 w-3 mr-1" /> Visualizar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => exportPDF(doc.nome, doc.conteudo_final)}>
                        <Download className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDocConfirm(doc.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Template Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTemplate ? "Editar Template" : "Novo Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome do Template</Label>
                <Input value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Ex: Contrato Padrão Show" />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={formTipo} onValueChange={(v) => {
                  setFormTipo(v);
                  if (!editTemplate && !formConteudo.trim()) {
                    setFormConteudo(DEFAULT_TEMPLATES[v] || "");
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS_DOCUMENTO.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Conteúdo do Template</Label>
                <span className="text-xs text-muted-foreground">{"Use variáveis {{...}} para preenchimento automático"}</span>
              </div>
              <Textarea
                value={formConteudo}
                onChange={(e) => setFormConteudo(e.target.value)}
                className="min-h-[300px] font-mono text-sm"
                placeholder="Digite o conteúdo do template..."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Variáveis disponíveis</Label>
              <div className="flex flex-wrap gap-1">
                {VARIAVEIS_DISPONIVEIS.map((v) => (
                  <Badge
                    key={v.key}
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-primary/10 transition-colors"
                    title={v.desc}
                    onClick={() => {
                      setFormConteudo((prev) => prev + v.key);
                    }}
                  >
                    {v.key}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Clique para inserir no final do template</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => saveTemplate.mutate()} disabled={!formNome.trim() || !formConteudo.trim() || saveTemplate.isPending}>
              {saveTemplate.isPending ? "Salvando..." : editTemplate ? "Atualizar" : "Criar Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Document Dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedTemplate && (
              <div className="p-3 rounded-lg bg-muted/50 border">
                <p className="text-sm font-medium">{selectedTemplate.nome}</p>
                <Badge variant="outline" className={`mt-1 text-xs ${tipoBadgeClass(selectedTemplate.tipo)}`}>
                  {tipoLabel(selectedTemplate.tipo)}
                </Badge>
              </div>
            )}
            <div className="space-y-2">
              <Label>Selecione o Evento</Label>
              <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                <SelectTrigger><SelectValue placeholder="Escolha um evento" /></SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} — {format(parseISO(e.date), "dd/MM/yyyy")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => generateDocument.mutate()} disabled={!selectedEventId || generateDocument.isPending}>
              <FilePlus className="h-4 w-4 mr-1" /> {generateDocument.isPending ? "Gerando..." : "Gerar Documento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
          </DialogHeader>
          <div className="bg-white text-black rounded-lg p-8 border shadow-inner min-h-[400px]">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{previewContent}</pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => exportPDF(previewTitle, previewContent)}>
              <Download className="h-4 w-4 mr-1" /> Exportar PDF
            </Button>
            <DialogClose asChild><Button>Fechar</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Template Confirm */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita. Documentos já gerados não serão afetados.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteConfirm) deleteTemplate.mutate(deleteConfirm); setDeleteConfirm(null); }}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Document Confirm */}
      <AlertDialog open={!!deleteDocConfirm} onOpenChange={() => setDeleteDocConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir documento?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteDocConfirm) deleteDocument.mutate(deleteDocConfirm); setDeleteDocConfirm(null); }}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
