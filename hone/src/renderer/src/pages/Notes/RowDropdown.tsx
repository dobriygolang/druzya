import type { Folder } from '../../api/hone';
import { DropdownLabel, DropdownItem, DropdownDivider } from './Dropdown';
import { LinkIcon, UnlinkIcon, TrashIcon, FolderIcon } from './icons';

export interface RowDropdownProps {
  isLocal: boolean;
  published: boolean;
  folders: Folder[];
  currentFolderId: string | null | undefined;
  onSyncToCloud: () => void;
  onCloudToLocal: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
}

export function RowDropdown({ isLocal, published, folders, currentFolderId, onSyncToCloud, onCloudToLocal, onPublish, onUnpublish, onDelete, onMove }: RowDropdownProps) {
  return (
    <div
      className="fadein"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% - 4px)',
        right: 8,
        zIndex: 30,
        minWidth: 200,
        padding: 6,
        borderRadius: 10,
        background: 'rgba(20,20,22,0.96)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        animationDuration: '140ms',
      }}
    >
      {/* Phase 0.11 — explicit current-status header + symmetric
          state-switch UX. Local notes can move ↑ to cloud; cloud notes
          can publish, unpublish (back to private), or move ↓ back to
          local-only. Two clicks max for any state transition.
       */}
      {isLocal ? (
        <>
          <DropdownLabel>Currently · Local-only</DropdownLabel>
          <DropdownItem
            icon={<LinkIcon />}
            label="Sync to cloud"
            onClick={onSyncToCloud}
          />
          <DropdownDivider />
        </>
      ) : published ? (
        <>
          <DropdownLabel>Currently · Public link</DropdownLabel>
          <DropdownItem
            icon={<LinkIcon />}
            label="Copy public link"
            onClick={onPublish}
          />
          <DropdownItem
            icon={<UnlinkIcon />}
            label="Make private (cloud only)"
            onClick={onUnpublish}
          />
          <DropdownItem
            icon={<UnlinkIcon />}
            label="Move to local-only"
            onClick={onCloudToLocal}
          />
          <DropdownDivider />
        </>
      ) : (
        <>
          <DropdownLabel>Currently · Synced to cloud</DropdownLabel>
          <DropdownItem
            icon={<LinkIcon />}
            label="Share to web"
            onClick={onPublish}
          />
          <DropdownItem
            icon={<UnlinkIcon />}
            label="Move to local-only"
            onClick={onCloudToLocal}
          />
          <DropdownDivider />
        </>
      )}
      {folders.length > 0 && (
        <>
          <DropdownDivider />
          <DropdownLabel>Move to folder</DropdownLabel>
          {currentFolderId && (
            <DropdownItem
              icon={<FolderIcon />}
              label="Unfiled"
              onClick={() => onMove(null)}
            />
          )}
          {folders.map((f) => (
            <DropdownItem
              key={f.id}
              icon={<FolderIcon />}
              label={f.name}
              disabled={f.id === currentFolderId}
              onClick={() => onMove(f.id)}
            />
          ))}
        </>
      )}
      <DropdownDivider />
      <DropdownItem
        icon={<TrashIcon />}
        label="Delete Note"
        onClick={onDelete}
        danger
      />
    </div>
  );
}
