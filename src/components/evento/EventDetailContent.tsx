import { useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Music, FileText, Download, Truck, Upload, Trash2, Users } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

function DayCard({ day, dayFile, isAdmin, onDownload, onUpload, onRemove }: {
  day: any;
  dayFile: any;
  isAdmin: boolean;
  onDownload: (path: string, name: string) => void;
  onUpload: (dayId: string, file: File) => void;
  onRemove: (fileId: string, filePath: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onUpload(day.id, f);
    e.target.value = "";
  }, [day.id, onUpload]);

  return (
    <Card className="border-primary/20 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold text-primary">DIA {day.day_number}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {day.date && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{format(parseISO(day.date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
          </div>
        )}
        {day.artist && (
          <div className="flex items-center gap-2">
            <Music className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{day.artist}</span>
          </div>
        )}
        {day.show_time && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{(day.show_time as string).slice(0, 5)}</span>
          </div>
        )}
        {day.observations && (
          <div className="text-xs text-muted-foreground">
            <p className="font-medium mb-1">Obs. Técnicas:</p>
            <p className="whitespace-pre-wrap">{day.observations}</p>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
        {dayFile ? (
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs text-muted-foreground truncate" title={dayFile.file_name}>📄 {dayFile.file_name}</p>
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => onDownload(dayFile.file_path, dayFile.file_name)}>
              <Download className="h-3 w-3 mr-1" /> Baixar Rider
            </Button>
            {isAdmin && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3 w-3 mr-1" /> Trocar
                </Button>
                <Button variant="outline" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={() => onRemove(dayFile.id, dayFile.file_path)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Remover
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="pt-2 border-t border-border">
            {isAdmin ? (
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3 w-3 mr-1" /> Adicionar Rider
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground italic">Sem rider técnico</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface EventDetailContentProps {
  event: any;
  eventDays: any[];
  files: any[];
  teamMembers: any[];
  isAdmin: boolean;
  requestDownload: (path: string, name: string) => void;
  handleUploadRider: (dayId: string, file: File) => void;
  handleRemoveRider: (fileId: string, filePath: string) => void;
}

export function EventDetailContent({
  event, eventDays, files, teamMembers, isAdmin,
  requestDownload, handleUploadRider, handleRemoveRider,
}: EventDetailContentProps) {
  const hasMultipleDays = eventDays.length > 0;

  return (
    <>
      {/* Event Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Informações Gerais</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Local:</span> {event.venue}, {event.city}</div>
            <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Dias:</span> {(event as any).num_days || 1} dia(s)</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Logística</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {event.logistics_departure && (
              <div className="flex items-center gap-2"><Truck className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Saída:</span> {format(new Date(event.logistics_departure.replace(' ', 'T').replace(/([+-]\d{2}:\d{2}|Z)$/, '')), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</div>
            )}
            {event.observations && (
              <div><p className="text-muted-foreground mb-1">Observações:</p><p className="whitespace-pre-wrap">{event.observations}</p></div>
            )}
            {(() => {
              const materialFiles = files.filter((f) => f.file_type === "material_list");
              if (materialFiles.length === 0 && !event.material_list) return null;
              return (
                <div>
                  <p className="text-muted-foreground mb-2">Lista de Material:</p>
                  {event.material_list && <p className="whitespace-pre-wrap mb-2">{event.material_list}</p>}
                  {materialFiles.length > 0 && (
                    <div className="space-y-2">
                      {materialFiles.map((f: any) => (
                        <div key={f.id} className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate flex-1">{f.file_name}</span>
                          <Button variant="outline" size="sm" onClick={() => requestDownload(f.file_path, f.file_name)}>
                            <Download className="h-3 w-3 mr-1" /> Baixar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {(() => {
              const riderFiles = files.filter((f) => f.file_type === "event_rider");
              if (riderFiles.length === 0) return null;
              return (
                <div>
                  <p className="text-muted-foreground mb-2">Rider / Projeto do Evento:</p>
                  <div className="space-y-2">
                    {riderFiles.map((f: any) => (
                      <div key={f.id} className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate flex-1">{f.file_name}</span>
                        <Button variant="outline" size="sm" onClick={() => requestDownload(f.file_path, f.file_name)}>
                          <Download className="h-3 w-3 mr-1" /> Baixar
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Equipe Escalada */}
      {teamMembers.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Equipe Escalada ({teamMembers.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {teamMembers.map((tm: any) => (
              <Card key={tm.funcionario_id} className="border-border">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tm.funcionarios?.nome}</p>
                    {tm.funcionarios?.funcao && (
                      <p className="text-xs text-muted-foreground truncate">{tm.funcionarios.funcao}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Event Days Cards */}
      {hasMultipleDays ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Music className="h-5 w-5 text-primary" />
            Dias do Evento
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {eventDays.map((day) => {
              const dayFile = files.find((f: any) => f.event_day_id === day.id && f.file_type !== "material_list");
              return (
                <DayCard
                  key={day.id}
                  day={day}
                  dayFile={dayFile}
                  isAdmin={isAdmin}
                  onDownload={requestDownload}
                  onUpload={handleUploadRider}
                  onRemove={handleRemoveRider}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Detalhes do Show</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><Music className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Artista:</span> {event.artist}</div>
            <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Data:</span> {format(parseISO(event.date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</div>
            {event.show_time && <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Horário:</span> {event.show_time.slice(0, 5)}</div>}
            {files.length > 0 && (
              <div className="flex gap-2 pt-2">
                {files.map((f: any) => (
                  <Button key={f.id} variant="outline" size="sm" onClick={() => requestDownload(f.file_path, f.file_name)}>
                    <Download className="h-4 w-4 mr-1" /> {f.file_name}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
