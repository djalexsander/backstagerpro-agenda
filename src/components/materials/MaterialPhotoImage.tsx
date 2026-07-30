import { useQuery } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function MaterialPhotoImage({
  path,
  alt,
  className,
}: {
  path?: string | null;
  alt: string;
  className?: string;
}) {
  const { data: signedUrl } = useQuery({
    queryKey: ["material-photo-url", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("material-photos")
        .createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !!path,
    staleTime: 50 * 60 * 1000,
  });

  if (!signedUrl) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
        aria-label={`Sem foto para ${alt}`}
      >
        <ImageIcon className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={signedUrl}
      alt={alt}
      className={cn("object-cover", className)}
    />
  );
}

