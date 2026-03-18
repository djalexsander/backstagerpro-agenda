import { CalendarDays, Music, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface AgendaStatsProps {
  totalEvents: number;
  totalShows: number;
  totalArtists: number;
}

export function AgendaStats({ totalEvents, totalShows, totalArtists }: AgendaStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card className="bg-card">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <CalendarDays className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">Eventos no mês</p>
            <p className="text-lg font-bold">{totalEvents}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center">
            <Music className="h-4 w-4 text-accent" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">Total de shows</p>
            <p className="text-lg font-bold">{totalShows}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="h-9 w-9 rounded-lg bg-secondary/10 flex items-center justify-center">
            <Users className="h-4 w-4 text-secondary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">Artistas envolvidos</p>
            <p className="text-lg font-bold">{totalArtists}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
