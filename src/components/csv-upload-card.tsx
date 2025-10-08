"use client";

import { ChangeEvent, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { clsx } from "clsx";

import { CsvStatus } from "@/lib/types";

interface CsvUploadCardProps {
  title: string;
  description: string;
  accept: string;
  status: CsvStatus | undefined;
  onUpload: (file: File) => Promise<void>;
  helper?: string;
}

export function CsvUploadCard({
  title,
  description,
  accept,
  status,
  onUpload,
  helper,
}: CsvUploadCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      await onUpload(file);
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div className="rounded-3xl border border-dashed border-primary/30 bg-primary/5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-primary-strong">{title}</h3>
          <p className="text-sm text-muted/80">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={clsx(
            "inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white transition focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/40",
            isUploading && "opacity-80",
          )}
          disabled={isUploading}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              アップロード中…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              CSVを選択
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleChange}
        />
      </div>
      {helper ? <p className="mt-4 text-xs text-muted/70">{helper}</p> : null}
      {status?.updatedAt ? (
        <p className="mt-3 text-xs text-emerald-600">
          {status.rowCount.toLocaleString()}行を読み込み ({status.updatedAt.toLocaleString("ja-JP")})
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted/60">未読み込み</p>
      )}
      {status?.errors?.length ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-600">
          <p className="font-medium">エラー</p>
          <ul className="mt-2 space-y-2">
            {status.errors.slice(0, 3).map((error) => (
              <li key={`${error.row}-${error.message}`}>
                行{error.row}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {status?.warnings?.length ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-700">
          <p className="font-medium">警告 ({status.warnings.length})</p>
          <p>詳細は後続バージョンで確認できるようになります。</p>
        </div>
      ) : null}
    </div>
  );
}
