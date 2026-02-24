import React from "react";

export interface ProjectFile {
    id: string;
    filename: string;
    type: string;
    status: string;
}

interface UploadPanelProps {
    title: string;
    description: string;
    type: "sop" | "literature";
    files: ProjectFile[];
    dragOver: boolean;
    uploadState: { active: boolean; done: number; total: number };
    progress: number;
    onDragChange: (type: "sop" | "literature", active: boolean) => void;
    onDropFiles: (type: "sop" | "literature", files: FileList) => void;
    onDeleteFile: (fileId: string, filename: string) => void;
}

export function UploadPanel({
    title,
    description,
    type,
    files,
    dragOver,
    uploadState,
    progress,
    onDragChange,
    onDropFiles,
    onDeleteFile
}: UploadPanelProps) {
    return (
        <div className="form-section file-panel span-6">
            <h4>{title}</h4>
            <p className="muted">{description}</p>
            <div
                className={`drop-zone ${dragOver ? "active" : ""}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    onDragChange(type, true);
                }}
                onDragLeave={() => onDragChange(type, false)}
                onDrop={(e) => {
                    e.preventDefault();
                    onDragChange(type, false);
                    if (e.dataTransfer.files.length > 0) {
                        onDropFiles(type, e.dataTransfer.files);
                    }
                }}
            >
                <input
                    className="file-input"
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    multiple
                    onChange={(e) => {
                        const selected = e.target.files;
                        if (selected) {
                            onDropFiles(type, selected);
                        }
                        e.currentTarget.value = "";
                    }}
                />
                <div className="drop-hint">拖拽文件到此处，或点击选择</div>
                {uploadState.active ? (
                    <div className="upload-progress">
                        <div className="upload-label">
                            正在上传 {uploadState.done}/{uploadState.total}
                        </div>
                        <div className="upload-track">
                            <div className="upload-bar" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                ) : null}
            </div>
            <div className="file-list">
                {files.filter((f) => f.type === type).map((file) => (
                    <div key={file.id} className="file-item">
                        <div>
                            <span>{file.filename}</span>
                            <span className="muted"> · {file.status}</span>
                        </div>
                        <button className="text-button" onClick={() => onDeleteFile(file.id, file.filename)}>
                            删除
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
