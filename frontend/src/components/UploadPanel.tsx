import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { forestApi } from "../api/client";

interface Props {
  onUploadSuccess: (analysisId: string) => void;
}

export default function UploadPanel({ onUploadSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState("");

  const { mutate, isPending, error } = useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) =>
      forestApi.uploadOrtophoto(file, name || undefined),
    onSuccess: (data) => {
      onUploadSuccess(data.analysis_id);
      setName("");
    },
  });

  const handleFile = (file: File) => {
    if (!file.name.endsWith(".tif") && !file.name.endsWith(".tiff")) {
      alert("Solo se aceptan archivos GeoTIFF (.tif / .tiff)");
      return;
    }
    mutate({ file, name });
  };

  return (
    <div className="flex items-center gap-3">
      <input
        type="text"
        placeholder="Nombre del análisis (opcional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white placeholder-gray-500 w-48 focus:outline-none focus:border-green-500"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={isPending}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
      >
        {isPending ? (
          <><span className="animate-spin">⚙️</span> Analizando...</>
        ) : (
          <><span>📡</span> Subir ortofoto</>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".tif,.tiff"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}
