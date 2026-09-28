// File-type icons for the knowledge example, vendored from
// google/material-design-icons (Material Symbols Outlined, 24px, Apache-2.0 —
// see LICENSE-Material in this directory). Only the subset the attachment
// list actually renders ships here; general actions use Lucide
// (docs/ui/design.md §6 Q9). Pass `label` to expose an accessible name;
// without one the icon is decorative.

function MaterialGlyph({
  className,
  label,
  d,
}: {
  className?: string;
  label?: string;
  d: string;
}) {
  return (
    <svg
      viewBox="0 -960 960 960"
      className={className}
      fill="currentColor"
      focusable="false"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={d} />
    </svg>
  );
}

export function FileImageIcon(props: { className?: string; label?: string }) {
  return (
    <MaterialGlyph
      {...props}
      d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z"
    />
  );
}

export function FileDocumentIcon(props: {
  className?: string;
  label?: string;
}) {
  return (
    <MaterialGlyph
      {...props}
      d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"
    />
  );
}

// Icon and accessible-name key travel together so the image predicate
// cannot drift between the glyph and its label.
export function attachmentTypeFor(contentType: string): {
  Icon: typeof FileImageIcon;
  labelKey: 'attachments.imageType' | 'attachments.fileType';
} {
  return contentType.startsWith('image/')
    ? { Icon: FileImageIcon, labelKey: 'attachments.imageType' }
    : { Icon: FileDocumentIcon, labelKey: 'attachments.fileType' };
}
