import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forestApi } from "../api/client";

interface Props {
  onUploadSuccess: (id: string) => void;
}

export default function UploadPanel({ onUploadSuccess }: Props) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(".tif", ""));
      return forestApi.createAnalysis(form);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["analyses"] });
      onUploadSuccess(data.analysis_id);
    },
  });

  const handle = (file: File) => {
    if (file.name.endsWith(".tif") || file.name.endsWith(".tiff")) mutate(file);
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".tif,.tiff"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={isPending}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handle(f);
        }}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
          transition-all duration-200 border
          ${dragging
            ? "bg-green-500/20 border-green-400 text-green-300"
            : isPending
              ? "bg-green-900/30 border-green-800 text-green-500 cursor-not-allowed"
              : "bg-green-600 hover:bg-green-500 border-green-500 text-white glow-green hover:shadow-lg"
          }
        `}
      >
        {isPending ? (
          <>
            <span className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Subir ortofoto
          </>
        )}
      </button>
    </>
  );
}
