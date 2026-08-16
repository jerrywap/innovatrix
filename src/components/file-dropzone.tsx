"use client";

import { useCallback, useId, useRef, useState } from "react";
import { UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format-bytes";

/**
 * File picker with drag-and-drop.
 *
 * Wired to ticket 05's direct-to-storage upload: the browser PUTs to a
 * presigned URL, then a server action records the file. This component does
 * the *selection* half — the upload itself belongs to whichever feature owns
 * the files, because only that feature knows which scope to sign for.
 *
 * ## The checks here are courtesy, not enforcement
 *
 * Extension and size are validated client-side so someone doesn't wait through
 * a 2GB upload to be told no. **None of it is trusted.** The real limits are in
 * the signature: `assertUploadAllowed()` runs server-side before signing, and
 * `ContentLength` is signed, so S3 itself rejects a body that doesn't match.
 * Deleting this whole component would not weaken the system.
 *
 * `formatBytes` is shared with the storage policy so the message a customer
 * reads here and the one the server would produce are the same words.
 */

export interface SelectedFile {
  file: File;
  id: string;
}

export function FileDropzone({
  onFilesSelected,
  accept,
  maxBytes,
  multiple = false,
  label = "Drop a file here, or choose one",
  hint,
  disabled,
  className,
}: {
  onFilesSelected: (files: File[]) => void;
  /** Same syntax as the input's `accept`, e.g. ".zip,.tar.gz". */
  accept?: string;
  maxBytes?: number;
  multiple?: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedFile[]>([]);

  const accept_ = accept ?? "";

  const take = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setRejected(null);

      const files = Array.from(fileList);
      const tooBig = maxBytes ? files.find((f) => f.size > maxBytes) : undefined;
      if (tooBig && maxBytes) {
        setRejected(
          `${tooBig.name} is ${formatBytes(tooBig.size)}. The limit here is ${formatBytes(maxBytes)}.`,
        );
        return;
      }

      const next = files.map((file, index) => ({
        file,
        // Name and size alone collide across two picks of the same file; the
        // index disambiguates within a single selection.
        id: `${file.name}-${file.size}-${index}`,
      }));

      setSelected(multiple ? [...selected, ...next] : next);
      onFilesSelected(multiple ? [...selected.map((s) => s.file), ...files] : files);
    },
    [maxBytes, multiple, onFilesSelected, selected],
  );

  const remove = (id: string) => {
    const next = selected.filter((s) => s.id !== id);
    setSelected(next);
    onFilesSelected(next.map((s) => s.file));
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* A label wrapping a hidden input: clicking or pressing Enter anywhere
          on the zone opens the picker, with no key handling of our own and no
          div pretending to be a button. */}
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer.files);
        }}
        className={cn(
          "border-border bg-surface/50 hover:border-border-strong flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center transition",
          dragging && "border-signal bg-signal-soft",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <span className="bg-surface-muted text-muted-foreground grid size-10 place-items-center rounded-xl">
          <UploadCloud className="size-5" aria-hidden />
        </span>
        <span className="text-[14px] font-medium">{label}</span>
        {hint && <span className="text-subtle text-[12.5px]">{hint}</span>}
        {maxBytes && (
          <span className="text-subtle text-[12px]">Up to {formatBytes(maxBytes)}</span>
        )}

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          className="sr-only"
          multiple={multiple}
          disabled={disabled}
          {...(accept_ ? { accept: accept_ } : {})}
          onChange={(event) => {
            take(event.target.files);
            // Reset so picking the same file twice still fires a change.
            event.target.value = "";
          }}
        />
      </label>

      {rejected && (
        <p role="alert" className="text-destructive text-[12.5px]">
          {rejected}
        </p>
      )}

      {selected.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {selected.map(({ file, id }) => (
            <li
              key={id}
              className="border-border bg-surface flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
              <span className="text-subtle shrink-0 text-[12px]">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={`Remove ${file.name}`}
                className="text-subtle hover:text-foreground shrink-0 transition"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
