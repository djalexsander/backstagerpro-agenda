import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MaterialPhoto } from "@/lib/material-types";
import { MaterialPhotoImage } from "./MaterialPhotoImage";

export function MaterialPhotoGallery({
  photos,
  materialName,
  canManage = false,
  busyPhotoId,
  onSetMain,
  onRemove,
}: {
  photos: MaterialPhoto[];
  materialName: string;
  canManage?: boolean;
  busyPhotoId?: string | null;
  onSetMain?: (photo: MaterialPhoto) => void;
  onRemove?: (photo: MaterialPhoto) => void;
}) {
  if (photos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhuma foto cadastrada.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo) => (
        <div
          key={photo.id}
          className="group relative overflow-hidden rounded-lg border bg-muted"
        >
          <MaterialPhotoImage
            path={photo.storage_path}
            alt={`${materialName} - ${photo.nome_arquivo}`}
            className="aspect-square w-full"
          />
          {photo.foto_principal && (
            <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-background/90 px-2 py-1 text-[10px] font-semibold">
              <Star className="h-3 w-3 fill-primary text-primary" />
              Principal
            </div>
          )}
          {canManage && (
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-background/90 p-1.5">
              {!photo.foto_principal && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyPhotoId === photo.id}
                  onClick={() => onSetMain?.(photo)}
                  title="Definir como principal"
                >
                  <Star className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={busyPhotoId === photo.id}
                onClick={() => onRemove?.(photo)}
                title="Remover foto"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

