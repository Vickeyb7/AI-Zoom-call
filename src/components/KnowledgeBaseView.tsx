import React from 'react';
import {
  Archive,
  CheckCircle2,
  Database,
  Eye,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  KnowledgeApprovalStatus,
  KnowledgeCategory,
  KnowledgeChunk,
  KnowledgeDoc,
  RagSearchResult,
} from '../types/sales';

interface KnowledgeBaseViewProps {
  docs: KnowledgeDoc[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  apiHeaders: Record<string, string>;
}

const CATEGORIES: KnowledgeCategory[] = [
  'Product Documentation',
  'Competitor Battlecards',
  'Pricing & Packaging',
  'Objection Playbooks',
  'Case Studies & ROI',
  'Security & Compliance',
];

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  docs,
  loading,
  onRefresh,
  apiHeaders,
}) => {
  const [selectedCategory, setSelectedCategory] = React.useState<'All' | KnowledgeCategory>('All');
  const [uploadCategory, setUploadCategory] = React.useState<KnowledgeCategory>('Product Documentation');
  const [uploadVersion, setUploadVersion] = React.useState('v1.0');
  const [uploadReviewDate, setUploadReviewDate] = React.useState('2027-02-01');
  const [uploadApproval, setUploadApproval] = React.useState<KnowledgeApprovalStatus>('approved');
  const [uploading, setUploading] = React.useState(false);
  const [reindexing, setReindexing] = React.useState(false);
  const [reindexNotice, setReindexNotice] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [includeDrafts, setIncludeDrafts] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<RagSearchResult[] | null>(null);

  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState('');
  const [newCategory, setNewCategory] = React.useState<KnowledgeCategory>('Product Documentation');
  const [newApproval, setNewApproval] = React.useState<KnowledgeApprovalStatus>('approved');
  const [newContent, setNewContent] = React.useState('');
  const [savingText, setSavingText] = React.useState(false);

  const [inspectDoc, setInspectDoc] = React.useState<{
    doc: KnowledgeDoc;
    chunks: KnowledgeChunk[];
  } | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const activeEmbeddingModel =
    docs.find((d) => d.embeddingModel)?.embeddingModel || 'BAAI/bge-m3';
  const activeEmbeddingDim = docs.find((d) => d.embeddingDimension)?.embeddingDimension || 1024;

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', uploadCategory);
        formData.append('version', uploadVersion);
        formData.append('reviewDate', uploadReviewDate);
        formData.append('validUntil', uploadReviewDate);
        formData.append('approvalStatus', uploadApproval);
        const res = await fetch('/api/knowledge/upload', {
          method: 'POST',
          headers: apiHeaders,
          body: formData,
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }
      }
      await onRefresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateTextDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setSavingText(true);
    setUploadError(null);
    try {
      const res = await fetch('/api/knowledge/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...apiHeaders },
        body: JSON.stringify({
          title: newTitle.trim(),
          category: newCategory,
          content: newContent.trim(),
          version: uploadVersion,
          reviewDate: uploadReviewDate,
          validUntil: uploadReviewDate,
          approvalStatus: newApproval,
          fileType: 'md',
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to save document');
      }
      setNewTitle('');
      setNewContent('');
      setShowCreateModal(false);
      await onRefresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to create document');
    } finally {
      setSavingText(false);
    }
  };

  const handleToggleArchive = async (doc: KnowledgeDoc) => {
    const nextStatus = doc.status === 'archived' ? 'indexed' : 'archived';
    await fetch(`/api/knowledge/${doc.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...apiHeaders },
      body: JSON.stringify({ status: nextStatus }),
    });
    await onRefresh();
  };

  const handleToggleApproval = async (doc: KnowledgeDoc) => {
    const nextApproval: KnowledgeApprovalStatus =
      (doc.approvalStatus || 'approved') === 'approved' ? 'draft' : 'approved';
    await fetch(`/api/knowledge/${doc.id}/approval`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...apiHeaders },
      body: JSON.stringify({ approvalStatus: nextApproval }),
    });
    await onRefresh();
  };

  const handleReindexCorpus = async () => {
    setReindexing(true);
    setReindexNotice(null);
    try {
      const res = await fetch('/api/knowledge/reindex', {
        method: 'POST',
        headers: apiHeaders,
      });
      const data = (await res.json()) as {
        totalTargeted?: number;
        embeddedCount?: number;
        embeddingProvider?: string;
        embeddingModel?: string;
        embeddingDimension?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Re-index failed');
      }
      if ((data.embeddedCount ?? 0) > 0) {
        setReindexNotice(
          `Re-indexed ${data.embeddedCount}/${data.totalTargeted} chunks with ${data.embeddingModel} (${data.embeddingDimension}d).`,
        );
      } else if ((data.totalTargeted ?? 0) === 0) {
        setReindexNotice(
          `All knowledge chunks are already indexed with ${data.embeddingModel} (${data.embeddingDimension}d).`,
        );
      } else {
        setReindexNotice(
          `Indexed with lexical fallback (${data.embeddingModel} ${data.embeddingDimension}d ready).`,
        );
      }
      await onRefresh();
    } catch (err) {
      setReindexNotice(err instanceof Error ? err.message : 'Re-index failed');
    } finally {
      setReindexing(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/knowledge/${id}`, {
      method: 'DELETE',
      headers: apiHeaders,
    });
    await onRefresh();
  };

  const handleInspect = async (docId: string) => {
    const res = await fetch(`/api/knowledge/${docId}/chunks`, {
      headers: apiHeaders,
    });
    if (res.ok) {
      const data = (await res.json()) as { doc: KnowledgeDoc; chunks: KnowledgeChunk[] };
      setInspectDoc(data);
    }
  };

  const handleSemanticSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...apiHeaders },
        body: JSON.stringify({
          query: searchQuery.trim(),
          topK: 5,
          includeDrafts,
        }),
      });
      const data = (await res.json()) as { results: RagSearchResult[] };
      setSearchResults(data.results || []);
    } finally {
      setSearching(false);
    }
  };

  const filteredDocs =
    selectedCategory === 'All' ? docs : docs.filter((d) => d.category === selectedCategory);

  return (
    <div className="space-y-6">
      {/* Top Upload & Semantic Search Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 eki-card rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-[16px] font-semibold text-slate-900">
                Ingest Sales Knowledge
              </h2>
              <p className="text-xs text-slate-500">
                Upload PDF, DOCX, PPTX, HTML, Markdown, or TXT playbooks with SHA-256 deduplication and 500-token structured chunking.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" /> Write Note
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value as KnowledgeCategory)}
                className="eki-input w-full rounded-md px-3 py-1.5 text-[13px]"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Approval</label>
              <select
                value={uploadApproval}
                onChange={(e) => setUploadApproval(e.target.value as KnowledgeApprovalStatus)}
                className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs"
              >
                <option value="approved">Approved</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Version</label>
              <input
                type="text"
                value={uploadVersion}
                onChange={(e) => setUploadVersion(e.target.value)}
                className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Valid Until / Review Date</label>
              <input
                type="date"
                value={uploadReviewDate}
                onChange={(e) => setUploadReviewDate(e.target.value)}
                className="eki-input w-full rounded-md px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFileUpload(e.dataTransfer.files);
            }}
            className="border border-dashed border-slate-300 rounded-lg bg-[#F8FAFC] p-5 text-center space-y-2.5 hover:border-[#4F46E5] transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.pptx,.html,.htm,.md,.markdown,.txt"
              multiple
              onChange={(e) => void handleFileUpload(e.target.files)}
              className="hidden"
            />
            <div className="w-9 h-9 rounded-lg bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center mx-auto">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            </div>
            <div>
              <p className="text-[13px] font-medium text-slate-800">
                {uploading
                  ? 'Extracting, chunking & indexing...'
                  : 'Drop PDF, DOCX, PPTX, HTML, MD, or TXT files'}
              </p>
              <p className="text-xs text-slate-500">
                Max 15 MB · Target 500 tok · 75 tok overlap · Heading-aware
              </p>
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="eki-btn-primary px-4 py-1.5 rounded-md text-xs font-medium"
            >
              Browse Files
            </button>
          </div>

          {uploadError && (
            <div className="rounded-md bg-[#FFF1F2] border border-[#FECDD3] px-3 py-2 text-xs text-[#9F1239]">
              {uploadError}
            </div>
          )}
        </div>

        {/* Semantic RAG Retrieval Tester */}
        <div className="lg:col-span-7 eki-card rounded-lg p-5 flex flex-col space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-[16px] font-semibold text-slate-900">
                Tenant-Scoped Hybrid RAG Tester
              </h2>
              <p className="text-xs text-slate-500">
                Embedding model: <span className="font-mono text-slate-700">{activeEmbeddingModel}</span> ({activeEmbeddingDim}d) · Top-12 recall → Top-5 rerank.
              </p>
            </div>
            <button
              type="button"
              disabled={reindexing}
              onClick={() => void handleReindexCorpus()}
              className="eki-btn-secondary px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              title="Re-embed organisation corpus with the active Hugging Face embedding model"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? 'animate-spin' : ''}`} />
              {reindexing ? 'Re-Indexing...' : 'Re-Index Embeddings'}
            </button>
          </div>

          {reindexNotice && (
            <div className="rounded-md bg-[#EEF2FF] border border-[#C7D2FE] px-3 py-2 text-xs text-[#3730A3]">
              {reindexNotice}
            </div>
          )}

          <form onSubmit={handleSemanticSearch} className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Query approved docs (e.g. 'ApexCloud egress' or 'BYOK key revocation')..."
                  className="eki-input w-full rounded-md pl-9 pr-3 py-2 text-[13px]"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium whitespace-nowrap"
              >
                {searching ? 'Searching...' : 'Query Index'}
              </button>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={includeDrafts}
                onChange={(e) => setIncludeDrafts(e.target.checked)}
                className="rounded border-slate-300 text-[#4F46E5]"
              />
              <span>Include Draft documents in preview search (live calls always strictly exclude drafts &amp; expired docs)</span>
            </label>
          </form>

          <div className="flex-1 overflow-y-auto space-y-2.5 min-h-[200px] max-h-[280px]">
            {searchResults === null ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8 text-xs text-slate-500 space-y-1.5">
                <Database className="w-5 h-5 text-slate-400" />
                <p>Run a query to inspect ranked chunks, heading paths, token counts, and approval enforcement.</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No matching approved chunks found in this organisation.
              </div>
            ) : (
              searchResults.map((res) => (
                <div
                  key={res.chunkId}
                  className="rounded-md border border-slate-200 bg-[#F8FAFC] p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {res.docTitle}
                      {res.headingPath || res.sectionTitle
                        ? ` · ${res.headingPath || res.sectionTitle}`
                        : ''}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[#4338CA] bg-[#EEF2FF] border border-[#E0E7FF] px-2 py-0.5 rounded shrink-0">
                      {(res.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-[10.5px] font-mono text-slate-500 flex flex-wrap gap-x-2">
                    <span>{res.approvalStatus || 'approved'}</span>
                    {res.version && <span>· {res.version}</span>}
                    {typeof res.tokenCount === 'number' && <span>· {res.tokenCount} tok</span>}
                    <span>· {res.embeddingModel ? `vec:${res.embeddingModel}` : 'lexical-hybrid'}</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                    {res.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Document Repository Table */}
      <div className="eki-card rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-semibold text-slate-900">
              Knowledge Repository ({filteredDocs.length})
            </h2>
            <p className="text-xs text-slate-500">
              Governance metadata, version tracking, archive controls, and deletion propagation.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
            {(['All', ...CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading knowledge base...</div>
        ) : filteredDocs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No documents in this category for this organisation.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#F8FAFC] border-b border-slate-200">
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-4">Document</th>
                  <th className="py-2.5 px-3">Owner · Ver</th>
                  <th className="py-2.5 px-3">Valid Until</th>
                  <th className="py-2.5 px-3 text-right">Chunks</th>
                  <th className="py-2.5 px-3">Governance</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[13px]">
                {filteredDocs.map((doc, idx) => {
                  const approval = doc.approvalStatus || 'approved';
                  return (
                    <tr
                      key={doc.id}
                      className={`${idx % 2 === 1 ? 'bg-[#FAFAFA]' : 'bg-white'} ${
                        doc.status === 'archived' ? 'opacity-65' : ''
                      }`}
                    >
                      <td className="py-3 px-4 max-w-md">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <FileText className="w-4 h-4 text-[#4F46E5] shrink-0" />
                          <span className="truncate">{doc.title}</span>
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          {doc.category} · <span className="uppercase font-mono">{doc.fileType}</span>
                          {doc.embeddingModel ? (
                            <span className="font-mono text-[11px] text-slate-400">
                              {' '}· {doc.embeddingModel}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-700 whitespace-nowrap">
                        {doc.owner} · <span className="font-mono">{doc.version}</span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                        {doc.validUntil || doc.reviewDate}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-700">
                        {doc.chunkCount}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {doc.status === 'archived' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                            <Archive className="w-3.5 h-3.5" /> Archived
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleToggleApproval(doc)}
                            title="Toggle Approved vs Draft status (Drafts are excluded from live calls)"
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium transition-colors ${
                              approval === 'approved'
                                ? 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0] hover:bg-emerald-100'
                                : 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] hover:bg-amber-100'
                            }`}
                          >
                            {approval === 'approved' ? (
                              <ShieldCheck className="w-3.5 h-3.5" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            <span className="capitalize">{approval}</span>
                            {doc.indexedWithEmbeddings && (
                              <span className="font-mono text-[10px] opacity-75">· Vec</span>
                            )}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => void handleInspect(doc.id)}
                          title="Inspect extracted chunks & token budgets"
                          className="p-1.5 rounded-md text-slate-500 hover:text-[#4F46E5] hover:bg-[#EEF2FF] transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleArchive(doc)}
                          title={doc.status === 'archived' ? 'Restore to RAG index' : 'Archive from RAG index'}
                          className="p-1.5 rounded-md text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                        >
                          {doc.status === 'archived' ? (
                            <RotateCcw className="w-4 h-4" />
                          ) : (
                            <Archive className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(doc.id)}
                          title="Permanently delete source & embeddings"
                          className="p-1.5 rounded-md text-slate-400 hover:text-[#E11D48] hover:bg-[#FFF1F2] transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspect Chunks Modal */}
      {inspectDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F172A]/45">
          <div className="bg-white rounded-lg border border-slate-200 w-full max-w-2xl max-h-[82vh] flex flex-col eki-drawer">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {inspectDoc.doc.title}
                </h3>
                <p className="text-xs text-slate-500">
                  {inspectDoc.chunks.length} chunks · Owner: {inspectDoc.doc.owner} · {inspectDoc.doc.version}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectDoc(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {inspectDoc.chunks.map((c) => (
                <div key={c.id} className="rounded-md border border-slate-200 bg-[#F8FAFC] p-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500">
                    <span>
                      Chunk #{c.chunkIndex + 1}
                      {typeof c.tokenCount === 'number' ? ` · ${c.tokenCount} tok` : ''}
                      {c.isAtomicFact ? ' · atomic-fact' : ''}
                    </span>
                    <span className="truncate max-w-sm">
                      {c.headingPath || c.sectionTitle || c.category}
                    </span>
                  </div>
                  <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed">
                    {c.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Text/Markdown Document Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F172A]/45">
          <div className="bg-white rounded-lg border border-slate-200 w-full max-w-xl eki-drawer p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Add Markdown / Playbook Document
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleCreateTextDoc} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Q4 Enterprise SLA Guarantees"
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as KnowledgeCategory)}
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Approval</label>
                  <select
                    value={newApproval}
                    onChange={(e) => setNewApproval(e.target.value as KnowledgeApprovalStatus)}
                    className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                  >
                    <option value="approved">Approved</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Content (Markdown or plain text)
                </label>
                <textarea
                  required
                  rows={8}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Paste product specifications, pricing rules, security certifications, or objection counters..."
                  className="eki-input w-full rounded-md px-3 py-2 text-[13px]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="eki-btn-secondary px-4 py-2 rounded-md text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingText}
                  className="eki-btn-primary px-4 py-2 rounded-md text-xs font-medium"
                >
                  {savingText ? 'Indexing...' : 'Save & Embed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
