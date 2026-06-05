/**
 * ManualEditPanel — allows users to manually edit generated designs.
 * 
 * Provides a split-pane editor with live preview, syntax highlighting,
 * and automatic syncing back to the project file tree.
 * 
 * Adapted from open-design's ManualEditPanel.tsx.
 */

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useChatStore } from '../../stores/chat';
import { X, Save, RotateCw, Eye, Code2 } from 'lucide-react';
import { sandboxFor } from '../../lib/iframe-sandbox';

const MonacoEditor = lazy(() => 
  import('@monaco-editor/react').then(m => ({ default: m.default }))
);

interface ManualEditPanelProps {
  conversationId: string;
  artifactId: string;
  onClose: () => void;
}

export function ManualEditPanel({ 
  conversationId, 
  artifactId, 
  onClose 
}: ManualEditPanelProps) {
  const artifacts = useChatStore(s => s.artifacts[conversationId] || []);
  const artifact = artifacts.find(a => a.id === artifactId);
  const updateArtifact = useChatStore(s => s.updateArtifact);
  
  const [code, setCode] = useState(artifact?.code || '');
  const [view, setView] = useState<'split' | 'code' | 'preview'>('split');
  const [hasChanges, setHasChanges] = useState(false);
  const editorRef = useRef<any>(null);
  
  // Update local code when artifact changes
  useEffect(() => {
    if (artifact) {
      setCode(artifact.code);
      setHasChanges(false);
    }
  }, [artifact?.code]);
  
  // Handle code changes
  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
      setHasChanges(value !== artifact?.code);
    }
  };
  
  // Save changes back to artifact
  const handleSave = () => {
    if (artifact && hasChanges) {
      updateArtifact(conversationId, artifact.id, code);
      setHasChanges(false);
    }
  };
  
  // Reset to original
  const handleReset = () => {
    if (artifact) {
      setCode(artifact.code);
      setHasChanges(false);
    }
  };
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape to close
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasChanges]);
  
  if (!artifact) {
    return (
      <div className="flex items-center justify-center h-full text-text-3">
        <p>Artifact not found</p>
      </div>
    );
  }
  
  // Prepare HTML for preview
  const previewHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
</head>
<body>${code}</body>
</html>`;
  
  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <h3 className="text-[13px] font-semibold text-text-1">
            Edit: {artifact.title}
          </h3>
          {hasChanges && (
            <span className="px-2 py-0.5 text-[10px] font-medium bg-accent/20 text-accent rounded">
              Unsaved
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-1 p-0.5 bg-white/5 rounded-md">
            <button
              onClick={() => setView('code')}
              className={`p-1.5 rounded ${view === 'code' ? 'bg-white/10 text-text-1' : 'text-text-3'}`}
              title="Code only"
            >
              <Code2 size={14} />
            </button>
            <button
              onClick={() => setView('split')}
              className={`p-1.5 rounded ${view === 'split' ? 'bg-white/10 text-text-1' : 'text-text-3'}`}
              title="Split view"
            >
              <div className="w-3.5 h-3.5 border border-current rounded-sm" />
            </button>
            <button
              onClick={() => setView('preview')}
              className={`p-1.5 rounded ${view === 'preview' ? 'bg-white/10 text-text-1' : 'text-text-3'}`}
              title="Preview only"
            >
              <Eye size={14} />
            </button>
          </div>
          
          {/* Actions */}
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="p-1.5 text-text-3 hover:text-text-1 disabled:opacity-30"
            title="Reset changes"
          >
            <RotateCw size={14} />
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="p-1.5 text-text-3 hover:text-accent disabled:opacity-30"
            title="Save (⌘S)"
          >
            <Save size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-text-3 hover:text-text-1"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      
      {/* Editor and Preview */}
      <div className="flex-1 flex min-h-0">
        {/* Code Editor */}
        {(view === 'code' || view === 'split') && (
          <div className={`flex flex-col ${view === 'split' ? 'w-1/2' : 'w-full'} border-r border-white/5`}>
            <Suspense fallback={
              <div className="flex items-center justify-center h-full text-text-3">
                Loading editor...
              </div>
            }>
              <MonacoEditor
                height="100%"
                language="html"
                value={code}
                theme="vs-dark"
                onChange={handleEditorChange}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  automaticLayout: true,
                  renderLineHighlight: 'line',
                  lineNumbers: 'on',
                  smoothScrolling: true,
                  cursorSmoothCaretAnimation: 'on',
                  padding: { top: 12, bottom: 12 },
                  suggestOnTriggerCharacters: true,
                  quickSuggestions: true,
                  parameterHints: { enabled: true },
                }}
              />
            </Suspense>
          </div>
        )}
        
        {/* Preview */}
        {(view === 'preview' || view === 'split') && (
          <div className={`flex flex-col ${view === 'split' ? 'w-1/2' : 'w-full'}`}>
            <iframe
              className="flex-1 w-full border-none bg-white"
              srcDoc={previewHtml}
              sandbox={sandboxFor("design-html")}
              title="Preview"
            />
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 text-[11px] text-text-3">
        <div className="flex items-center gap-4">
          <span>{code.length} characters</span>
          <span>{code.split('\n').length} lines</span>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 bg-white/5 rounded">⌘S</kbd>
          <span>Save</span>
          <kbd className="px-1.5 py-0.5 bg-white/5 rounded ml-2">Esc</kbd>
          <span>Close</span>
        </div>
      </div>
    </div>
  );
}
